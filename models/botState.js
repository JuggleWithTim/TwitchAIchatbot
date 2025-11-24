const { getSetting, setSetting, saveSettings } = require('../config/settings');
const { CHECK_INTERVALS, MESSAGES } = require('../config/constants');
const { getTimestamp, hasTimeElapsed } = require('../utils/helpers');

class BotState {
  constructor() {
    this.messageHistory = [];
    this.waifus = [];
    this.quotaUsage = 0;
    this.quotaResetTimer = null;
    this.userResponseCounts = new Map();
    this.userResponseResetTimer = null;
    this.lastBotMentionTime = getTimestamp();
    this.lastScheduledMessageTime = 0;
    this.botPaused = false;
    this.systemPrompt = '';
    this.initializeState();
  }

  /**
   * Initialize bot state from settings
   */
  initializeState() {
    this.waifus = getSetting('waifus', []);
    this.quotaUsage = getSetting('quotaUsage', 0) || 0;
    this.botPaused = false; // Always start unpaused
    this.updateSystemPrompt();
    this.startQuotaResetTimer();
    this.startUserResponseResetTimer();
  }

  /**
   * Update the system prompt
   */
  updateSystemPrompt() {
    const { CORE_SYSTEM_PROMPT } = require('../config/constants');
    const corePrompt = CORE_SYSTEM_PROMPT(
      getSetting('username', 'bot'),
      getSetting('channel', 'channel')
    );

    const additionalPrompt = getSetting('DEFAULT_ADDITIONAL_PROMPT', '');
    let fullPrompt = `${corePrompt}\nAdditional Instructions:\n${additionalPrompt}`;

    if (this.waifus.length > 0) {
      fullPrompt += `\nYou are the waifu of these people: ${this.waifus.join(', ')}`;
    }

    this.systemPrompt = fullPrompt;
  }

  /**
   * Add a message to history
   * @param {string} message - Message to add
   */
  addMessage(message) {
    this.messageHistory.push(message);

    const maxLength = getSetting('maxHistoryLength', 15);
    if (this.messageHistory.length > maxLength) {
      this.messageHistory.shift(); // Remove oldest message
    }
  }

  /**
   * Get message history as formatted string
   * @returns {string} - Joined message history
   */
  getMessageContext() {
    return this.messageHistory.join('\n');
  }

  /**
   * Clear message history
   */
  clearHistory() {
    this.messageHistory = [];
  }

  /**
   * Set maximum history length and trim if necessary
   * @param {number} length - New maximum length
   */
  setMaxHistoryLength(length) {
    setSetting('maxHistoryLength', length);
    saveSettings();

    // Trim existing history if needed
    while (this.messageHistory.length > length) {
      this.messageHistory.shift();
    }
  }

  /**
   * Add a waifu
   * @param {string} username - Username to add
   * @returns {boolean} - True if added, false if already exists
   */
  addWaifu(username) {
    if (!this.waifus.includes(username)) {
      this.waifus.push(username);
      setSetting('waifus', this.waifus);
      saveSettings();
      this.updateSystemPrompt();
      return true;
    }
    return false;
  }

  /**
   * Remove a waifu
   * @param {string} username - Username to remove
   * @returns {boolean} - True if removed, false if not found
   */
  removeWaifu(username) {
    const index = this.waifus.indexOf(username);
    if (index !== -1) {
      this.waifus.splice(index, 1);
      setSetting('waifus', this.waifus);
      saveSettings();
      this.updateSystemPrompt();
      return true;
    }
    return false;
  }

  /**
   * Check if user is a waifu
   * @param {string} username - Username to check
   * @returns {boolean} - True if waifu
   */
  isWaifu(username) {
    return this.waifus.includes(username);
  }

  /**
   * Get waifu list
   * @returns {string[]} - Array of waifu usernames
   */
  getWaifus() {
    return [...this.waifus];
  }

  /**
   * Update last bot mention time
   */
  updateLastMentionTime() {
    this.lastBotMentionTime = getTimestamp();
  }

  /**
   * Check if bot should send auto-message
   * @returns {boolean} - True if should send auto-message
   */
  shouldSendAutoMessage() {
    if (this.botPaused) return false;
    if (!getSetting('enableAutoMessages', false)) return false;

    const threshold = getSetting('inactivityThreshold', 1200000);
    if (!hasTimeElapsed(this.lastBotMentionTime, threshold)) return false;

    // Check if last message was from bot
    if (this.messageHistory.length > 0) {
      const lastMessage = this.messageHistory[this.messageHistory.length - 1];
      const botUsername = getSetting('username', 'bot').toLowerCase();
      if (lastMessage.toLowerCase().startsWith(`${botUsername}:`)) {
        console.log(MESSAGES.RECENT_MESSAGE_BY_BOT);
        this.updateLastMentionTime();
        return false;
      }
    }

    return true;
  }

  /**
   * Pause the bot
   */
  pauseBot() {
    this.botPaused = true;
  }

  /**
   * Resume the bot
   */
  resumeBot() {
    this.botPaused = false;
  }

  /**
   * Check if bot is paused
   * @returns {boolean} - True if paused
   */
  isPaused() {
    return this.botPaused;
  }

  /**
   * Increment quota usage
   * @returns {number} - New quota usage
   */
  incrementQuota() {
    this.quotaUsage++;
    setSetting('quotaUsage', this.quotaUsage);
    saveSettings();
    return this.quotaUsage;
  }

  /**
   * Reset quota usage
   */
  resetQuota() {
    this.quotaUsage = 0;
    setSetting('quotaUsage', 0);
    saveSettings();
  }

  /**
   * Check if quota is exceeded
   * @returns {boolean} - True if quota exceeded
   */
  isQuotaExceeded() {
    const limit = getSetting('quotaLimit', 10);
    return this.quotaUsage >= limit;
  }

  /**
   * Get current quota status
   * @returns {Object} - Quota status
   */
  getQuotaStatus() {
    return {
      usage: this.quotaUsage,
      limit: getSetting('quotaLimit', 10),
      exceeded: this.isQuotaExceeded()
    };
  }

  /**
   * Start the quota reset timer
   */
  startQuotaResetTimer() {
    if (this.quotaResetTimer) {
      clearInterval(this.quotaResetTimer);
    }

    this.quotaResetTimer = setInterval(() => {
      this.resetQuota();
      console.log('Image generation quota has been automatically reset');

      if (getSetting('enableQuotaNotification', false)) {
        // This will be handled by the caller since we don't have access to twitchClient here
        return true; // Signal that notification should be sent
      }
    }, CHECK_INTERVALS.QUOTA_RESET);
  }

  /**
   * Get system prompt
   * @returns {string} - Current system prompt
   */
  getSystemPrompt() {
    return this.systemPrompt;
  }

  /**
   * Set custom system prompt
   * @param {string} prompt - New system prompt
   */
  setSystemPrompt(prompt) {
    const { CORE_SYSTEM_PROMPT } = require('../config/constants');
    const corePrompt = CORE_SYSTEM_PROMPT(
      getSetting('username', 'bot'),
      getSetting('channel', 'channel')
    );

    this.systemPrompt = `${corePrompt}\nAdditional Instructions:\n${prompt}`;
    this.addWaifuSystemPrompt();
  }

  /**
   * Reset system prompt to default
   */
  resetSystemPrompt() {
    const defaultPrompt = getSetting('DEFAULT_ADDITIONAL_PROMPT', '');
    this.setSystemPrompt(defaultPrompt);
  }

  /**
   * Add waifu prompt to system prompt
   */
  addWaifuSystemPrompt() {
    if (this.waifus.length > 0) {
      this.systemPrompt += `\nYou are the waifu of these people: ${this.waifus.join(', ')}`;
    }
  }

  /**
   * Increment user response count
   * @param {string} username - Username to increment
   * @returns {number} - New count
   */
  incrementUserResponseCount(username) {
    const count = this.userResponseCounts.get(username) || 0;
    const newCount = count + 1;
    this.userResponseCounts.set(username, newCount);
    return newCount;
  }

  /**
   * Get user response count
   * @param {string} username - Username to check
   * @returns {number} - Current count
   */
  getUserResponseCount(username) {
    return this.userResponseCounts.get(username) || 0;
  }

  /**
   * Check if bot can respond to user
   * @param {string} username - Username to check
   * @returns {boolean} - True if can respond
   */
  canRespondToUser(username) {
    return this.getUserResponseCount(username) < 5;
  }

  /**
   * Check if this is the limit response for user
   * @param {string} username - Username to check
   * @returns {boolean} - True if this is the 5th response
   */
  isLimitResponse(username) {
    return this.getUserResponseCount(username) === 4;
  }

  /**
   * Reset all user response counts
   */
  resetUserResponseCounts() {
    this.userResponseCounts.clear();
    //console.log('User response counts have been reset');
  }

  /**
   * Start the user response reset timer
   */
  startUserResponseResetTimer() {
    if (this.userResponseResetTimer) {
      clearInterval(this.userResponseResetTimer);
    }

    this.userResponseResetTimer = setInterval(() => {
      this.resetUserResponseCounts();
    }, CHECK_INTERVALS.USER_RESPONSE_RESET);
  }

  /**
   * Get state summary for debugging
   * @returns {Object} - State summary
   */
  getStateSummary() {
    return {
      messageHistoryLength: this.messageHistory.length,
      waifus: this.waifus,
      quotaUsage: this.quotaUsage,
      botPaused: this.botPaused,
      lastMentionTime: new Date(this.lastBotMentionTime).toISOString(),
      userResponseCounts: Object.fromEntries(this.userResponseCounts)
    };
  }
}

module.exports = BotState;
