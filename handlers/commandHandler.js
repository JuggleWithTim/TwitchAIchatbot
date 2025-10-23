const aiService = require('../services/aiService');
const twitchApiService = require('../services/twitchApiService');
const { getSetting, setSetting, saveSettings } = require('../config/settings');
const { COMMANDS, MESSAGES, IMAGE_COMMAND_ALIASES } = require('../config/constants');
const {
  hasElevatedPrivileges,
  extractCommandArgs,
  parseNumber,
  minutesToMs,
  msToMinutes,
  startsWithAny,
  generateFilename
} = require('../utils/helpers');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

class CommandHandler {
  constructor(twitchClient, botState) {
    this.twitchClient = twitchClient;
    this.botState = botState;
  }

  /**
   * Handle incoming commands
   * @param {string} channel - Channel name
   * @param {Object} tags - Message tags
   * @param {string} message - Full message
   * @returns {boolean} - True if command was handled
   */
  async handleCommand(channel, tags, message) {
    const username = tags.username;

    // AI Bot promo
    if (message.toLowerCase().startsWith(COMMANDS.AI_BOT)) {
      this.twitchClient.say(channel, MESSAGES.AI_BOT_PROMO);
      return true;
    }

    // Hug command
    if (message.toLowerCase().startsWith(COMMANDS.HUG)) {
      return await this.handleHugCommand(channel, tags, message);
    }

    // Shoutout command
    if (message.toLowerCase().startsWith(COMMANDS.SO)) {
      return await this.handleShoutoutCommand(channel, tags, message);
    }

    // Waifu commands
    if (message.toLowerCase() === COMMANDS.WAIFU) {
      return await this.handleAddWaifu(channel, tags);
    }
    if (message.toLowerCase() === COMMANDS.UNWAIFU) {
      return await this.handleRemoveWaifu(channel, tags);
    }
    if (message.toLowerCase() === COMMANDS.WAIFU_LIST) {
      return await this.handleWaifuList(channel);
    }

    // Auto-messages toggle
    if (message.toLowerCase() === COMMANDS.AI_AUTO) {
      return await this.handleAutoMessagesToggle(channel, tags);
    }

    // Timer setting
    if (message.toLowerCase().startsWith(COMMANDS.AI_TIMER)) {
      return await this.handleTimerSetting(channel, tags, message);
    }

    // System prompt commands
    if (message.toLowerCase().startsWith(COMMANDS.AI_SYS_PROMPT)) {
      return await this.handleSystemPromptUpdate(channel, tags, message);
    }
    if (message.toLowerCase() === COMMANDS.AI_RESET_PROMPT) {
      return await this.handleSystemPromptReset(channel, tags);
    }

    // Bot control
    if (message.toLowerCase() === COMMANDS.AI_STOP) {
      return await this.handleBotPause(channel, tags);
    }
    if (message.toLowerCase() === COMMANDS.AI_START) {
      return await this.handleBotResume(channel, tags);
    }

    // Context length
    if (message.toLowerCase().startsWith(COMMANDS.AI_CONTEXT)) {
      return await this.handleContextLength(channel, tags, message);
    }

    // Image generation - check for command with or without arguments
    const isImageCommand = IMAGE_COMMAND_ALIASES.some(cmd =>
      message.toLowerCase().startsWith(cmd + ' ') || message.toLowerCase() === cmd
    );
    if (isImageCommand) {
      return await this.handleImageGeneration(channel, tags, message);
    }

    // Quota reset
    if (message.toLowerCase() === COMMANDS.AI_RESET_QUOTA) {
      return await this.handleQuotaReset(channel, tags);
    }

    // Help command
    if (message.toLowerCase() === COMMANDS.AI_HELP) {
      return await this.handleHelpCommand(channel, tags);
    }

    return false; // Command not handled
  }

  async handleHugCommand(channel, tags, message) {
    if (!getSetting('enableHugCommand', false)) return false;

    const hugMatch = message.trim().match(/^!hug\s+@?([a-zA-Z0-9_]+)$/i);
    if (!hugMatch) return false;

    const hugReceiver = hugMatch[1];
    const hugGiver = tags['display-name'] || tags.username;

    const hugPrompt = `Tell the chat (in your normal style and personality) that @${hugGiver} gives a hug to @${hugReceiver}. Make it friendly.`;
    const context = this.botState.getMessageContext();

    try {
      let response = await aiService.getChatResponse(hugPrompt, context, this.botState.getSystemPrompt());
      response = response.replace(/(@[a-zA-Z0-9_]+)([.!?,:;])/g, '$1 $2');
      this.twitchClient.say(channel, response);
      this.botState.addMessage(`${getSetting('username')}: ${response}`);
    } catch (error) {
      console.error('Hug command error:', error);
      this.twitchClient.say(channel, MESSAGES.HUG_SUCCESS(hugGiver, hugReceiver));
    }

    return true;
  }

  async handleShoutoutCommand(channel, tags, message) {
    if (!getSetting('enableShoutoutCommand', false)) return false;
    if (!hasElevatedPrivileges(tags)) return false;

    const matches = message.trim().match(/^!so\s+@?([a-zA-Z0-9_]{4,25})/i);
    if (!matches) {
      this.twitchClient.say(channel, MESSAGES.INVALID_SO_USAGE);
      return true;
    }

    const targetUsername = matches[1].toLowerCase();
    await this.performShoutout(channel, targetUsername, tags.username);
    return true;
  }

  async performShoutout(channel, targetUsername, requestedBy) {
    const shoutoutData = await twitchApiService.generateShoutout(targetUsername, this.botState.messageHistory);

    if (!shoutoutData.success) {
      this.twitchClient.say(channel, shoutoutData.message);
      return;
    }

    const { user, context } = shoutoutData;
    const soUserMsg = `Generate a shoutout for ${user.display_name} that will hype up viewers to check their channel. Include information about their latest stream. Include their Twitch link ("https://twitch.tv/${user.login}") as-is, with no punctuation (like ! or .) immediately after the link.`;

    try {
      let aiSoMsg = await aiService.getChatResponse(soUserMsg, context, this.botState.getSystemPrompt());
      aiSoMsg = aiSoMsg.replace(/(https:\/\/twitch\.tv\/[a-zA-Z0-9_]+)([.,!?)])/g, '$1 $2');
      this.twitchClient.say(channel, aiSoMsg);
    } catch (error) {
      console.error('Shoutout AI error:', error);
      this.twitchClient.say(channel, `Go check out @${user.display_name} at https://twitch.tv/${user.login}!`);
    }
  }

  async handleAddWaifu(channel, tags) {
    if (!getSetting('enableWaifuCommand', false)) return false;

    const username = tags.username;
    if (this.botState.addWaifu(username)) {
      this.twitchClient.say(channel, MESSAGES.WAIFU_ADD(username));
    } else {
      this.twitchClient.say(channel, MESSAGES.WAIFU_ALREADY(username));
    }
    return true;
  }

  async handleRemoveWaifu(channel, tags) {
    if (!getSetting('enableWaifuCommand', false)) return false;

    const username = tags.username;
    if (this.botState.removeWaifu(username)) {
      this.twitchClient.say(channel, MESSAGES.WAIFU_REMOVE(username));
    } else {
      this.twitchClient.say(channel, MESSAGES.WAIFU_NOT_LISTED(username));
    }
    return true;
  }

  async handleWaifuList(channel) {
    if (!getSetting('enableWaifuCommand', false)) return false;

    const waifus = this.botState.getWaifus();
    if (waifus.length === 0) {
      this.twitchClient.say(channel, MESSAGES.WAIFU_LIST_EMPTY);
    } else {
      this.twitchClient.say(channel, MESSAGES.WAIFU_LIST(waifus));
    }
    return true;
  }

  async handleAutoMessagesToggle(channel, tags) {
    if (!hasElevatedPrivileges(tags)) return false;

    const currentState = getSetting('enableAutoMessages', false);
    const newState = !currentState;
    setSetting('enableAutoMessages', newState ? 1 : 0);
    await saveSettings();

    const message = newState ? MESSAGES.AUTO_MESSAGES_ENABLED : MESSAGES.AUTO_MESSAGES_DISABLED;
    this.twitchClient.say(channel, message);
    this.botState.addMessage(`${getSetting('username')}: ${message}`);
    return true;
  }

  async handleTimerSetting(channel, tags, message) {
    if (!hasElevatedPrivileges(tags)) return false;

    const minutes = parseNumber(extractCommandArgs(message, COMMANDS.AI_TIMER));
    if (minutes === null || minutes < 1) {
      this.twitchClient.say(channel, MESSAGES.INVALID_MINUTES);
      this.botState.addMessage(`${getSetting('username')}: ${MESSAGES.INVALID_MINUTES}`);
      return true;
    }

    setSetting('inactivityThreshold', minutesToMs(minutes));
    await saveSettings();
    const response = MESSAGES.TIMER_SET(minutes);
    this.twitchClient.say(channel, response);
    this.botState.addMessage(`${getSetting('username')}: ${response}`);
    return true;
  }

  async handleSystemPromptUpdate(channel, tags, message) {
    if (!hasElevatedPrivileges(tags)) return false;

    const newPrompt = extractCommandArgs(message, COMMANDS.AI_SYS_PROMPT);
    if (!newPrompt) {
      this.twitchClient.say(channel, MESSAGES.INVALID_PROMPT);
      this.botState.addMessage(`${getSetting('username')}: ${MESSAGES.INVALID_PROMPT}`);
      return true;
    }

    this.botState.setSystemPrompt(newPrompt);
    this.twitchClient.say(channel, MESSAGES.PROMPT_UPDATED);
    this.botState.addMessage(`${getSetting('username')}: ${MESSAGES.PROMPT_UPDATED}`);
    return true;
  }

  async handleSystemPromptReset(channel, tags) {
    if (!hasElevatedPrivileges(tags)) return false;

    this.botState.resetSystemPrompt();
    this.twitchClient.say(channel, MESSAGES.PROMPT_RESET);
    this.botState.addMessage(`${getSetting('username')}: ${MESSAGES.PROMPT_RESET}`);
    return true;
  }

  async handleBotPause(channel, tags) {
    if (!hasElevatedPrivileges(tags)) return false;

    this.botState.pauseBot();
    this.twitchClient.say(channel, MESSAGES.BOT_PAUSED);
    this.botState.addMessage(`${getSetting('username')}: ${MESSAGES.BOT_PAUSED}`);
    return true;
  }

  async handleBotResume(channel, tags) {
    if (!hasElevatedPrivileges(tags)) return false;

    this.botState.resumeBot();
    this.twitchClient.say(channel, MESSAGES.BOT_RESUMED);
    this.botState.addMessage(`${getSetting('username')}: ${MESSAGES.BOT_RESUMED}`);
    return true;
  }

  async handleContextLength(channel, tags, message) {
    if (!hasElevatedPrivileges(tags)) return false;

    const newLength = parseNumber(extractCommandArgs(message, COMMANDS.AI_CONTEXT));
    if (newLength === null || newLength < 1 || newLength > 50) {
      this.twitchClient.say(channel, MESSAGES.INVALID_CONTEXT);
      this.botState.addMessage(`${getSetting('username')}: ${MESSAGES.INVALID_CONTEXT}`);
      return true;
    }

    this.botState.setMaxHistoryLength(newLength);
    const response = MESSAGES.CONTEXT_SET(newLength);
    this.twitchClient.say(channel, response);
    this.botState.addMessage(`${getSetting('username')}: ${response}`);
    return true;
  }

  async handleImageGeneration(channel, tags, message) {
    if (!getSetting('enableImageGeneration', false)) return false;

    // Check quota
    if (this.botState.isQuotaExceeded()) {
      this.twitchClient.say(channel, MESSAGES.QUOTA_REACHED(getSetting('quotaLimit', 10)));
      return true;
    }

    // Check OpenAI setup
    if (!getSetting('useOpenAI') || !getSetting('openaiApiKey')) {
      this.twitchClient.say(channel, MESSAGES.NO_OPENAI);
      return true;
    }

    let prompt;
    let generatedFromContext = false;
    const userProvidedPrompt = message.slice(8).trim(); // Remove "!imagine" (8 chars)

    try {
      if (!userProvidedPrompt) {
        // Generate from context
        if (this.botState.messageHistory.length === 0) {
          this.twitchClient.say(channel, MESSAGES.NO_CONTEXT);
          return true;
        }

        prompt = await aiService.generatePromptFromContext(this.botState.messageHistory);
        generatedFromContext = true;
      } else {
        prompt = userProvidedPrompt;
      }

      // Increment quota
      const newUsage = this.botState.incrementQuota();

      // Generate image
      const imageResult = await aiService.generateImage(prompt);

      if (!imageResult.success) {
        this.botState.quotaUsage = Math.max(0, this.botState.quotaUsage - 1); // Refund on failure
        setSetting('quotaUsage', this.botState.quotaUsage);
        await saveSettings();

        let errorMessage = MESSAGES.IMAGE_ERROR;
        if (imageResult.error === 'content_policy') {
          errorMessage = MESSAGES.CONTENT_POLICY_ERROR;
        } else if (!userProvidedPrompt) {
          errorMessage = MESSAGES.CONTEXT_ERROR;
        }
        this.twitchClient.say(channel, errorMessage);
        return true;
      }

      // Download and save image
      const imageBuffer = await axios.get(imageResult.url, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(imageBuffer.data, 'binary');

      await fs.mkdir(getSetting('imageOutputDir'), { recursive: true });
      const prefix = generatedFromContext ? 'c' : 'm';
      const filename = generateFilename(prefix);
      const filePath = path.join(getSetting('imageOutputDir'), filename);
      await fs.writeFile(filePath, buffer);

      // Create public URL
      const publicUrl = `${getSetting('imagePublicUrl')}/${filename}`;

      const responseMessage = generatedFromContext
        ? MESSAGES.IMAGE_FROM_CONTEXT(newUsage, getSetting('quotaLimit', 10)) + publicUrl
        : MESSAGES.IMAGE_FROM_PROMPT(newUsage, getSetting('quotaLimit', 10)) + publicUrl;

      this.twitchClient.say(channel, responseMessage);
      this.botState.addMessage(`${getSetting('username')}: ${generatedFromContext ? 'Context image generated' : `Image for "${prompt}"`}`);

    } catch (error) {
      this.botState.quotaUsage = Math.max(0, this.botState.quotaUsage - 1); // Refund on error
      setSetting('quotaUsage', this.botState.quotaUsage);
      await saveSettings();
      console.error('Image generation error:', error);
      this.twitchClient.say(channel, MESSAGES.IMAGE_ERROR);
    }

    return true;
  }

  async handleQuotaReset(channel, tags) {
    if (tags.username.toLowerCase() !== 'jugglewithtim') return false;

    this.botState.resetQuota();
    this.twitchClient.say(channel, MESSAGES.QUOTA_RESET);
    return true;
  }

  async handleHelpCommand(channel, tags) {
    if (!hasElevatedPrivileges(tags)) return false;

    const helpMessage = `Available commands:
      ${COMMANDS.AI_AUTO} - Toggle auto-messages on/off |
      ${COMMANDS.AI_TIMER} <minutes> - Set auto-message timer |
      ${COMMANDS.AI_SYS_PROMPT} <new prompt> - Update system prompt |
      ${COMMANDS.AI_RESET_PROMPT} - Reset to default prompt |
      ${COMMANDS.AI_CONTEXT} <number> - Set context history length (1-50) |
      ${COMMANDS.AI_STOP} - Pause the bot |
      ${COMMANDS.AI_START} - Resume the bot |
      !imagine <description> - Generate AI image (DALL-E 3) |
      ${COMMANDS.AI_HELP} - Show this help message`;

    this.twitchClient.say(channel, helpMessage);
    this.botState.addMessage(`${getSetting('username')}: ${helpMessage}`);
    return true;
  }
}

module.exports = CommandHandler;
