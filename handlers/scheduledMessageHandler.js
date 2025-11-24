const aiService = require('../services/aiService');
const { getSetting } = require('../config/settings');
const { CHECK_INTERVALS, MESSAGES } = require('../config/constants');
const { cleanResponse } = require('../utils/helpers');

class ScheduledMessageHandler {
  constructor(twitchClient, botState) {
    this.twitchClient = twitchClient;
    this.botState = botState;
    this.scheduledMessageInterval = null;
    this.currentMessageIndex = 0;
    this.startScheduledMessaging();
  }

  /**
   * Start the scheduled message timer
   */
  startScheduledMessaging() {
    // Check every 30 seconds for scheduled messages
    this.scheduledMessageInterval = setInterval(() => {
      this.checkAndSendScheduledMessage();
    }, 30000); // 30 seconds
  }

  /**
   * Check if scheduled message should be sent and send if needed
   */
  async checkAndSendScheduledMessage() {
    if (!this.shouldSendScheduledMessage()) {
      return;
    }

    await this.sendScheduledMessage();
  }

  /**
   * Check if a scheduled message should be sent
   * @returns {boolean} - True if should send scheduled message
   */
  shouldSendScheduledMessage() {
    if (!getSetting('enableScheduledMessages', false)) return false;
    if (this.botState.isPaused()) return false;

    const scheduledMessages = getSetting('scheduledMessages', []);
    if (scheduledMessages.length === 0) return false;

    // Check if it's time to send the message
    const timerMinutes = getSetting('scheduledMessageTimer', 10);
    const timerMs = timerMinutes * 60 * 1000;

    const now = Date.now();
    const lastSendTime = this.botState.lastScheduledMessageTime || 0;

    return (now - lastSendTime) >= timerMs;
  }

  /**
   * Send the next scheduled message in sequence
   */
  async sendScheduledMessage() {
    const channel = getSetting('channel');
    const scheduledMessages = getSetting('scheduledMessages', []);

    if (scheduledMessages.length === 0) return;

    const messageData = scheduledMessages[this.currentMessageIndex];

    try {
      if (messageData.type === 'static') {
        // Static message - send directly
        this.twitchClient.say(channel, messageData.content);
        this.botState.addMessage(`${getSetting('username')}: ${messageData.content}`);
      } else if (messageData.type === 'ai') {
        // AI message - generate using bot's personality
        const context = this.botState.getMessageContext();
        const result = await aiService.getChatResponse(messageData.content, context, this.botState.getSystemPrompt());

        // Remove <think> tags (including content) from the response
        let response = cleanResponse(result.response);

        // If the response is empty, try again with a simpler prompt or skip
        if (!response) {
          console.log('Empty AI response for scheduled message, skipping');
          this.advanceToNextMessage();
          return;
        }

        this.twitchClient.say(channel, response);
        this.botState.addMessage(`${getSetting('username')}: ${response}`);
      }

      // Update timestamp and advance to next message
      this.botState.lastScheduledMessageTime = Date.now();
      this.advanceToNextMessage();

    } catch (error) {
      console.error('Scheduled message error:', error);
      // Still advance to next message even on error to avoid getting stuck
      this.advanceToNextMessage();
    }
  }

  /**
   * Advance to the next message in the list, wrapping around if at end
   */
  advanceToNextMessage() {
    const scheduledMessages = getSetting('scheduledMessages', []);
    if (scheduledMessages.length === 0) return;

    this.currentMessageIndex = (this.currentMessageIndex + 1) % scheduledMessages.length;
  }

  /**
   * Get current message index for debugging
   * @returns {number} - Current message index
   */
  getCurrentIndex() {
    return this.currentMessageIndex;
  }

  /**
   * Force send the next scheduled message (for testing)
   */
  async forceSendScheduledMessage() {
    await this.sendScheduledMessage();
  }

  /**
   * Reset the message sequence to the beginning
   */
  resetSequence() {
    this.currentMessageIndex = 0;
  }

  /**
   * Stop scheduled messaging
   */
  stopScheduledMessaging() {
    if (this.scheduledMessageInterval) {
      clearInterval(this.scheduledMessageInterval);
      this.scheduledMessageInterval = null;
    }
  }

  /**
   * Restart scheduled messaging
   */
  restartScheduledMessaging() {
    this.stopScheduledMessaging();
    this.startScheduledMessaging();
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.stopScheduledMessaging();
  }
}

module.exports = ScheduledMessageHandler;
