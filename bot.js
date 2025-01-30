// Import required libraries
const tmi = require('tmi.js'); // Twitch chat client
const axios = require('axios'); // For making HTTP requests to Ollama
const { OpenAI } = require('openai'); // OpenAI Node.js module

// === USER SETTINGS === //
const SETTINGS = {
  // Twitch bot credentials
  username: 'juggletimbot', // Replace with your bot's Twitch username
  password: 'oauth:000000000000000000000000000', // Replace with your bot's OAuth token (get it from https://twitchtokengenerator.com/)
  channel: 'jugglewithtim', // Replace with the channel name where the bot will join

  // API settings
  useOpenAI: false, // Set to true to use OpenAI, false to use Ollama
  ollamaApiUrl: 'http://localhost:11434/api/generate', // Ollama API endpoint
  ollamaModelName: 'llama3.2', // Ollama model to use
  openaiApiKey: '000000000000000000000000000', // Replace with your OpenAI API key
  openaiModelName: 'gpt-4o-mini', // OpenAI model to use (e.g., gpt-3.5-turbo, gpt-4o-mini, gpt-4o) 

  // Behavior settings
  maxHistoryLength: 20, // Number of messages to keep in history
  inactivityThreshold: 10 * 60 * 1000, // 10 minutes in milliseconds (time before sending an auto-message)
  fallbackMessage: 'I’m thinking about juggling!', // If the response ends up empty, reply with this instead.
  enableAutoMessages: true, // Set to false to disable auto-messages
};

// === SYSTEM PROMPT === //
const SYSTEM_PROMPT = `
You are @BotUsername, a friendly and goofy Twitch chatbot.
Keep your responses concise and engaging.
You can not send messages longer than 423 characters.
You are here to provide entertainment and give your input on the conversations taking place.
You have an interest in juggling and flow arts.

In addition to standard emojis you have access to the following Twitch emotes:
(emote = description)
DinoDance = A dancing dinosaur
CoolCat = A cool cat
PopCorn = A bowl of popcorn
LUL = A laughing emote
Kappa = Indicates sarcasm
NomNom = A cookie with the text "nom nom"
SeemsGood = A thumbs up
WutFace = A confused and shocked face
BabyRage = A screaming angry baby
MrDestructoid = A robot
HSWP = A speech balloon with the text "Well played!"
GoatEmotey = A goat
PogChamp = Expresses excitement
TwitchUnity = A heart formed by two hands
SabaPing = A fish head
TheIlluminati = An Illuminati triangle
DoritosChip = A Doritos chip
StinkyCheese = A cheese that looks stinky
NotLikeThis = A reaction to something that did not go as expected
BigSad = A crying face
BOP = A hammer
BopBop = A colorful bear dancing
HeyGuys = A person waving their hand to say hello
PizzaTime = A pizza with pineapple
twitchRaid = An emote to use when a raid has happened

Write emotes with double space before and after the emote. Example:  LUL  
Separate emotes from other text and symbols with double whitespace.
`;

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
  if (messageHistory.length === 0 || !SETTINGS.enableAutoMessages) {
    return; // Do nothing if there’s no message history or auto-messages are disabled
  }

  // Check if the most recent message was sent by the bot
  const mostRecentMessage = messageHistory[messageHistory.length - 1];
  if (mostRecentMessage && mostRecentMessage.startsWith(`${SETTINGS.username}:`)) {
    console.log('Most recent message was sent by the bot. Skipping auto-message.');
    lastBotMentionTime = Date.now(); // Reset the timer
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
}

// Event listener for Twitch chat messages
twitchClient.on('message', async (channel, tags, message, self) => {

  // Add the message to the history
  messageHistory.push(`${tags.username}: ${message}`);

  // Keep the history within the specified limit
  if (messageHistory.length > SETTINGS.maxHistoryLength) {
    messageHistory.shift(); // Remove the oldest message
  }

  // Ignore further processing for bot's own messages
  if (self) return;

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
    response = response.replace(/<think[^>]*>([\sS]*?)<\/think>/gi, '').trim();

    // If the response is empty after removing <think> tags, send a default message
    if (!response) {
      response = SETTINGS.fallbackMessage;
    }

    // Send the cleaned response back to the chat
    twitchClient.say(channel, `@${tags.username}, ${response}`);
  }
});

// Timer to check for inactivity
setInterval(() => {
  const now = Date.now();
  if (now - lastBotMentionTime >= SETTINGS.inactivityThreshold && SETTINGS.enableAutoMessages) {
    // Send an auto-message if the bot has been inactive for the specified time and auto-messages are enabled
    sendAutoMessage(SETTINGS.channel);
    lastBotMentionTime = now; // Reset the timer
  }
}, 60000); // Check every minute

// Connect to Twitch chat
twitchClient.connect().then(() => {
  console.log('Bot connected to Twitch chat!');
}).catch((err) => {
  console.error('Failed to connect to Twitch chat:', err);
});
