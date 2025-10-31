const axios = require('axios');
const { OpenAI } = require('openai');
const { toFile } = require('openai');
const { getSetting } = require('../config/settings');
const { cleanResponse } = require('../utils/helpers');
const memoryService = require('./memoryService');

// Security constants for image downloads
const IMAGE_DOWNLOAD_CONFIG = {
  MAX_SIZE: 20 * 1024 * 1024, // 20MB
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
   * Create a GPT-5 response using the Responses API
   * @param {string} input - Input text
   * @param {string} reasoningEffort - Reasoning effort level
   * @param {string} verbosity - Output verbosity level
   * @returns {Promise<Object>} - GPT-5 response
   */
  async createGPT5Response(input, reasoningEffort = 'minimal', verbosity = 'low') {
    this.ensureOpenAIInitialized();
    if (!this.openai) {
      throw new Error('OpenAI client not initialized - no API key provided');
    }

    try {
      const response = await this.openai.responses.create({
        model: 'gpt-5-nano',
        input: input,
        reasoning: { effort: reasoningEffort },
        text: { verbosity: verbosity },
        max_output_tokens: 500
      });

      return {
        success: true,
        output: response.output_text,
        reasoning: response.reasoning_items
      };
    } catch (error) {
      console.error('GPT-5 API error:', error);
      return {
        success: false,
        error: error.message,
        fallback: true
      };
    }
  }

  /**
   * Extract memory information using the appropriate AI model
   * @param {string} extractionPrompt - The prompt for memory extraction
   * @returns {Promise<Object>} - Parsed memory information object
   */
  async extractMemoryWithAI(extractionPrompt) {
    this.ensureOpenAIInitialized();
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    // Always try GPT-5-nano first for cost optimization, fallback to settings model
    let extractedText;

    const gpt5Response = await this.createGPT5Response(extractionPrompt, 'minimal', 'low');
    if (gpt5Response.success) {
      extractedText = cleanResponse(gpt5Response.output);
    } else {
      // Fallback to settings model if GPT-5 fails
      console.log('Memory extraction: GPT-5-nano failed, falling back to settings model');
      const extractionResponse = await this.openai.chat.completions.create({
        model: getSetting('openaiModelName', 'gpt-4o-mini'),
        messages: [
          {
            role: 'system',
            content: 'You are a memory extraction assistant. Analyze conversations and extract structured information for long-term storage. Only extract genuinely new information that would be valuable to remember. Respond with valid JSON only.'
          },
          {
            role: 'user',
            content: extractionPrompt
          }
        ],
        max_tokens: 500,
        temperature: 0.3
      });
      extractedText = cleanResponse(extractionResponse.choices[0].message.content);
    }

    // Parse the JSON response
    try {
      // Clean up the response to ensure it's valid JSON
      const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      } else {
        return JSON.parse(extractedText);
      }
    } catch (parseError) {
      console.error('Failed to parse memory extraction response:', extractedText);
      return {}; // Return empty object on parse error
    }
  }

  /**
   * Get chat response from AI (OpenAI or Ollama) with optional memory integration
   * @param {string} userMessage - The user's message
   * @param {string} context - Chat context
   * @param {string} prompt - System prompt
   * @param {string} userId - User identifier for memory
   * @returns {Promise<Object>} - AI response with memory info
   */
  async getChatResponse(userMessage, context, prompt, userId = 'default_user') {
    const memoryEnabled = getSetting('enableMemory') == 1;

    let memoryContext = '';
    let finalPrompt = prompt;

    if (memoryEnabled) {
      // Step 1: Memory Retrieval - Always start by retrieving memory
      try {
        const memoryData = await memoryService.retrieveMemory(userId);
        if (memoryData && memoryData.entities && memoryData.entities.length > 0) {
          // Format memory data for the AI
          const formattedMemory = {
            entities: memoryData.entities,
            relations: memoryData.relations
          };
          memoryContext = `\n\nMemory Context:\n${JSON.stringify(formattedMemory, null, 2)}`;
        }
      } catch (error) {
        console.error('Error retrieving memory:', error);
      }

      // Create enhanced prompt with memory instructions
      finalPrompt = `${prompt}

MEMORY INSTRUCTIONS:
Follow these steps for each interaction:

1. User Identification:
   - You are interacting with ${userId}
   - If you have not identified ${userId}, proactively try to do so.

2. Memory Retrieval:
   - You have access to the knowledge graph below as your memory
   - Use this information to personalize your responses

3. Memory Categories:
   - While conversing, be attentive to new information in these categories:
     a) Basic Identity (age, gender, location, job title, education level, etc.)
     b) Behaviors (interests, habits, etc.)
     c) Preferences (communication style, preferred language, etc.)
     d) Goals (goals, targets, aspirations, etc.)
     e) Relationships (personal and professional relationships up to 3 degrees of separation)

4. Memory Update:
   - If any new information was gathered, it will be stored in your memory for future interactions.
   - Create entities for recurring organizations, people, and significant events
   - Connect them using appropriate relations
   - Store facts as observations
   ${memoryContext}`;
    }

    let response;
    if (getSetting('useOpenAI')) {
      response = await this.getOpenAIResponse(userMessage, context, finalPrompt);
    } else {
      response = await this.getOllamaResponse(userMessage, context, finalPrompt);
    }

    // Step 3: Memory Update - Extract and store new information (only if memory is enabled)
    if (memoryEnabled) {
      try {
        await this.updateMemoryFromResponse(userMessage, response, userId);
      } catch (error) {
        console.error('Error updating memory:', error);
      }
    }

    return {
      response: response,
      memoryRetrieved: !!memoryContext
    };
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
   * Extract and update memory from user's message only
   * @param {string} userMessage - User's message
   * @param {string} botResponse - Bot's response (not used for extraction)
   * @param {string} userId - User identifier
   */
  async updateMemoryFromResponse(userMessage, botResponse, userId = 'default_user') {
    try {
      // Build the extraction prompt
      const extractionPrompt = `Analyze what this user said and extract any new information that falls into these categories:
- Basic Identity (age, gender, location, job title, education level, etc.)
- Behaviors (interests, habits, etc.)
- Preferences (communication style, preferred language, etc.)
- Goals (goals, targets, aspirations, etc.)
- Relationships (personal and professional relationships up to 3 degrees of separation)

IMPORTANT: Only extract information that the user actually provided about themselves or others. Do NOT extract information that appears to be what the bot knows or is telling the user.

Format your response as a JSON object with these possible keys:
{
  "identity": ["fact1", "fact2"],
  "behaviors": ["behavior1", "behavior2"],
  "preferences": ["preference1", "preference2"],
  "goals": ["goal1", "goal2"],
  "relationships": [
    {
      "entity": "entity_name",
      "entityType": "person|organization|event",
      "relationType": "works_at|friends_with|family_of|etc",
      "observations": ["fact about entity"]
    }
  ]
}

Only include categories that have new information from the user's message. If no new information, return empty object {}.

User's message: ${userMessage}`;

      // Use shared helper method for AI extraction
      const newInfo = await this.extractMemoryWithAI(extractionPrompt);

      // Only update if there's actual new information
      if (Object.keys(newInfo).length > 0) {
        console.log('Updating memory with new information:', newInfo);
        await memoryService.updateMemory(userId, newInfo);
      }

    } catch (error) {
      console.error('Error updating memory from response:', error);
    }
  }

  /**
   * Extract memory from any user message (passive learning)
   * @param {string} userMessage - User's message
   * @param {string} userId - User identifier
   */
  async extractMemoryFromMessage(userMessage, userId = 'default_user') {
    const memoryEnabled = getSetting('enableMemory') == 1;
    const passiveLearningEnabled = getSetting('enablePassiveLearning') == 1;

    // Only extract if both memory and passive learning are enabled
    if (!memoryEnabled || !passiveLearningEnabled) {
      return;
    }

    try {
      // Build the extraction prompt
      const extractionPrompt = `Analyze what this user said and extract any new information that falls into these categories:
- Basic Identity (age, gender, location, job title, education level, etc.)
- Behaviors (interests, habits, etc.)
- Preferences (communication style, preferred language, etc.)
- Goals (goals, targets, aspirations, etc.)
- Relationships (personal and professional relationships up to 3 degrees of separation)

IMPORTANT: Only extract information that the user actually provided about themselves or others. Do NOT extract information that appears to be what the bot knows or is telling the user.

Format your response as a JSON object with these possible keys:
{
  "identity": ["fact1", "fact2"],
  "behaviors": ["behavior1", "behavior2"],
  "preferences": ["preference1", "preference2"],
  "goals": ["goal1", "goal2"],
  "relationships": [
    {
      "entity": "entity_name",
      "entityType": "person|organization|event",
      "relationType": "works_at|friends_with|family_of|etc",
      "observations": ["fact about entity"]
    }
  ]
}

Only include categories that have new information from the user's message. If no new information, return empty object {}.

User's message: ${userMessage}`;

      // Use shared helper method for AI extraction
      const newInfo = await this.extractMemoryWithAI(extractionPrompt);

      // Only update if there's actual new information
      if (Object.keys(newInfo).length > 0) {
        console.log('Passive learning: Updating memory with new information:', newInfo);
        await memoryService.updateMemory(userId, newInfo);
      }

    } catch (error) {
      console.error('Error in passive memory extraction:', error);
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
