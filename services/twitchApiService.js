const axios = require('axios');
const { getSetting } = require('../config/settings');
const { API_ENDPOINTS } = require('../config/constants');

class TwitchApiService {
  constructor() {
    this.appToken = null;
    this.tokenExpiry = 0;
  }

  /**
   * Get or refresh Twitch app access token
   * @returns {Promise<string>} - Access token
   */
  async getAppToken() {
    if (this.appToken && Date.now() < this.tokenExpiry) {
      return this.appToken;
    }

    try {
      const response = await axios.post(API_ENDPOINTS.TWITCH_TOKEN, null, {
        params: {
          client_id: getSetting('twitchClientId'),
          client_secret: getSetting('twitchClientSecret'),
          grant_type: 'client_credentials'
        }
      });

      this.appToken = response.data.access_token;
      // expires_in is in seconds, convert to milliseconds and subtract 60 seconds for buffer
      this.tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;

      return this.appToken;
    } catch (error) {
      console.error('Error getting Twitch app token:', error);
      throw error;
    }
  }

  /**
   * Get user information from Twitch API
   * @param {string} username - Twitch username
   * @returns {Promise<Object|null>} - User data or null if not found
   */
  async fetchUser(username) {
    try {
      const token = await this.getAppToken();
      const response = await axios.get(API_ENDPOINTS.TWITCH_USERS, {
        params: { login: username },
        headers: {
          'Client-ID': getSetting('twitchClientId'),
          'Authorization': `Bearer ${token}`
        }
      });

      return response.data.data[0] || null;
    } catch (error) {
      console.error('Error fetching Twitch user:', error);
      return null;
    }
  }

  /**
   * Get latest stream information for a user
   * @param {string} userId - Twitch user ID
   * @returns {Promise<Object|null>} - Stream data or null
   */
  async fetchLatestStream(userId) {
    try {
      const token = await this.getAppToken();

      // 1. Check if currently live
      const streamResponse = await axios.get(API_ENDPOINTS.TWITCH_STREAMS, {
        params: { user_id: userId, first: 1 },
        headers: {
          'Client-ID': getSetting('twitchClientId'),
          'Authorization': `Bearer ${token}`
        }
      });

      let streamData = streamResponse.data.data[0];
      if (streamData) {
        return this.normalizeStreamData(streamData, userId, token);
      }

      // 2. Get last archived stream
      const videosResponse = await axios.get(API_ENDPOINTS.TWITCH_VIDEOS, {
        params: { user_id: userId, first: 1, type: 'archive' },
        headers: {
          'Client-ID': getSetting('twitchClientId'),
          'Authorization': `Bearer ${token}`
        }
      });

      let lastStream = videosResponse.data.data[0];
      if (lastStream) {
        return await this.normalizeStreamData(lastStream, userId, token);
      }

      // 3. No content found
      return null;
    } catch (error) {
      console.error('Error fetching latest stream:', error);
      return null;
    }
  }

  /**
   * Normalize stream data from different API endpoints
   * @param {Object} streamData - Raw stream data
   * @param {string} userId - User ID
   * @param {string} token - Access token
   * @returns {Promise<Object|null>} - Normalized stream data
   */
  async normalizeStreamData(streamData, userId, token) {
    if (!streamData) return null;

    if ('started_at' in streamData) {
      // Live stream data
      return {
        title: streamData.title,
        game_name: streamData.game_name,
        tags: streamData.tags || [],
        started_at: streamData.started_at,
        isLive: true
      };
    } else if ('created_at' in streamData) {
      // Video/archive data
      let gameName = null;

      // Get game name from game_id if available
      if (streamData.game_id && streamData.game_id !== '0') {
        try {
          const gameResponse = await axios.get(API_ENDPOINTS.TWITCH_GAMES, {
            params: { id: streamData.game_id },
            headers: {
              'Client-ID': getSetting('twitchClientId'),
              'Authorization': `Bearer ${token}`
            }
          });
          gameName = gameResponse.data.data[0]?.name || null;
        } catch (error) {
          console.error('Error fetching game data:', error);
        }
      }

      return {
        title: streamData.title,
        game_name: gameName,
        tags: [], // Videos endpoint doesn't provide tags
        started_at: streamData.created_at,
        isLive: false
      };
    }

    // Unknown data type
    return null;
  }

  /**
   * Generate shoutout information for a user
   * @param {string} targetUsername - Username to shoutout
   * @param {string[]} messageHistory - Chat message history for context
   * @returns {Promise<Object>} - Shoutout data
   */
  async generateShoutout(targetUsername, messageHistory) {
    const cleanUsername = targetUsername.replace(/^@/, '');
    console.log(`Fetching user data for: ${cleanUsername}`);

    try {
      const user = await this.fetchUser(cleanUsername);
      console.log('User fetch result:', user ? `Found ${user.display_name}` : 'User not found');

      if (!user) {
        return {
          success: false,
          message: `Couldn't find a user called "${cleanUsername}". 👻`
        };
      }

      console.log(`Fetching stream data for user ID: ${user.id}`);
      const latestStream = await this.fetchLatestStream(user.id);
      console.log('Stream fetch result:', latestStream ? `Found stream: ${latestStream.title}` : 'No stream found');

      // Build context for AI
      let soContext = `About @${user.display_name} (${user.login}):\n`;
      if (user.description) {
        soContext += `Bio: ${user.description}\n`;
      }
      soContext += `Twitch Profile: https://twitch.tv/${user.login}\n`;

      if (latestStream) {
        soContext += `Most recent stream title: "${latestStream.title}"\n`;
        soContext += `Game: ${latestStream.game_name || "Unknown"}\n`;

        if (latestStream.tags && latestStream.tags.length) {
          soContext += `Tags: ${latestStream.tags.join(", ")}\n`;
        }

        if (latestStream.isLive) {
          soContext += `Status: Currently LIVE! Stream started at ${latestStream.started_at}\n`;
        } else {
          soContext += `Status: Currently offline. Last stream was at ${latestStream.started_at}\n`;
        }
      } else {
        soContext += `Status: No recent streams found.\n`;
      }

      return {
        success: true,
        user: user,
        context: soContext,
        latestStream: latestStream
      };
    } catch (error) {
      console.error('Shoutout generation error:', error);
      return {
        success: false,
        message: `Couldn't shoutout "${cleanUsername}" (maybe invalid name or rate-limited).`
      };
    }
  }
}

module.exports = new TwitchApiService();
