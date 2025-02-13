// Import required libraries
const tmi = require('tmi.js'); // Twitch chat client
const axios = require('axios'); // For making HTTP requests to Ollama
const { OpenAI } = require('openai'); // OpenAI Node.js module

// === USER SETTINGS === //
const SETTINGS = {
  // Twitch bot credentials
  username: 'botusername', // Replace with your bot's Twitch username
  password: 'oauth:00000000000000000000', // Replace with your bot's OAuth token (get it from https://twitchtokengenerator.com/)
  channel: 'channelname', // Replace with the channel name where the bot will join

  // API settings
  useOpenAI: false, // Set to true to use OpenAI, false to use Ollama
  ollamaApiUrl: 'http://localhost:11434/api/generate', // Ollama API endpoint
  ollamaModelName: 'llama3.2', // Ollama model to use
  openaiApiKey: '0000000000000000000000', // Replace with your OpenAI API key
  openaiModelName: 'gpt-4o-mini', // OpenAI model to use (e.g., gpt-3.5-turbo, gpt-4o-mini, gpt-4o)

  // Default behavior settings (can be changed during runtime using commands)
  maxHistoryLength: 15, // Number of messages to keep in history
  inactivityThreshold: 10 * 60 * 1000, // 10 minutes in milliseconds (time before sending an auto-message)
  fallbackMessage: 'Ooooops, something went wrong', // If the response ends up empty, reply with this instead.
  enableAutoMessages: true, // Set to false to disable auto-messages
};

// === SYSTEM PROMPTS === //
const DEFAULT_SYSTEM_PROMPT = `
You are @botusername, a friendly and goofy Twitch chatbot.
Keep your responses concise and engaging.
You can not send messages longer than 423 characters.
Your mission is to interact with the chat like you are a natural part of the conversation.
`;

let SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;  // Initialize default system prompt

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: SETTINGS.openaiApiKey,
});

// Twitch bot configuration
const twitchClient = new tmi.Client({
  options: { debug: true }, // Enable debugging
  identity: {
    username: SETTINGS.username,
    password: SETTINGS.password,
  },
  channels: [SETTINGS.channel],
});

// Message history array to store recent chat messages
let messageHistory = [];

// Timer to track inactivity
let lastBotMentionTime = Date.now();

// Flag to track if the bot is paused
let botPaused = false;

// Function to call Ollama or OpenAI API
async function getChatResponse(userMessage, context, prompt = SYSTEM_PROMPT) {
  if (SETTINGS.useOpenAI) {
    // Use OpenAI API
    try {
      const response = await openai.chat.completions.create({
        model: SETTINGS.openaiModelName,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: `Context:\n${context}\n\nUser: ${userMessage}\nBot:` },
        ],
        max_tokens: 100, // Limit the response length
      });
      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error calling OpenAI API:', error);
      return 'Sorry, I encountered an error while generating a response.';
    }
  } else {
    // Use Ollama API
    try {
      const response = await axios.post(SETTINGS.ollamaApiUrl, {
        model: SETTINGS.ollamaModelName,
        prompt: `Context:\n${context}\n\nUser: ${userMessage}\nBot:`,
        system: prompt,
        stream: false,
      });
      return response.data.response.trim();
    } catch (error) {
      console.error('Error calling Ollama API:', error);
      return 'Sorry, I encountered an error while generating a response.';
    }
  }
}

// Function to send a message based on the message history
async function sendAutoMessage(channel) {
  // Get the most recent message from the history
  const mostRecentMessage = messageHistory[messageHistory.length - 1];

  // Check if the most recent message was sent by the bot
  const botUsername = twitchClient.getUsername().toLowerCase();
  if (mostRecentMessage && mostRecentMessage.toLowerCase().startsWith(`${botUsername}:`)) {
    console.log('Most recent message was sent by the bot. Skipping auto-message.');
    return;
  }

  // Don't send auto-messages if the bot is paused, auto-messages are disabled, or there’s no message history
  if (botPaused || messageHistory.length === 0 || !SETTINGS.enableAutoMessages) {
    return;
  }

  // Get the recent conversation context
  const context = messageHistory.join('\n');

  // Generate a message based on the context
  let response = await getChatResponse('Please respond to the chat as if you are a part of the conversation', context);

  // Remove <think> tags (including content) from the response
  response = response.replace(/<think[^>]*>([\s\S]*?)<\/think>/gi, '').trim();

  // If the response is empty, send a default message
  if (!response) {
    response = SETTINGS.fallbackMessage;
  }

  // Send the message to the chat
  twitchClient.say(channel, `${response}`);

  // Add the bot's message to history
  messageHistory.push(`${SETTINGS.username}: ${response}`);

  // Update the last mention time
  lastBotMentionTime = Date.now();
}

// Event listener for Twitch chat messages
twitchClient.on('message', async (channel, tags, message, self) => {
  // Ignore messages from the bot itself
  if (self) return;

  // Add the message to the history
  messageHistory.push(`${tags.username}: ${message}`);

  // Keep the history within the specified limit
  if (messageHistory.length > SETTINGS.maxHistoryLength) {
    messageHistory.shift(); // Remove the oldest message
  }

  // Check if the sender is a broadcaster, moderator, or JuggleWithTim
  const isBroadcaster = tags.badges?.broadcaster === '1';
  const isModerator = tags.badges?.moderator === '1';
  const isJuggleWithTim = tags.username.toLowerCase() === 'jugglewithtim'; // Check if the sender is JuggleWithTim

  // === COMMAND HANDLING === //
  // Command: !aiauto - Toggle auto-messages on or off
  if (message.toLowerCase() === '!aiauto' && (isBroadcaster || isModerator || isJuggleWithTim)) {
    SETTINGS.enableAutoMessages = !SETTINGS.enableAutoMessages; // Toggle the state
    const statusMessage = SETTINGS.enableAutoMessages ? 'Auto-messages are now enabled. 🟢' : 'Auto-messages are now disabled. 🔴';
    twitchClient.say(channel, statusMessage);
    messageHistory.push(`${SETTINGS.username}: ${statusMessage}`);
    return;
  }

  // Command: !aitimer <minutes> - Set inactivity timer
  if (message.toLowerCase().startsWith('!aitimer ') && (isBroadcaster || isModerator || isJuggleWithTim)) {
    const minutes = parseInt(message.split(' ')[1], 10); // Extract the number of minutes
    if (isNaN(minutes) || minutes < 1) {
      twitchClient.say(channel, 'Please provide a valid number of minutes (e.g., !aitimer 30). ❌');
      messageHistory.push(`${SETTINGS.username}: Invalid input for !aitimer. ❌`);
    } else {
      SETTINGS.inactivityThreshold = minutes * 60 * 1000; // Convert minutes to milliseconds
      twitchClient.say(channel, `Inactivity timer set to ${minutes} minutes. ⏲️`);
      messageHistory.push(`${SETTINGS.username}: Inactivity timer set to ${minutes} minutes. ⏲️`);
    }
    return;
  }

  // Command: !aisysprompt <new system message> - Update the system prompt
  if (message.toLowerCase().startsWith('!aisysprompt ') && (isBroadcaster || isModerator || isJuggleWithTim)) {
    const newSystemPrompt = message.slice('!aisysprompt '.length).trim();
    if (newSystemPrompt) {
      SYSTEM_PROMPT = newSystemPrompt;
      twitchClient.say(channel, 'System prompt updated successfully! ✅');
      messageHistory.push(`${SETTINGS.username}: System prompt updated successfully! ✅`);
    } else {
      twitchClient.say(channel, 'Please provide a valid system prompt. ❌');
      messageHistory.push(`${SETTINGS.username}: Please provide a valid system prompt. ❌`);
    }
    return;
  }
  
  if (message.toLowerCase() === '!airesetprompt' && (isBroadcaster || isModerator || isJuggleWithTim)) {
    SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;
    twitchClient.say(channel, 'System prompt reset to default! 🔄');
    messageHistory.push(`${SETTINGS.username}: System prompt reset to default! 🔄`);
    return;
  }

  // Command: !aistop - Pause the bot
  if (message.toLowerCase() === '!aistop' && (isBroadcaster || isModerator || isJuggleWithTim)) {
    botPaused = true;
    twitchClient.say(channel, 'Bot is now paused. ⏸️');
    messageHistory.push(`${SETTINGS.username}: Bot is now paused. ⏸️`);
    return;
  }

  // Command: !aistart - Resume the bot
  if (message.toLowerCase() === '!aistart' && (isBroadcaster || isModerator || isJuggleWithTim)) {
    botPaused = false;
    twitchClient.say(channel, 'Bot is now resumed. ▶️');
    messageHistory.push(`${SETTINGS.username}: Bot is now resumed. ▶️`);
    return;
  }
  
  // Command: !aicontext <number> - Change context history length
  if (message.toLowerCase().startsWith('!aicontext ') && (isBroadcaster || isModerator || isJuggleWithTim)) {
    const newLength = parseInt(message.split(' ')[1], 10); // Extract the number
    if (isNaN(newLength) || newLength < 1 || newLength > 50) {
      twitchClient.say(channel, 'Please provide a number between 1-50 (e.g., !aicontext 20). ❌');
      messageHistory.push(`${SETTINGS.username}: Invalid input for !aicontext. ❌`);
    } else {
      SETTINGS.maxHistoryLength = newLength;
      // Trim message history if current length exceeds new limit
      while (messageHistory.length > SETTINGS.maxHistoryLength) {
        messageHistory.shift();
      }
      twitchClient.say(channel, `Context history length set to ${newLength} messages 📜`);
      messageHistory.push(`${SETTINGS.username}: Context history length set to ${newLength} messages 📜`);
    }
    return;
  }
  
  // Command: !aihelp - Display available commands
  if (message.toLowerCase() === '!aihelp' && (isBroadcaster || isModerator || isJuggleWithTim)) {
    const helpMessage = `Available commands: 
      !aiauto - Toggle auto-messages on/off | 
      !aitimer <minutes> - Set auto-message timer | 
      !aisysprompt <new prompt> - Update system prompt | 
      !airesetprompt - Reset to default prompt |
      !aicontext <number> - Set context history length (1-50) | 
      !aistop - Pause the bot | 
      !aistart - Resume the bot | 
      !aihelp - Show this help message`;

    
    twitchClient.say(channel, helpMessage);
    messageHistory.push(`${SETTINGS.username}: ${helpMessage}`);
    return;
  }


  // === NORMAL MESSAGE HANDLING === //
  // Check if the bot is paused
  if (botPaused) return;

  // Check if the bot is mentioned in the message
  const botUsername = twitchClient.getUsername().toLowerCase();
  if (message.toLowerCase().includes(botUsername)) {
    // Update the last mention time
    lastBotMentionTime = Date.now();

    // Extract the user's message without the bot's mention
    const userMessage = message.replace(new RegExp(`@${botUsername}`, 'i'), '').trim();

    // Get the recent conversation context
    const context = messageHistory.join('\n');

    // Get a response from the chosen API
    let response = await getChatResponse(userMessage, context);

    // Remove <think> tags (including content) from the response
    response = response.replace(/<think[^>]*>([\s\S]*?)<\/think>/gi, '').trim();

    // If the response is empty, send a default message
    if (!response) {
      response = SETTINGS.fallbackMessage;
    }

    // Send the cleaned response back to the chat
    twitchClient.say(channel, `@${tags.username}, ${response}`);

    // Add the bot's message to history
    messageHistory.push(`${SETTINGS.username}: ${response}`);
  }
});

// Timer to check for inactivity
setInterval(() => {
  const now = Date.now();

  // Don't send auto-messages if:
  // 1. The bot has been active recently (based on inactivityThreshold)
  // 2. Auto-messages are disabled
  // 3. The bot is paused
  if (now - lastBotMentionTime < SETTINGS.inactivityThreshold || !SETTINGS.enableAutoMessages || botPaused) {
    return;
  }

  // Check if the most recent message was sent by the bot
  const botUsername = twitchClient.getUsername().toLowerCase();
  if (messageHistory.length > 0 && messageHistory[messageHistory.length - 1].toLowerCase().startsWith(`${botUsername}:`)) {
    console.log('Most recent message was sent by the bot. Skipping auto-message.');
    return;
  }

  // Send the auto-message
  sendAutoMessage(SETTINGS.channel);
}, 60000); // Check every minute

// Connect to Twitch chat
twitchClient.connect().then(() => {
  console.log('Bot connected to Twitch chat!');
}).catch((err) => {
  console.error('Failed to connect to Twitch chat:', err);
});

