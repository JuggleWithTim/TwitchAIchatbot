const { MESSAGES } = require('../config/constants');

/**
 * Sanitize Twitch links to prevent accidental punctuation after URLs
 * @param {string} msg - The message containing potential links
 * @returns {string} - The sanitized message
 */
function sanitizeTwitchLinks(msg) {
  return msg.replace(/(https:\/\/twitch\.tv\/[a-zA-Z0-9_]+)([.,!?)])/g, '$1 $2');
}

/**
 * Format a mention for Twitch chat
 * @param {string} username - The username to mention
 * @returns {string} - The formatted mention
 */
function formatMention(username) {
  return `@${username}`;
}

/**
 * Check if a user has broadcaster or moderator privileges
 * @param {Object} tags - Twitch message tags
 * @param {string} juggleWithTimUsername - Special username to check
 * @returns {boolean} - Whether the user has elevated privileges
 */
function hasElevatedPrivileges(tags, juggleWithTimUsername = 'jugglewithtim') {
  const isBroadcaster = tags.badges?.broadcaster === '1';
  const isModerator = tags.badges?.moderator === '1';
  const isJuggleWithTim = tags.username.toLowerCase() === juggleWithTimUsername.toLowerCase();
  return isBroadcaster || isModerator || isJuggleWithTim;
}

/**
 * Extract command arguments from a message
 * @param {string} message - The full message
 * @param {string} command - The command prefix
 * @returns {string} - The arguments after the command
 */
function extractCommandArgs(message, command) {
  return message.slice(command.length).trim();
}

/**
 * Parse a number from a string with validation
 * @param {string} str - The string to parse
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @returns {number|null} - The parsed number or null if invalid
 */
function parseNumber(str, min = null, max = null) {
  const num = parseInt(str, 10);
  if (isNaN(num)) return null;
  if (min !== null && num < min) return null;
  if (max !== null && num > max) return null;
  return num;
}

/**
 * Convert minutes to milliseconds
 * @param {number} minutes - Number of minutes
 * @returns {number} - Milliseconds
 */
function minutesToMs(minutes) {
  return minutes * 60 * 1000;
}

/**
 * Convert milliseconds to minutes
 * @param {number} ms - Milliseconds
 * @returns {number} - Minutes
 */
function msToMinutes(ms) {
  return Math.round(ms / (60 * 1000));
}

/**
 * Clean response text by removing think tags and trimming
 * @param {string} response - The response to clean
 * @returns {string} - The cleaned response
 */
function cleanResponse(response) {
  if (!response) return '';
  return response.replace(/<think[^>]*>([\s\S]*?)<\/think>/gi, '').trim();
}

/**
 * Generate a random filename with prefix
 * @param {string} prefix - The prefix for the filename
 * @returns {string} - The generated filename
 */
function generateFilename(prefix = '') {
  return `${prefix}_${Date.now()}.png`;
}

/**
 * Check if a message starts with any of the given commands
 * @param {string} message - The message to check
 * @param {string[]} commands - Array of command strings
 * @returns {boolean} - Whether the message starts with any command
 */
function startsWithAny(message, commands) {
  return commands.some(cmd => message.toLowerCase().startsWith(cmd + ' '));
}

/**
 * Get the current timestamp
 * @returns {number} - Current timestamp in milliseconds
 */
function getTimestamp() {
  return Date.now();
}

/**
 * Check if enough time has passed since a given timestamp
 * @param {number} lastTime - The last timestamp
 * @param {number} threshold - The time threshold in milliseconds
 * @returns {boolean} - Whether enough time has passed
 */
function hasTimeElapsed(lastTime, threshold) {
  return getTimestamp() - lastTime >= threshold;
}

module.exports = {
  sanitizeTwitchLinks,
  formatMention,
  hasElevatedPrivileges,
  extractCommandArgs,
  parseNumber,
  minutesToMs,
  msToMinutes,
  cleanResponse,
  generateFilename,
  startsWithAny,
  getTimestamp,
  hasTimeElapsed
};
