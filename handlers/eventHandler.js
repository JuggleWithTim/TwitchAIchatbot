const aiService = require('../services/aiService');
const { getSetting } = require('../config/settings');
const { MESSAGES } = require('../config/constants');
const { cleanResponse } = require('../utils/helpers');

class EventHandler {
  constructor(twitchClient, botState) {
    this.twitchClient = twitchClient;
    this.botState = botState;
    this.subgiftBuffer = [];
    this.subgiftInterval = null;
    this.initializeSubgiftProcessor();
  }

  /**
   * Initialize the subgift buffer processor
   */
  initializeSubgiftProcessor() {
    this.subgiftInterval = setInterval(() => {
      this.processSubgiftBuffer();
    }, 1000); // Process every second
  }

  /**
   * Process buffered subgift events
   */
  processSubgiftBuffer() {
    if (this.subgiftBuffer.length > 0) {
      if (this.subgiftBuffer.length < 3) {
        // Acknowledge individually
        this.subgiftBuffer.forEach(({ channel, username, streakMonths, recipient, methods, userstate }) => {
          this.handleIndividualSubgift(channel, username, streakMonths, recipient, methods, userstate);
        });
      } else {
        // Send general grouped response
        this.handleGroupedSubgift(this.subgiftBuffer);
      }
      // Clear buffer
      this.subgiftBuffer = [];
    }
  }

  /**
   * Handle subscription event
   */
  async handleSubscription(channel, username, method, message, userstate) {
    if (this.botState.isPaused()) return;

    // Parse subscription details
    const subMonths = parseInt(userstate['msg-param-cumulative-months']) || 1;
    const tier = userstate['msg-param-sub-plan'] === '3000' ? 3 :
                 userstate['msg-param-sub-plan'] === '2000' ? 2 : 1;

    // Build system prompt
    let eventPrompt = `${this.botState.getSystemPrompt()}\nRespond to a new tier ${tier} subscription from ${username}. Welcome them with enthusiastic, streamer-appropriate joy.`;
    let logMessage = `NEW SUB: ${username} T${tier}`;

    // Handle the event
    await this.handleSubscriptionEvent(channel, username, eventPrompt, logMessage);
  }

  /**
   * Handle resubscription event
   */
  async handleResubscription(channel, username, months, message, userstate, methods) {
    if (this.botState.isPaused()) return;

    // Parse resubscription details
    const subMonths = parseInt(userstate['msg-param-cumulative-months']) || months;
    const tier = userstate['msg-param-sub-plan'] === '3000' ? 3 :
                 userstate['msg-param-sub-plan'] === '2000' ? 2 : 1;

    // Build system prompt
    let eventPrompt = `${this.botState.getSystemPrompt()}\nRespond to a tier ${tier} resubscription from ${username} (${subMonths} months). Thank them for continued support. Keep it fresh and excited.`;
    let logMessage = `RESUB: ${username} [${subMonths}mo] T${tier}`;

    // Handle the event
    await this.handleSubscriptionEvent(channel, username, eventPrompt, logMessage);
  }

  /**
   * Handle sub mystery gift event
   */
  async handleSubMysteryGift(channel, username, numbOfSubs, methods, userstate) {
    if (this.botState.isPaused()) return;

    // Parse mystery gift subscription details
    const tier = methods.plan === '3000' ? 3 :
                 methods.plan === '2000' ? 2 : 1;
    // Build system prompt
    let eventPrompt = `${this.botState.getSystemPrompt()}\nRespond to a gift of ${numbOfSubs} tier ${tier} subscriptions from ${username}. Use a celebratory tone and keep it under 423 characters.`;
    let logMessage = `MYSTERY GIFT: ${username} gifted ${numbOfSubs} subs at T${tier}`;

    // Handle the event
    await this.handleSubscriptionEvent(channel, username, eventPrompt, logMessage);
  }

  /**
   * Handle individual subgift
   */
  async handleIndividualSubgift(channel, username, streakMonths, recipient, methods, userstate) {
    if (this.botState.isPaused()) return;

    const tier = methods.plan === '3000' ? 3 : methods.plan === '2000' ? 2 : 1;
    const giftMonths = parseInt(userstate['msg-param-gift-months']) || 1;

    let eventPrompt = `${this.botState.getSystemPrompt()}\nRespond to a gifted tier ${tier} subscription from ${username} to ${recipient} (${giftMonths} months). Use celebratory emojis. Keep under 423 characters.`;
    let logMessage = `GIFT: ${username} → ${recipient} (${giftMonths}mo T${tier})`;

    await this.handleSubscriptionEvent(channel, username, eventPrompt, logMessage, recipient);
  }

  /**
   * Handle grouped subgift events
   */
  async handleGroupedSubgift(events) {
    if (this.botState.isPaused()) return;

    const channel = events[0].channel;
    const usernames = [...new Set(events.map(event => event.username))];
    const totalGifts = events.length;

    const groupedEventPrompt = `${this.botState.getSystemPrompt()}\nAcknowledge a group of ${totalGifts} gifted subscriptions from these users: ${usernames.join(', ')}. Use a celebratory and grateful tone. Keep the message concise and under 423 characters.`;

    try {
      let result = await aiService.getChatResponse(
        `Grouped subgift event: ${totalGifts} gifts from ${usernames.length} users`,
        this.botState.getMessageContext(),
        groupedEventPrompt
      );

      let response = cleanResponse(result.response);

      if (!response) {
        response = `A big shoutout to our amazing gifters: ${usernames.join(', ')} for gifting a total of ${totalGifts} subscriptions! 🎁✨`;
      }

      this.twitchClient.say(channel, response);

    } catch (error) {
      console.error('Grouped subgift response error:', error);
      this.twitchClient.say(channel, `Thanks to our generous gifters: ${usernames.join(', ')} for gifting ${totalGifts} subs! 🎁✨`);
    }
  }

  /**
   * Handle subgift event (buffered)
   */
  handleSubgift(channel, username, streakMonths, recipient, methods, userstate) {
    if (this.botState.isPaused()) return;

    if (methods && methods.wasAnonymous) {
      console.log(`Part of anonymous mystery gift - skipping individual acknowledgment.`);
      return;
    }

    // Skip individual acknowledgments for community mystery gifts
    // These are already handled by the submysterygift event
    if (userstate && userstate['msg-param-community-gift-id']) {
      console.log(`Part of community mystery gift - skipping individual acknowledgment.`);
      return;
    }

    this.subgiftBuffer.push({ channel, username, streakMonths, recipient, methods, userstate });
  }

  /**
   * Handle Prime subscription upgrade
   */
  async handlePrimeUpgrade(channel, username, methods, userstate) {
    if (this.botState.isPaused()) return;

    // Prime subscriptions are considered tier 1
    const tier = 1;

    // Build system prompt
    let eventPrompt = `${this.botState.getSystemPrompt()}\nRespond to a Prime subscription upgrade from ${username}. Welcome them with enthusiastic, streamer-appropriate joy.`;
    let logMessage = `PRIME UPGRADE: ${username} T${tier}`;

    // Handle the event
    await this.handleSubscriptionEvent(channel, username, eventPrompt, logMessage);
  }

  /**
   * Generic subscription event handler
   */
  async handleSubscriptionEvent(channel, username, eventPrompt, logMessage, recipient = null) {
    try {
      // Get AI response
      let result = await aiService.getChatResponse(
        logMessage,
        this.botState.getMessageContext(),
        eventPrompt
      );

      // Clean response
      let response = cleanResponse(result.response);

      // Fallback responses
      if (!response) {
        response = recipient ? `${username} you LEGEND! Thanks for gifting ${recipient}! 🎁 Welcome ${recipient}!` :
                   `${username} Welcome to the family! Let's goooo! 🎉`;
      }

      // Format mention
      let mention = recipient ? `@${username} → @${recipient}` : `@${username}`;

      this.twitchClient.say(channel, `${mention} ${response}`);

    } catch (error) {
      console.error('Subscription Error:', error);
      // Send safe fallback even if AI fails
      const errorResponse = recipient ? `WOW! Massive thanks to ${username} for gifting ${recipient}! 🎁✨` :
                         `Big welcome to ${username}! 🥳`;
      this.twitchClient.say(channel, errorResponse);
    }
  }

  /**
   * Handle cheer event
   */
  async handleCheer(channel, userstate, message) {
    if (this.botState.isPaused()) return;
    if (!getSetting('enableBitsAlerts', false)) return;

    const username = userstate.username;
    const bits = userstate.bits;

    const eventPrompt = `${this.botState.getSystemPrompt()}\nRespond to a cheer of ${bits} bits
      from ${username}. Incorporate the bit amount naturally. Casual stream-appropriate
      excitement. Keep under 423 characters.`;

    try {
      let result = await aiService.getChatResponse(
        `Cheer event: ${bits} bits from ${username}`,
        this.botState.getMessageContext(),
        eventPrompt
      );

      let response = cleanResponse(result.response);
      if (!response) response = `${bits} bits?! You're a star! ⭐`;

      this.twitchClient.say(channel, `@${username} ${response}`);
    } catch (error) {
      console.error('Cheer response error:', error);
    }
  }

  /**
   * Handle raid event
   */
  async handleRaid(channel, username, viewers) {
    if (this.botState.isPaused()) return;
    if (!getSetting('enableRaidsAlerts', false)) return;

    const eventPrompt = `${this.botState.getSystemPrompt()}\nRespond to a raid from ${username}
      with ${viewers} viewers. Create an energetic welcome message. Include the raider
      name and viewer count naturally. Keep under 423 characters.`;

    try {
      let result = await aiService.getChatResponse(
        `Raid event: ${viewers} viewers from ${username}`,
        this.botState.getMessageContext(),
        eventPrompt
      );

      let response = cleanResponse(result.response);
      if (!response) response = `HOLY MOLY THE ${viewers} RAID TRAIN HAS ARRIVED! CHOO CHOO! 🚂`;

      this.twitchClient.say(channel, `@${username} ${response}`);
    } catch (error) {
      console.error('Raid response error:', error);
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.subgiftInterval) {
      clearInterval(this.subgiftInterval);
    }
  }
}

module.exports = EventHandler;
