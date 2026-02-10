// Import required libraries
const tmi = require('@tmi.js/chat');
const { OpenAI } = require('openai');

// Import our modules
const { loadSettings, getSetting, getSettings } = require('./config/settings');
const { MESSAGES } = require('./config/constants');
const aiService = require('./services/aiService');
const memoryService = require('./services/memoryService');
const CommandHandler = require('./handlers/commandHandler');
const EventHandler = require('./handlers/eventHandler');

const ScheduledMessageHandler = require('./handlers/scheduledMessageHandler');
const WebInterface = require('./web/webInterface');
const BotState = require('./models/botState');
const discordBot = require('./discordbot.js');

// Main initialization function
async function initializeBot() {
  try {
    // Load settings first
    await loadSettings();

    // Initialize OpenAI for services
    const openai = new OpenAI({
      apiKey: getSetting('openaiApiKey'),
    });

    // Initialize Discord bot if enabled
    if (getSetting('enableDiscordBot') && getSetting('discordBotToken')) {
      discordBot.initializeDiscord(getSettings(), openai);
      discordBot.loginDiscord(getSetting('discordBotToken'));
    } else {
      console.log('Discord bot is disabled or token missing in settings.');
    }

    // Initialize Twitch client
    const twitchClient = new tmi.Client({
      token: getSetting('password'),
      channels: [getSetting('channel')],
    });

    // Initialize memory service (only if enabled)
    if (getSetting('enableMemory') == 1) {
      console.log('Initializing memory service...');
      await memoryService.initialize();
    }

    // Initialize bot state (must be after settings are loaded)
    const botState = new BotState();

    // Initialize handlers
    const commandHandler = new CommandHandler(twitchClient, botState);
    const eventHandler = new EventHandler(twitchClient, botState);
    const scheduledMessageHandler = new ScheduledMessageHandler(twitchClient, botState);

    // Initialize web interface
    const webInterface = new WebInterface(getSetting('webPort'));

// Event listener for Twitch chat messages
twitchClient.on('message', async (event) => {
  const channel = event.channel?.login || getSetting('channel');
  const message = event.message?.text || '';
  const user = event.user || {};
  const tags = {
    username: user.login,
    'display-name': user.display,
    badges: user.badges,
    isBroadcaster: user.isBroadcaster,
    isMod: user.isMod,
    isLeadMod: user.isLeadMod
  };

  // Ignore messages from the bot itself
  if ((user.login || '').toLowerCase() === (getSetting('username') || '').toLowerCase()) return;

  // Test commands for Twitch events
  /*switch (message.toLowerCase()) {
    case '!testsubscription':
      twitchClient.emit('subscription', channel, 'test_subscriber', {}, '', tags);
      return;
    case '!testresub':
      twitchClient.emit('resub', channel, 'test_resubscriber', 3, '', tags, {});
      return;
    case '!testsubmysterygift':
      twitchClient.emit('submysterygift', channel, 'test_gifter', 5, {}, tags);
      return;
    case '!testsubgift':
      twitchClient.emit('subgift', channel, 'test_gifter', 1, 'test_recipient', {}, tags);
      return;
    case '!testmultisubgift':
      const recipients = ['alice', 'bob', 'carol', 'lenny'];
      recipients.forEach(recipient => {
        twitchClient.emit('subgift', channel, 'test_gifter', 1, recipient, { plan: '1000' }, tags);
      });
      return;
    case '!testprimeupgrade':
      twitchClient.emit('primepaidupgrade', channel, 'test_user', {}, tags);
      return;
    case '!testcheer':
      twitchClient.emit('cheer', channel, { username: 'test_cheerer', bits: '100' }, message);
      return;
    case '!testraided':
      twitchClient.emit('raided', channel, 'test_raider', 50);
      return;
    // Add more test cases here if needed
  }*/

  // Add message to bot state
  botState.addMessage(`${tags.username}: ${message}`);

  // Try to handle as command first
  const commandHandled = await commandHandler.handleCommand(channel, tags, message);
  if (commandHandled) return;

  // Handle normal messages (bot mentions)
  if (botState.isPaused()) return;

  const botUsername = (getSetting('username') || '').toLowerCase();
  const isBotMention = message.toLowerCase().includes(botUsername);

  // Handle cheer events (represented on message events in @tmi.js/chat)
  if (event.cheer && event.cheer.bits) {
    await eventHandler.handleCheer(channel, {
      username: user.login,
      bits: event.cheer.bits
    }, message);
  }

  // Passive learning: Extract memory from messages that won't trigger bot responses
  if (getSetting('enableMemory') == 1 && getSetting('enablePassiveLearning') == 1 && !isBotMention) {
    // Run passive memory extraction in background (don't await to avoid blocking)
    aiService.extractMemoryFromMessage(message, tags.username).catch(error => {
      console.error('Passive learning error:', error);
    });
  }

  if (isBotMention) {
    // Check if we can respond to this user
    if (!botState.canRespondToUser(tags.username)) {
      return; // Ignore messages from users who have reached the limit
    }

    botState.updateLastMentionTime();

    const userMessage = message.replace(new RegExp(`@${botUsername}`, 'i'), '').trim();
    const context = botState.getMessageContext();

    let prompt = botState.getSystemPrompt();
    if (botState.isWaifu(tags.username)) {
      prompt += '\nRemember, you are the waifu of this user UwU, respond with extra love and passion.';
    }

    // If this is the limit response, modify prompt to generate a goodbye message
    if (botState.isLimitResponse(tags.username)) {
      prompt += '\nIMPORTANT: This is your final response to this user in this conversation. Respond with a polite message indicating that you\'ve enjoyed the conversation but your social battery is running low and you need to take a break. Keep it friendly and suggest chatting again later.';
    }

    try {
      const result = await aiService.getChatResponse(userMessage, context, prompt, tags.username);
      let response = result.response.replace(/<think[^>]*>([\s\S]*?)<\/think>/gi, '').trim();

      if (!response) {
        response = getSetting('fallbackMessage', 'Ooooops, something went wrong');
      }

      twitchClient.say(channel, `@${tags.username}, ${response}`);
      botState.addMessage(`${getSetting('username')}: ${response}`);

      // Increment the response count after successful response
      botState.incrementUserResponseCount(tags.username);
    } catch (error) {
      console.error('Chat response error:', error);
      const fallback = getSetting('fallbackMessage', 'Ooooops, something went wrong');
      twitchClient.say(channel, `@${tags.username}, ${fallback}`);
      botState.addMessage(`${getSetting('username')}: ${fallback}`);

      // Still increment count even on error to prevent spam
      botState.incrementUserResponseCount(tags.username);
    }
  }
});

// Twitch subscription events
twitchClient.on('sub', (event) => {
  const channel = event.channel?.login || getSetting('channel');
  const username = event.user?.login;

  if (!username) return;

  if (event.type === 'sub') {
    eventHandler.handleSubscription(
      channel,
      username,
      { plan: event.plan?.plan },
      '',
      {
        'msg-param-cumulative-months': 1,
        'msg-param-sub-plan': event.plan?.plan
      }
    );
  } else if (event.type === 'resub') {
    eventHandler.handleResubscription(
      channel,
      username,
      event.cumulativeMonths,
      event.message?.text || '',
      {
        'msg-param-cumulative-months': event.cumulativeMonths,
        'msg-param-sub-plan': event.plan?.plan
      },
      { plan: event.plan?.plan }
    );
  } else if (event.type === 'subMysteryGift') {
    eventHandler.handleSubMysteryGift(
      channel,
      username,
      event.mystery?.count || 0,
      { plan: event.plan?.plan },
      {}
    );
  } else if (event.type === 'subGift') {
    eventHandler.handleSubgift(
      channel,
      username,
      0,
      event.recipient?.login,
      {
        plan: event.plan?.plan,
        wasAnonymous: event.user?.isAnon === true
      },
      {
        'msg-param-gift-months': event.gift?.months,
        'msg-param-community-gift-id': event.mystery?.id
      }
    );
  } else if (event.type === 'primePaidUpgrade') {
    eventHandler.handlePrimeUpgrade(
      channel,
      username,
      { plan: event.plan?.plan || 'Prime' },
      {}
    );
  }
});

twitchClient.on('raid', (event) => {
  const channel = event.channel?.login || getSetting('channel');
  eventHandler.handleRaid(channel, event.user?.login, event.viewers);
});

// Connect to Twitch chat
twitchClient.on('connect', () => {
  console.log(MESSAGES.CONNECTED);
});

twitchClient.on('error', (err) => {
  console.error(MESSAGES.CONNECTION_FAILED, err);
});

twitchClient.connect();

// Start web interface
webInterface.start();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await memoryService.stopMemoryServer();
  eventHandler.cleanup();
  scheduledMessageHandler.cleanup();
  process.exit(0);
});

  } catch (error) {
    console.error('Failed to initialize bot:', error);
    process.exit(1);
  }
}

// Start the bot
initializeBot();
