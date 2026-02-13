const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { OpenAI } = require('openai');

let discordClient = null;
let discordMessageHistory = [];

let discordSettings = null;

// Default Discord system prompt
const DISCORD_CORE_PROMPT = `You are a Discord chatbot. Try to keep messages shorter than 2000 characters.`;

// Timeout for context memory (we could clear periodically or on max message length too)
const MAX_HISTORY = 15;

function isGPT5Model(model) {
  return typeof model === 'string' && model.toLowerCase().startsWith('gpt-5');
}

function extractResponseText(response) {
  if (!response) return '';

  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }

  if (Array.isArray(response.output)) {
    const textParts = [];
    for (const item of response.output) {
      if (!Array.isArray(item.content)) continue;
      for (const contentItem of item.content) {
        if (contentItem.type === 'output_text' && typeof contentItem.text === 'string') {
          textParts.push(contentItem.text);
        }
      }
    }
    return textParts.join('\n').trim();
  }

  return '';
}

function initializeDiscord(settings, openaiInstance) {
  discordSettings = settings;

  if (!discordSettings.enableDiscordBot) {
    console.log('Discord bot disabled in settings.');
    return;
  }

  // Discord client
  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
  });

  // Prepare the system prompt for Discord
  let discordSystemPrompt = DISCORD_CORE_PROMPT;
  if (discordSettings.discordSystemPrompt) {
    discordSystemPrompt += `\n${discordSettings.discordSystemPrompt}`;
  }

  // Create a helper to get chat response with Discord context
  async function getDiscordChatResponse(userMessage) {
    if (!openaiInstance) {
      console.error('OpenAI instance missing for Discord.');
      return 'Sorry, I am currently unable to respond.';
    }

    const prompt = discordSystemPrompt;
    const context = discordMessageHistory.join('\n');
    const model = discordSettings.openaiModelName || 'gpt-5-nano';

    try {
      if (isGPT5Model(model)) {
        const response = await openaiInstance.responses.create({
          model,
          instructions: prompt,
          input: `Context:\n${context}\n\nUser: ${userMessage}\nBot:`,
          reasoning: { effort: 'minimal' },
          text: { verbosity: 'low' },
          max_output_tokens: 300,
        });
        return extractResponseText(response);
      }

      const response = await openaiInstance.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: `Context:\n${context}\n\nUser: ${userMessage}\nBot:` }
        ],
        max_tokens: 300,
      });
      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error calling OpenAI API for Discord:', error);
      return 'Sorry, I encountered an error while generating a response.';
    }
  }

  discordClient.on('clientReady', () => {
    console.log(`Discord bot logged in as ${discordClient.user.tag}`);
  });

  discordClient.on('messageCreate', async (message) => {
    // Ignore messages from the bot itself or from DMs
    if (message.author.bot) return;
    if (!message.guild) return; // ignore DMs for now

    // Check if the bot was mentioned
    if (!message.mentions.has(discordClient.user)) return; // only respond when mentioned

    // If restricted channels are configured, enforce it
    /**
     * discordSettings.discordChannels is expected to be an array of channel ids or names
     * If empty or missing, respond anywhere bot is mentioned
     */
    if (Array.isArray(discordSettings.discordChannels) && discordSettings.discordChannels.length > 0) {
      const channelId = message.channel.id;
      // Check if the current channel matches any allowed channel
      if (!discordSettings.discordChannels.includes(channelId) && !discordSettings.discordChannels.includes(message.channel.name)) {
        // Not allowed channel
        return;
      }
    }

    // Clean message content by removing mention
    const botMentionRegex = new RegExp(`<@!?${discordClient.user.id}>`, 'g');
    let userMessage = message.content.replace(botMentionRegex, '').trim();
    if (!userMessage) return; // no message after mention

    // Add user message to discord context
    discordMessageHistory.push(`${message.author.username}: ${userMessage}`);
    if (discordMessageHistory.length > MAX_HISTORY) {
      discordMessageHistory.shift();
    }

    // Get bot response
    let reply = await getDiscordChatResponse(userMessage);

    // Clean up any tags or unwanted responses if necessary (optional)

    // Add bot response to history
    discordMessageHistory.push(`Bot: ${reply}`);
    if (discordMessageHistory.length > MAX_HISTORY) {
      discordMessageHistory.shift();
    }

    // Reply to user in same channel
    message.reply(reply).catch(console.error);
  });

}

function loginDiscord(token) {
  if (!discordClient) {
    console.error('Discord client not initialized. Call initializeDiscord first.');
    return;
  }

  discordClient.login(token).catch((err) => console.error('Discord login error:', err));
}

function disconnectDiscord() {
  if (discordClient) {
    discordClient.destroy();
    discordClient = null;
    discordMessageHistory = [];
    console.log('Discord bot disconnected');
  }
}

module.exports = {
  initializeDiscord,
  loginDiscord,
  disconnectDiscord
};
