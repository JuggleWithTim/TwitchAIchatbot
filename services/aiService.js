const axios = require('axios');
const { OpenAI } = require('openai');
const { toFile } = require('openai');
const { getSetting } = require('../config/settings');
const { cleanResponse } = require('../utils/helpers');

// Security constants for image downloads
const IMAGE_DOWNLOAD_CONFIG = {
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  TIMEOUT: 10000, // 10 seconds
  ALLOWED_SCHEMES: ['http:', 'https:'],
  ALLOWED_CONTENT_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  BLOCKED_HOSTS: [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254', // AWS metadata
    'metadata.google.internal', // GCP metadata
    '169.254.170.2', // Azure IMDS
  ]
};

class AIService {
  constructor() {
    this.openai = null;
  }

  /**
   * Validate if a URL is safe for image downloading
   * @param {string} url - URL to validate
   * @returns {boolean} - True if URL is safe
   */
  validateImageUrl(url) {
    try {
      const parsedUrl = new URL(url);

      // Check scheme
      if (!IMAGE_DOWNLOAD_CONFIG.ALLOWED_SCHEMES.includes(parsedUrl.protocol)) {
        return false;
      }

      // Check blocked hosts
      if (IMAGE_DOWNLOAD_CONFIG.BLOCKED_HOSTS.includes(parsedUrl.hostname)) {
        return false;
      }

      // Check for private IP ranges
      const hostname = parsedUrl.hostname;
      if (/^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/.test(hostname)) {
        return false; // Private IP ranges
      }

      // Check for localhost equivalents
      if (/^127\.|0\.0\.0\.|localhost/i.test(hostname)) {
        return false;
      }

      return true;
    } catch (error) {
      // Invalid URL format
      return false;
    }
  }

  /**
   * Securely download an image from a URL with validation and limits
   * @param {string} url - Image URL to download
   * @returns {Promise<Buffer>} - Image buffer
   */
  async downloadImageSecurely(url) {
    // Validate URL first
    if (!this.validateImageUrl(url)) {
      throw new Error('Invalid or unsafe URL');
    }

    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: IMAGE_DOWNLOAD_CONFIG.TIMEOUT,
        maxContentLength: IMAGE_DOWNLOAD_CONFIG.MAX_SIZE,
        maxRedirects: 5,
        headers: {
          'User-Agent': 'TwitchAIchatbot/1.0',
          'Accept': 'image/*'
        },
        validateStatus: (status) => status >= 200 && status < 300
      });

      // Validate content type
      const contentType = response.headers['content-type']?.toLowerCase();
      if (!contentType || !IMAGE_DOWNLOAD_CONFIG.ALLOWED_CONTENT_TYPES.some(type => contentType.includes(type))) {
        throw new Error('Invalid content type - only images allowed');
      }

      // Additional size check (axios maxContentLength might not be exact)
      if (response.data.length > IMAGE_DOWNLOAD_CONFIG.MAX_SIZE) {
        throw new Error('Image too large');
      }

      return Buffer.from(response.data, 'binary');
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('Download timeout');
      }
      if (error.response?.status === 404) {
        throw new Error('Image not found');
      }
      if (error.response?.status === 403) {
        throw new Error('Access denied to image');
      }
      throw error;
    }
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
   * Generate an image using DALL-E or GPT Image 1
   * @param {string} prompt - Image generation prompt
   * @returns {Promise<Object>} - Image generation result
   */
  async generateImage(prompt) {
    this.ensureOpenAIInitialized();
    if (!this.openai) {
      throw new Error('OpenAI client not initialized - no API key provided');
    }

    const model = getSetting('imageGenerationModel', 'dall-e-3');

    if (model === 'dall-e-3') {
      return this.generateImageDalle(prompt);
    } else if (model === 'gpt-image-1-mini') {
      return this.generateImageGPTImage1(prompt);
    } else {
      throw new Error(`Unsupported image generation model: ${model}`);
    }
  }

  /**
   * Generate an image using DALL-E 3
   * @param {string} prompt - Image generation prompt
   * @returns {Promise<Object>} - Image generation result
   */
  async generateImageDalle(prompt) {
    try {
      const response = await this.openai.images.generate({
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: getSetting('imageSize', '1024x1024'),
        quality: 'standard',
        response_format: 'url'
      });

      return {
        success: true,
        url: response.data[0].url
      };
    } catch (error) {
      console.error('DALL-E image generation error:', error);

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
   * Generate an image using GPT Image 1
   * @param {string} prompt - Image generation prompt
   * @returns {Promise<Object>} - Image generation result
   */
  async generateImageGPTImage1(prompt) {
    try {
      // Parse URLs from prompt
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const urls = prompt.match(urlRegex) || [];
      const cleanPrompt = prompt.replace(urlRegex, '').trim();

      // Prevent generation with empty prompt and no URLs
      if (!cleanPrompt && urls.length === 0) {
        return { success: false, error: 'general', message: 'Empty prompt' };
      }

      // For GPT Image 1, use Image API similar to DALL-E but with different model
      if (urls.length > 0) {
        // Download images from URLs securely and create file objects
        const imageFiles = [];
        for (const url of urls) {
          try {
            const buffer = await this.downloadImageSecurely(url);
            // Create a file object using OpenAI's toFile helper
            const file = await toFile(buffer, `image_${Date.now()}.png`, {
              type: 'image/png'
            });
            imageFiles.push(file);
          } catch (downloadError) {
            console.error(`Failed to download image from ${url}:`, downloadError.message);
            // Skip this URL and continue with others
          }
        }

        if (imageFiles.length === 0) {
          return { success: false, error: 'general', message: 'Failed to download any reference images' };
        }

        // Use edit endpoint for images with references
        const response = await this.openai.images.edit({
          model: 'gpt-image-1-mini',
          image: imageFiles,
          prompt: cleanPrompt,
          n: 1,
          size: getSetting('imageSize', '1024x1024'),
          quality: getSetting('imageQuality', 'medium')
        });

        return {
          success: true,
          data: response.data[0].b64_json
        };
      } else {
        // Use generate endpoint for text-only prompts
        const response = await this.openai.images.generate({
          model: 'gpt-image-1-mini',
          prompt: cleanPrompt,
          n: 1,
          size: getSetting('imageSize', '1024x1024'),
          quality: getSetting('imageQuality', 'medium')
        });

        return {
          success: true,
          data: response.data[0].b64_json
        };
      }
    } catch (error) {
      console.error('GPT Image 1 generation error:', error);

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
            content: `Generate a concise image generation prompt based on recent chat context. Focus on visual elements and key themes. Respond ONLY with the prompt. Format: "Vibrant [style] of [subject], [details], [medium/art style]"`
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
