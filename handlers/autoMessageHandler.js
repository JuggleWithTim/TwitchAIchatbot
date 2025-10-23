const aiService = require('../services/aiService');
const { getSetting } = require('../config/settings');
const { CHECK_INTERVALS, MESSAGES } = require('../config/constants');
const { cleanResponse } = require('../utils/helpers');

class AutoMessageHandler {
  constructor(twitchClient, botState) {
    this.twitchClient = twitchClient;
    this.botState = botState;
    this.autoMessageInterval = null;
    this.startAutoMessaging();
  }

  /**
   * Start the auto-messaging timer
   */
  startAutoMessaging() {
    // Check every 30 seconds
    this.autoMessageInterval = setInterval(() => {
      this.checkAndSendAutoMessage();
    }, 30000); // 30 seconds
  }

  /**
   * Check if auto-message should be sent and send if needed
   */
  async checkAndSendAutoMessage() {
    if (!this.botState.shouldSendAutoMessage()) {
      return;
    }

    await this.sendAutoMessage();
  }

  /**
   * Send an automatic message based on chat context
   */
  async sendAutoMessage() {
    const channel = getSetting('channel');

    try {
      // Get the most recent message from the history
      const mostRecentMessage = this.botState.messageHistory[this.botState.messageHistory.length - 1];

      // Check if the most recent message was sent by the bot
      const botUsername = getSetting('username').toLowerCase();
      if (mostRecentMessage && mostRecentMessage.toLowerCase().startsWith(`${botUsername}:`)) {
        console.log(MESSAGES.RECENT_MESSAGE_BY_BOT);
        this.botState.updateLastMentionTime();
        return;
      }

      // Don't send auto-messages if the bot is paused, auto-messages are disabled, or there's no message history
      if (this.botState.isPaused() || !getSetting('enableAutoMessages', false) || this.botState.messageHistory.length === 0) {
        return;
      }

      // Get the recent conversation context
      const context = this.botState.getMessageContext();

      // Generate a message based on the context
      let response = await aiService.getChatResponse(
        'Please respond to the chat as if you are a part of the conversation. Do not include your own name at the start.',
        context,
        this.botState.getSystemPrompt()
      );

      // Remove <think> tags (including content) from the response
      response = cleanResponse(response);

      // If the response is empty, send a default message
      if (!response) {
        response = getSetting('fallbackMessage', 'Ooooops, something went wrong');
      }

      // Send the message to the chat
      this.twitchClient.say(channel, `${response}`);

      // Add the bot's message to history
      this.botState.addMessage(`${getSetting('username')}: ${response}`);

      // Update the last mention time
      this.botState.updateLastMentionTime();

    } catch (error) {
      console.error('Auto-message error:', error);
      // Send fallback message
      const fallback = getSetting('fallbackMessage', 'Ooooops, something went wrong');
      this.twitchClient.say(channel, fallback);
      this.botState.addMessage(`${getSetting('username')}: ${fallback}`);
      this.botState.updateLastMentionTime();
    }
  }

  /**
   * Force send an auto-message (for testing)
   */
  async forceSendAutoMessage() {
    await this.sendAutoMessage();
  }

  /**
   * Stop auto-messaging
   */
  stopAutoMessaging() {
    if (this.autoMessageInterval) {
      clearInterval(this.autoMessageInterval);
      this.autoMessageInterval = null;
    }
  }

  /**
   * Restart auto-messaging
   */
  restartAutoMessaging() {
    this.stopAutoMessaging();
    this.startAutoMessaging();
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.stopAutoMessaging();
  }
}

module.exports = AutoMessageHandler;
