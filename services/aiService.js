const axios = require('axios');
const { OpenAI } = require('openai');
const { toFile } = require('openai');
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
        // Download images from URLs and create file objects
        const imageFiles = [];
        for (const url of urls) {
          try {
            const imageResponse = await axios.get(url, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(imageResponse.data, 'binary');
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
