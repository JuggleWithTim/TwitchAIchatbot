// === SYSTEM PROMPTS === //
const CORE_SYSTEM_PROMPT = (username, channel) => `
You are @${username}, a Twitch chatbot in ${channel}'s channel.
- Keep responses short and snappy.
- Remember you're in a fast-paced live chat environment.
- Do not include your own name at the start of messages.
`;

// === COMMAND CONSTANTS === //
const COMMANDS = {
  AI_BOT: '!aibot',
  HUG: '!hug',
  SO: '!so',
  WAIFU: '!waifu',
  UNWAIFU: '!unwaifu',
  WAIFU_LIST: '!waifulist',
  AI_TIMER: '!aitimer',
  AI_SYS_PROMPT: '!aisysprompt',
  AI_RESET_PROMPT: '!airesetprompt',
  AI_STOP: '!aistop',
  AI_START: '!aistart',
  AI_CONTEXT: '!aicontext',
  IMAGINE: '!imagine',
  CREATE: '!create',
  IMAGE: '!image',
  AI_RESET_QUOTA: '!airesetquota',
  AI_PASSIVE_LEARNING: '!aipassive',
  AI_MEMORY: '!aimemory',
  AI_HELP: '!aihelp',
  QUOTE: '!quote',
  ADD_QUOTE: '!addquote'
};

// === IMAGE GENERATION ALIASES === //
const IMAGE_COMMAND_ALIASES = ['!imagine', '!create', '!image'];

// === CHECK INTERVALS === //
const CHECK_INTERVALS = {
  SUBGIFT_PROCESS: 1000, // 1 second
  QUOTA_RESET: 24 * 60 * 60 * 1000, // 24 hours
  USER_RESPONSE_RESET: 5 * 60 * 1000 // 5 minutes
};

// === API ENDPOINTS === //
const API_ENDPOINTS = {
  TWITCH_TOKEN: 'https://id.twitch.tv/oauth2/token',
  TWITCH_USERS: 'https://api.twitch.tv/helix/users',
  TWITCH_STREAMS: 'https://api.twitch.tv/helix/streams',
  TWITCH_VIDEOS: 'https://api.twitch.tv/helix/videos',
  TWITCH_GAMES: 'https://api.twitch.tv/helix/games'
};

// === SETTINGS FIELDS === //
const SETTINGS_EDITABLE_FIELDS = [
  "username",
  "password",
  "channel",
  "maxHistoryLength",
  "enableShoutoutCommand",
  "enableHugCommand",
  "enableWaifuCommand",
  "enableImageGeneration",
  "enableQuotaNotification",
  "enableBitsAlerts",
  "enableSubsAlerts",
  "enableRaidsAlerts",
  "enableMemory",
  "enablePassiveLearning",
  "enableScheduledMessages",
  "scheduledMessageTimer",
  "DEFAULT_ADDITIONAL_PROMPT",
  "enableDiscordBot",
  "discordBotToken",
  "discordChannels",
  "discordSystemPrompt",
  "customCommands",
  "scheduledMessages",
  "quotes"
];

const FIELD_LABELS = {
  username: "Twitch bot username",
  password: "Twitch oauth password",
  channel: "Twitch channel",
  maxHistoryLength: "Context history length",
  inactivityThreshold: "Auto message timer",
  enableShoutoutCommand: "Shoutout command",
  enableHugCommand: "Hug command",
  enableWaifuCommand: "Waifu commands",
  enableImageGeneration: "Image generation",
  enableQuotaNotification: "Notification for renewed image quota",
  enableBitsAlerts: "Bits alerts",
  enableSubsAlerts: "Subscriptions alerts",
  enableRaidsAlerts: "Raids alerts",
  enableMemory: "Persistent memory",
  enablePassiveLearning: "Passive learning",
  enableScheduledMessages: "Scheduled messages",
  scheduledMessageTimer: "Scheduled message timer",
  DEFAULT_ADDITIONAL_PROMPT: "System prompt",
  enableDiscordBot: "Enable Discord Bot",
  discordBotToken: "Discord Bot Token",
  discordChannels: "Discord Channel IDs or Names (comma separated)",
  discordSystemPrompt: "Discord Bot System Prompt",
  customCommands: "Custom Commands",
  scheduledMessages: "Scheduled Messages",
  quotes: "Quotes"
};

const CHECKBOX_FIELDS = [
  "enableShoutoutCommand",
  "enableHugCommand",
  "enableWaifuCommand",
  "enableImageGeneration",
  "enableQuotaNotification",
  "enableBitsAlerts",
  "enableSubsAlerts",
  "enableRaidsAlerts",
  "enableMemory",
  "enablePassiveLearning",
  "enableScheduledMessages",
  "enableDiscordBot"
];

// === MESSAGES === //
const MESSAGES = {
  AI_BOT_PROMO: "I'm powered by JuggleAI! Check it out here: https://jugglewithtim.com/juggleai/",
  HUG_SUCCESS: (giver, receiver) => `@${giver} gives a big hug to @${receiver}! 🤗`,
  WAIFU_ADD: (username) => `@${username} I love you! 💖 UwU`,
  WAIFU_ALREADY: (username) => `@${username}, you're already on my waifu list my love! 💖 UwU`,
  WAIFU_REMOVE: (username) => `@${username} broke up with me 💔`,
  WAIFU_NOT_LISTED: (username) => `@${username}, you're not on the waifu list!`,
  WAIFU_LIST_EMPTY: "Nobody is on the waifu list yet! 💔",
  WAIFU_LIST: (list) => "My waifus: " + list.map(u => '@' + u).join(', ') + " 💖",
  TIMER_SET: (minutes) => `Auto message timer set to ${minutes} minutes. ⏲️`,
  INVALID_MINUTES: 'Please provide a valid number of minutes (e.g., !aitimer 30). ❌',
  PROMPT_UPDATED: 'System prompt updated successfully! ✅',
  PROMPT_RESET: 'System prompt reset to default! 🔄',
  INVALID_PROMPT: 'Please provide a valid system prompt. ❌',
  BOT_PAUSED: 'Bot is now paused. ⏸️',
  BOT_RESUMED: 'Bot is now resumed. ▶️',
  CONTEXT_SET: (length) => `Context history length set to ${length} messages 📜`,
  INVALID_CONTEXT: 'Please provide a number between 1-50 (e.g., !aicontext 20). ❌',
  QUOTA_REACHED: (limit) => `⚠️ Image generation limit reached (${limit}/day).`,
  NO_OPENAI: '⚠️ Image generation requires OpenAI API to be enabled and configured',
  NO_CONTEXT: '⚠️ No chat history to generate from!',
  IMAGE_FROM_CONTEXT: (usage, limit) => `🎨 Generated from chat context (${usage}/${limit}): `,
  IMAGE_FROM_PROMPT: (usage, limit) => `🖼️ Generated image (${usage}/${limit}): `,
  QUOTA_RESET: '✅ Image generation quota has been reset!',
  QUOTA_AUTO_RESET: '🕛 Image generation quota has been reset! Use !imagine to generate!',
  IMAGE_ERROR: '⚠️ Failed to generate image',
  CONTENT_POLICY_ERROR: '⚠️ Failed to generate image (content policy violation)',
  CONTEXT_ERROR: '⚠️ Failed to generate image - Could not create concept from chat history',
  USER_NOT_FOUND: (username) => `Couldn't find a user called "${username}". 👻`,
  SHOUTOUT_ERROR: (username) => `Couldn't shoutout "${username}" (maybe invalid name or rate-limited).`,
  INVALID_SO_USAGE: "Usage: !so <username>",
  RESTARTING: '<html><body style="background:#262729;color:white"><h2>Restarting now...</h2></body></html>',
  CONNECTED: 'Bot connected to Twitch chat!',
  CONNECTION_FAILED: 'Failed to connect to Twitch chat:',
  DISCORD_DISABLED: 'Discord bot is disabled or token missing in settings.',
  WEB_UI_STARTED: (port) => `Settings web UI running at http://localhost:${port}`,
  AUTH_REQUIRED: 'Authentication required.',
  INVALID_INPUT: 'Invalid input',
  QUOTE_ADDED: 'Quote added successfully! 💬',
  QUOTE_NO_QUOTES: 'No quotes available yet! 📝',
  QUOTE_INVALID_USAGE: 'Usage: !addquote <quote text>',
  QUOTE: (quote) => `${quote} 💬`
};

module.exports = {
  CORE_SYSTEM_PROMPT,
  COMMANDS,
  IMAGE_COMMAND_ALIASES,
  CHECK_INTERVALS,
  API_ENDPOINTS,
  SETTINGS_EDITABLE_FIELDS,
  FIELD_LABELS,
  CHECKBOX_FIELDS,
  MESSAGES
};
