const axios = require('axios');
const { OpenAI } = require('openai');
const { getSetting } = require('../config/settings');
const { cleanResponse } = require('../utils/helpers');

class AIService {
  constructor() {
    this.openai = null;
  }

  ensureOpenAIInitialized() {
    if (!this.openai) {
      const apiKey = getSetting('openaiApiKey');
      if (apiKey) {
        this.openai = new OpenAI({
          apiKey: apiKey,
        });
      }
    }
  }

  /**
   * Get chat response from AI (OpenAI or Ollama)
   * @param {string} userMessage - The user's message
   * @param {string} context - Chat context
   * @param {string} prompt - System prompt
   * @returns {Promise<string>} - AI response
   */
  async getChatResponse(userMessage, context, prompt) {
    if (getSetting('useOpenAI')) {
      return this.getOpenAIResponse(userMessage, context, prompt);
    } else {
      return this.getOllamaResponse(userMessage, context, prompt);
    }
  }

  /**
   * Get response from OpenAI API
   * @param {string} userMessage - The user's message
   * @param {string} context - Chat context
   * @param {string} prompt - System prompt
   * @returns {Promise<string>} - OpenAI response
   */
  async getOpenAIResponse(userMessage, context, prompt) {
    this.ensureOpenAIInitialized();
    if (!this.openai) {
      throw new Error('OpenAI client not initialized - no API key provided');
    }



    try {
      const response = await this.openai.chat.completions.create({
        model: getSetting('openaiModelName', 'gpt-4o-mini'),
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: `Context:\n${context}\n\nUser: ${userMessage}\nBot:` },
        ],
        max_tokens: 150,
      });
      return cleanResponse(response.choices[0].message.content);
    } catch (error) {
      console.error('Error calling OpenAI API:', error);
      throw new Error('Sorry, I encountered an error while generating a response.');
    }
  }

  /**
   * Get response from Ollama API
   * @param {string} userMessage - The user's message
   * @param {string} context - Chat context
   * @param {string} prompt - System prompt
   * @returns {Promise<string>} - Ollama response
   */
  async getOllamaResponse(userMessage, context, prompt) {
    try {
      const response = await axios.post(getSetting('ollamaApiUrl'), {
        model: getSetting('ollamaModelName', 'llama3.2'),
        prompt: `Context:\n${context}\n\nUser: ${userMessage}\nBot:`,
        system: prompt,
        stream: false,
      });
      return cleanResponse(response.data.response);
    } catch (error) {
      console.error('Error calling Ollama API:', error);
      throw new Error('Sorry, I encountered an error while generating a response.');
    }
  }

  /**
   * Generate an image using DALL-E
   * @param {string} prompt - Image generation prompt
   * @returns {Promise<Object>} - Image generation result
   */
  async generateImage(prompt) {
    this.ensureOpenAIInitialized();
    if (!this.openai) {
      throw new Error('OpenAI client not initialized - no API key provided');
    }

    try {
      const response = await this.openai.images.generate({
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: getSetting('imageSize', '1024x1024'),
        quality: getSetting('imageQuality', 'standard'),
        response_format: 'url'
      });

      return {
        success: true,
        url: response.data[0].url
      };
    } catch (error) {
      console.error('Image generation error:', error);

      let errorType = 'general';
      if (error.response?.data?.error?.code === 'content_policy_violation') {
        errorType = 'content_policy';
      }

      return {
        success: false,
        error: errorType,
        message: error.message
      };
    }
  }

  /**
   * Generate image prompt from chat context
   * @param {string[]} messageHistory - Recent chat messages
   * @returns {Promise<string>} - Generated prompt
   */
  async generatePromptFromContext(messageHistory) {
    this.ensureOpenAIInitialized();
    if (!this.openai) {
      throw new Error('OpenAI client not initialized - no API key provided');
    }

    const context = messageHistory.slice(-15).join('\n');

    try {
      const promptResponse = await this.openai.chat.completions.create({
        model: getSetting('openaiModelName', 'gpt-4o-mini'),
        messages: [
          {
            role: 'system',
            content: `Generate a concise DALL-E 3 prompt based on recent chat context. Focus on visual elements and key themes. Respond ONLY with the prompt. Format: "Vibrant [style] of [subject], [details], [medium/art style]"`
          },
          {
            role: 'user',
            content: `Recent chat (latest first):\n${context}\n\nVisual concept:`
          }
        ],
        max_tokens: 300,
        temperature: 0.7
      });

      return cleanResponse(promptResponse.choices[0].message.content);
    } catch (error) {
      console.error('Error generating prompt from context:', error);
      throw error;
    }
  }
}

module.exports = new AIService();
