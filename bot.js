// Import required libraries
const tmi = require('tmi.js'); // Twitch chat client
const axios = require('axios'); // For making HTTP requests to Ollama

// === USER SETTINGS === //
const SETTINGS = {
  // Twitch bot credentials
  username: 'BotUsername', // Replace with your bot's Twitch username
  password: 'oauth:000000000000000000000000000', // Replace with your bot's OAuth token (get it from https://twitchapps.com/tmi/)
  channel: 'ChannelName', // Replace with the channel name where the bot will join

  // Ollama API settings
  ollamaApiUrl: 'http://localhost:11434/api/generate', // Ollama API endpoint
  modelName: 'llama3.2', // Ollama model to use

  // Behavior settings
  maxHistoryLength: 20, // Number of messages to keep in history
  inactivityThreshold: 10 * 60 * 1000, // 10 minutes in milliseconds (time before sending an auto-message)
  fallbackMessage: 'I’m thinking about juggling!', // If the response ends up empty, reply with this instead.
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
LUL = A laughing emote to express that something you type or react to is funny
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
BopBop = A colorful brear dancing
HeyGuys = A person waving their hand to say hello
PizzaTime = A pizza with pineapple
twitchRaid = An emote to use when a raid has happened

Write emotes with double space before and after the emote. Example:  LUL  
Separate emotes from other text and symbols with double whitespace.
`;

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

// Function to call Ollama API and get a response
async function getOllamaResponse(userMessage, context) {
  try {
    // Combine the context (message history) with the user's message
    const fullPrompt = `Context:\n${context}\n\nUser: ${userMessage}\nBot:`;

    const response = await axios.post(SETTINGS.ollamaApiUrl, {
      model: SETTINGS.modelName,
      prompt: fullPrompt,
      system: SYSTEM_PROMPT, // Include the system prompt
      stream: false, // We want a single response, not a stream
    });
    return response.data.response; // Extract the response from Ollama
  } catch (error) {
    console.error('Error calling Ollama API:', error);
    return 'Sorry, I encountered an error while generating a response.';
  }
}

// Function to send a message based on the message history
async function sendAutoMessage(channel) {
  if (messageHistory.length === 0) {
    return; // Do nothing if there’s no message history
  }

  // Get the recent conversation context
  const context = messageHistory.join('\n');

  // Generate a message based on the context
  let response = await getOllamaResponse('Please respond to the chat as if you are a part of the conversation', context);

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
  // Ignore messages from the bot itself
  if (self) return;

  // Add the message to the history
  messageHistory.push(`${tags.username}: ${message}`);

  // Keep the history within the specified limit
  if (messageHistory.length > SETTINGS.maxHistoryLength) {
    messageHistory.shift(); // Remove the oldest message
  }

  // Check if the bot is mentioned in the message
  const botUsername = twitchClient.getUsername().toLowerCase();
  if (message.toLowerCase().includes(botUsername)) {
    // Update the last mention time
    lastBotMentionTime = Date.now();

    // Extract the user's message without the bot's mention
    const userMessage = message.replace(new RegExp(`@${botUsername}`, 'i'), '').trim();

    // Get the recent conversation context
    const context = messageHistory.join('\n');

    // Get a response from Ollama
    let response = await getOllamaResponse(userMessage, context);

    // Remove <think> tags (including content) from the response
    response = response.replace(/<think[^>]*>([\sS]*?)<\/think>/gi, '').trim();

    // If the response is empty after removing <think> tags, send a default message
    if (!response) {
      response = 'I’m thinking about juggling!';
    }

    // Send the cleaned response back to the chat
    twitchClient.say(channel, `@${tags.username}, ${response}`);
  }
});

// Timer to check for inactivity
setInterval(() => {
  const now = Date.now();
  if (now - lastBotMentionTime >= SETTINGS.inactivityThreshold) {
    // Send an auto-message if the bot has been inactive for the specified time
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
