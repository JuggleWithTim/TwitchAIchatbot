const express = require('express');
const { loadSettings, saveSettings, getSettings, setSetting } = require('../config/settings');
const { SETTINGS_EDITABLE_FIELDS, FIELD_LABELS, CHECKBOX_FIELDS, MESSAGES } = require('../config/constants');
const botState = require('../models/botState');
const discordBot = require('../discordbot.js');

const app = express();
let discordClientToken = null;

class WebInterface {
  constructor(port) {
    this.port = port;
    this.app = app;
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // Simple Auth for /
    this.app.use((req, res, next) => {
      const header = req.headers.authorization || '';
      const correct = "Basic " + Buffer.from(`${getSettings().webUsername}:${getSettings().webPassword}`).toString('base64');
      if (header !== correct) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
        return res.status(401).send(MESSAGES.AUTH_REQUIRED);
      }
      next();
    });

    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.json());
  }

  /**
   * Setup routes
   */
  setupRoutes() {
    // GET /
    this.app.get('/', async (req, res) => {
      await loadSettings();
      const html = this.renderSettingsPage();
      res.send(html);
    });

    // POST /
    this.app.post('/', async (req, res) => {
      await loadSettings();

      const action = req.body.action || "save";

      // Handle custom command actions first
      if (action === "addCommand") {
        const newCommand = req.body.newCommand;
        const newType = req.body.newType;
        const newContent = req.body.newContent;

        if (newCommand && newType && newContent) {
          const customCommands = getSettings().customCommands || [];
          // Check if command already exists
          const exists = customCommands.find(cmd => cmd.command.toLowerCase() === newCommand.toLowerCase());
          if (!exists) {
            customCommands.push({
              command: newCommand.toLowerCase(),
              type: newType,
              content: newContent
            });
            setSetting('customCommands', customCommands);
            await saveSettings();
          }
        }
        return res.redirect('/');
      }

      // Also check for delete action by button name
      if (req.body.deleteCommandIndex !== undefined) {
        const deleteIndex = parseInt(req.body.deleteCommandIndex);
        if (!isNaN(deleteIndex)) {
          const customCommands = getSettings().customCommands || [];
          if (deleteIndex >= 0 && deleteIndex < customCommands.length) {
            customCommands.splice(deleteIndex, 1);
            setSetting('customCommands', customCommands);
            await saveSettings();
          }
        }
        return res.redirect('/');
      }

      // Handle scheduled message actions
      if (action === "addScheduledMessage") {
        const newType = req.body.newScheduledType;
        const newContent = req.body.newScheduledContent;

        if (newType && newContent) {
          const scheduledMessages = getSettings().scheduledMessages || [];
          scheduledMessages.push({
            type: newType,
            content: newContent
          });
          setSetting('scheduledMessages', scheduledMessages);
          await saveSettings();
        }
        return res.redirect('/');
      }

      // Check for delete scheduled message action by button name
      if (req.body.deleteScheduledMessageIndex !== undefined) {
        const deleteIndex = parseInt(req.body.deleteScheduledMessageIndex);
        if (!isNaN(deleteIndex)) {
          const scheduledMessages = getSettings().scheduledMessages || [];
          if (deleteIndex >= 0 && deleteIndex < scheduledMessages.length) {
            scheduledMessages.splice(deleteIndex, 1);
            setSetting('scheduledMessages', scheduledMessages);
            await saveSettings();
          }
        }
        return res.redirect('/');
      }

      // Handle quote actions
      if (action === "addQuote") {
        const newQuote = req.body.newQuote;

        if (newQuote && newQuote.trim()) {
          const quotes = getSettings().quotes || [];
          quotes.push(newQuote.trim());
          setSetting('quotes', quotes);
          await saveSettings();
        }
        return res.redirect('/');
      }

      // Check for delete quote action by button name
      if (req.body.deleteQuoteIndex !== undefined) {
        const deleteIndex = parseInt(req.body.deleteQuoteIndex);
        if (!isNaN(deleteIndex)) {
          const quotes = getSettings().quotes || [];
          if (deleteIndex >= 0 && deleteIndex < quotes.length) {
            quotes.splice(deleteIndex, 1);
            setSetting('quotes', quotes);
            await saveSettings();
          }
        }
        return res.redirect('/');
      }

      // Update settings from form data
      for (const k of SETTINGS_EDITABLE_FIELDS) {
        // Skip special fields that are handled separately
        if (k === 'customCommands' || k === 'scheduledMessages' || k === 'quotes') continue;

        let v;
        if (CHECKBOX_FIELDS.includes(k)) {
          v = req.body[k] === "1" ? 1 : 0;
        } else if (k === "discordChannels") {
          const raw = req.body[k] || '';
          v = raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
        } else if (k === "inactivityThreshold") {
          v = Math.round(Number(req.body[k]) * 60000);
        } else if (typeof getSettings()[k] === "number") {
          v = Number(req.body[k]);
        } else if (typeof getSettings()[k] === "string") {
          v = req.body[k];
        } else {
          v = req.body[k];
        }
        setSetting(k, v);
      }

      await saveSettings();

      if (action === "restart") {
        res.send(MESSAGES.RESTARTING);
        setTimeout(() => {
          console.log("Admin requested restart. Exiting process.");
          process.exit(1);
        }, 1000);
        return;
      }

      res.redirect('/');
    });
  }

  /**
   * Render input fields for settings
   */
  renderInputField(key, value) {
    if (key === "password") {
      return `<input type="password" id="${key}" name="${key}" value="${value === undefined ? '' : value}"
        style="width: 92%; padding: 7px; border-radius: 5px; border: 1px solid #8070c7; font-size: 1em; background: #202025; color: #fafaff;" />`;
    }
    if (CHECKBOX_FIELDS.includes(key)) {
      return `<input type="checkbox" id="${key}" name="${key}" value="1" ${value == 1 ? "checked" : ""}>`;
    }
    if (key === "inactivityThreshold") {
      let minutes = Math.max(1, Math.round(Number(value) / 60000));
      return `<input type="number" id="${key}" name="${key}" value="${minutes}" min="1" style="width:80px;" /> <span style="font-size:0.97em;color:#ccc;">minutes</span>`;
    }
    if (key === "scheduledMessageTimer") {
      return `<input type="number" id="${key}" name="${key}" value="${value || 10}" min="1" style="width:80px;" /> <span style="font-size:0.97em;color:#ccc;">minutes</span>`;
    }
    if (key === "DEFAULT_ADDITIONAL_PROMPT") {
      return `<textarea id="${key}" name="${key}" rows="10" cols="60">${value}</textarea>`;
    }
    if (key === "maxHistoryLength") {
      return `<input type="number" id="${key}" name="${key}" value="${value}" min="1" style="width:80px;" /> <span style="font-size:0.97em;color:#ccc;">messages</span>`;
    }
    if (key === "discordChannels") {
      // Render array as comma separated string in text input
      const displayVal = Array.isArray(value) ? value.join(', ') : (value || '');
      return `<input type="text" id="${key}" name="${key}" value="${displayVal}" style="width: 92%;" />`;
    }
    if (key === "discordSystemPrompt") {
      return `<textarea id="${key}" name="${key}" rows="10" cols="60">${value || ''}</textarea>`;
    }
    if (key === "customCommands") {
      return this.renderCustomCommandsField(key, value || []);
    }
    if (key === "scheduledMessages") {
      return this.renderScheduledMessagesField(key, value || []);
    }
    if (key === "quotes") {
      return this.renderQuotesField(key, value || []);
    }
    if (typeof value === "number") {
      return `<input type="number" id="${key}" name="${key}" value="${value}" />`;
    }
    if (typeof value === "string" && value.length > 80) {
      return `<textarea id="${key}" name="${key}" rows="6" cols="60">${value}</textarea>`;
    }
    if (key === "discordBotToken") {
      return `<input type="password" id="${key}" name="${key}" value="${value === undefined ? '' : value}"
        style="width: 92%; padding: 7px; border-radius: 5px; border: 1px solid #8070c7; font-size: 1em; background: #202025; color: #fafaff;" />`;
    }
    return `<input type="text" id="${key}" name="${key}" value="${value === undefined ? '' : value}" />`;
  }

  /**
   * Render custom commands management field
   */
  renderCustomCommandsField(key, commands) {
    let html = '<div class="custom-commands-section" style="border: 1px solid #8070c7; padding: 15px; border-radius: 5px; background: #202025;">';

    // Add form to create new command
    html += '<div style="margin-bottom: 20px; padding: 10px; background: #35363a; border-radius: 5px;">';
    html += '<h4 style="color: #b080fa; margin-top: 0;">Add New Command</h4>';
    html += '<input type="text" name="newCommand" placeholder="!commandname" style="width: 200px; margin-right: 10px;">';
    html += '<select name="newType" style="margin-right: 10px;"><option value="static">Static Response</option><option value="ai">AI Generated</option></select>';
    html += '<textarea name="newContent" placeholder="Command content..." rows="3" style="width: 92%; margin-top: 5px;"></textarea>';
    html += '<button type="submit" name="action" value="addCommand" style="margin-top: 8px; background: #4CAF50;">Add Command</button>';
    html += '</div>';

    // List existing commands
    if (commands.length > 0) {
      html += '<div class="existing-commands">';
      html += '<h4 style="color: #b080fa;">Existing Commands</h4>';

      commands.forEach((cmd, index) => {
        html += `<div class="command-item" style="border: 1px solid #555; padding: 10px; margin-bottom: 10px; border-radius: 5px;">`;
        html += `<strong>${cmd.command}</strong> (${cmd.type})`;
        html += `<p style="margin: 5px 0;">${cmd.content}</p>`;
        html += `<button type="submit" name="deleteCommandIndex" value="${index}" style="background: #e74c3c; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer;">Delete</button>`;
        html += `</div>`;
      });

      html += '</div>';
    } else {
      html += '<p>No custom commands defined yet.</p>';
    }

    html += '</div>';
    return html;
  }

  /**
   * Render scheduled messages management field
   */
  renderScheduledMessagesField(key, messages) {
    let html = '<div class="scheduled-messages-section" style="border: 1px solid #8070c7; padding: 15px; border-radius: 5px; background: #202025;">';

    // Add form to create new scheduled message
    html += '<div style="margin-bottom: 20px; padding: 10px; background: #35363a; border-radius: 5px;">';
    html += '<h4 style="color: #b080fa; margin-top: 0;">Add New Scheduled Message</h4>';
    html += '<select name="newScheduledType" style="margin-right: 10px;"><option value="static">Static Message</option><option value="ai">AI Generated</option></select>';
    html += '<textarea name="newScheduledContent" placeholder="Message content..." rows="3" style="width: 92%; margin-top: 5px;"></textarea>';
    html += '<button type="submit" name="action" value="addScheduledMessage" style="margin-top: 8px; background: #4CAF50;">Add Message</button>';
    html += '</div>';

    // List existing messages
    if (messages.length > 0) {
      html += '<div class="existing-messages">';
      html += '<h4 style="color: #b080fa;">Existing Scheduled Messages</h4>';

      messages.forEach((msg, index) => {
        html += `<div class="message-item" style="border: 1px solid #555; padding: 10px; margin-bottom: 10px; border-radius: 5px;">`;
        html += `<strong>Message ${index + 1}</strong> (${msg.type})`;
        html += `<p style="margin: 5px 0;">${msg.content}</p>`;
        html += `<button type="submit" name="deleteScheduledMessageIndex" value="${index}" style="background: #e74c3c; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer;">Delete</button>`;
        html += `</div>`;
      });

      html += '</div>';
    } else {
      html += '<p>No scheduled messages defined yet.</p>';
    }

    html += '</div>';
    return html;
  }

  /**
   * Render quotes management field
   */
  renderQuotesField(key, quotes) {
    let html = '<div class="quotes-section" style="border: 1px solid #8070c7; padding: 15px; border-radius: 5px; background: #202025;">';

    // Add form to create new quote
    html += '<div style="margin-bottom: 20px; padding: 10px; background: #35363a; border-radius: 5px;">';
    html += '<h4 style="color: #b080fa; margin-top: 0;">Add New Quote</h4>';
    html += '<textarea name="newQuote" placeholder="Enter quote text..." rows="3" style="width: 92%; margin-top: 5px;"></textarea>';
    html += '<button type="submit" name="action" value="addQuote" style="margin-top: 8px; background: #4CAF50;">Add Quote</button>';
    html += '</div>';

    // List existing quotes
    if (quotes.length > 0) {
      html += '<div class="existing-quotes">';
      html += '<h4 style="color: #b080fa;">Existing Quotes</h4>';

      quotes.forEach((quote, index) => {
        html += `<div class="quote-item" style="border: 1px solid #555; padding: 10px; margin-bottom: 10px; border-radius: 5px;">`;
        html += `<p style="margin: 5px 0; font-style: italic;">${quote}</p>`;
        html += `<button type="submit" name="deleteQuoteIndex" value="${index}" style="background: #e74c3c; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer;">Delete</button>`;
        html += `</div>`;
      });

      html += '</div>';
    } else {
      html += '<p>No quotes added yet.</p>';
    }

    html += '</div>';
    return html;
  }

  /**
   * Render the complete settings page
   */
  renderSettingsPage() {
    const settings = getSettings();

    // Separate Discord, scheduled messages, custom commands, and quotes fields from other fields
    const discordFields = ['discordBotToken', 'discordChannels', 'discordSystemPrompt'];
    const scheduledFields = ['enableScheduledMessages', 'scheduledMessageTimer', 'scheduledMessages'];
    const customCommandFields = ['customCommands'];
    const quotesFields = ['quotes'];
    const regularFields = SETTINGS_EDITABLE_FIELDS.filter(k => !discordFields.includes(k) && !scheduledFields.includes(k) && !customCommandFields.includes(k) && !quotesFields.includes(k) && k !== 'enableDiscordBot' && k !== 'enableQuoteCommand');

    return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Twitch AI Bot Settings</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; background: #262729; color: #f2f2f2; padding:40px; }
          h2 {
            color: #b080fa;
            text-align: center;
          }
          .sections-grid {
            column-count: 2;
            column-gap: 20px;
            max-width: 1200px;
            margin: 0 auto 20px;
            orphans: 1;
            widows: 1;
          }
          .section {
            break-inside: avoid;
            margin-bottom: 20px;
            display: inline-block;
            width: 100%;
            box-sizing: border-box;
            background: #35363a;
            padding: 24px;
            border-radius: 12px;
          }

          .field { margin-bottom: 22px; }
          label { display: block; font-weight: bold; margin-bottom: 6px; }
          input[type="text"], input[type="number"], textarea {
            width: 92%; padding: 7px; border-radius: 5px; border: 1px solid #8070c7; font-size: 1em; background: #202025; color: #fafaff;
          }
          input[type="checkbox"] { width: 20px; height: 20px; }
          textarea { min-height: 80px; }
          button { background: #b080fa; color: #fff; font-weight: bold; border: none; padding: 10px 24px; border-radius: 6px; cursor: pointer; font-size: 1.05em; }
          button:hover { background: #8253d8;}
          .discord-settings { margin-top: 15px; padding: 15px; background: #2a2b2e; border-radius: 5px; border: 1px solid #555; }
          .discord-settings.collapsed { display: none; }
          .custom-commands-section { margin-top: 15px; }
          .scheduled-messages-section { margin-top: 20px; }
          .save-section { text-align: center; margin-top: 24px; border-top: 1px solid #8070c7; padding-top: 16px; }
          @media (max-width: 768px) {
            .sections-grid {
              column-count: 1;
            }
          }
        </style>
        <script>
          function toggleDiscordSettings() {
            const checkbox = document.getElementById('enableDiscordBot');
            const discordSection = document.getElementById('discord-settings');
            if (checkbox.checked) {
              discordSection.classList.remove('collapsed');
            } else {
              discordSection.classList.add('collapsed');
            }
          }

          function initDiscordToggle() {
            const checkbox = document.getElementById('enableDiscordBot');
            checkbox.addEventListener('change', toggleDiscordSettings);
            // Set initial state
            toggleDiscordSettings();
          }

          document.addEventListener('DOMContentLoaded', initDiscordToggle);
        </script>
      </head>
      <body>
      <h2>Twitch AI Bot Settings</h2>

      <form method="POST" action="/">
        <div class="sections-grid">
          <div class="section">
            <h3 style="color: #b080fa; margin-top: 0;">General Settings</h3>
            ${regularFields.map((k) => {
              const label = FIELD_LABELS[k] || k;
              const value = settings[k];
              const field = this.renderInputField(k, value);
              return `<div class="field"><label for="${k}">${label}</label>${field}</div>`;
            }).join("")}
          </div>

          <div class="section">
            <h3 style="color: #b080fa; margin-top: 0;">Custom Commands</h3>
            ${this.renderCustomCommandsField('customCommands', settings.customCommands || [])}
          </div>

          <div class="section">
            <h3 style="color: #b080fa; margin-top: 0;">Scheduled Messages</h3>
            <div class="field">
              <label for="enableScheduledMessages">${FIELD_LABELS.enableScheduledMessages || 'enableScheduledMessages'}</label>
              ${this.renderInputField('enableScheduledMessages', settings.enableScheduledMessages)}
            </div>
            <div class="field">
              <label for="scheduledMessageTimer">${FIELD_LABELS.scheduledMessageTimer || 'scheduledMessageTimer'}</label>
              ${this.renderInputField('scheduledMessageTimer', settings.scheduledMessageTimer)}
            </div>
            ${this.renderScheduledMessagesField('scheduledMessages', settings.scheduledMessages || [])}
          </div>

          <div class="section">
            <h3 style="color: #b080fa; margin-top: 0;">Quotes</h3>
            <div class="field">
              <label for="enableQuoteCommand">${FIELD_LABELS.enableQuoteCommand || 'enableQuoteCommand'}</label>
              ${this.renderInputField('enableQuoteCommand', settings.enableQuoteCommand)}
            </div>
            ${this.renderQuotesField('quotes', settings.quotes || [])}
          </div>

          <div class="section">
            <h3 style="color: #b080fa; margin-top: 0;">Discord Bot</h3>
            <div class="field">
              <label for="enableDiscordBot">${FIELD_LABELS.enableDiscordBot || 'enableDiscordBot'}</label>
              ${this.renderInputField('enableDiscordBot', settings.enableDiscordBot)}
            </div>

            <div id="discord-settings" class="discord-settings${settings.enableDiscordBot ? '' : ' collapsed'}">
              <h4 style="color: #b080fa; margin-top: 20px;">Discord Bot Settings</h4>
              ${discordFields.map((k) => {
                const label = FIELD_LABELS[k] || k;
                const value = settings[k];
                const field = this.renderInputField(k, value);
                return `<div class="field"><label for="${k}">${label}</label>${field}</div>`;
              }).join("")}
            </div>
          </div>
        </div>

        <div class="save-section">
          <button type="submit" name="action" value="save" style="background: #4CAF50;">Save</button>
          <button type="submit" name="action" value="restart" style="background:#e74c3c;margin-left:16px;" onclick="return confirm('Are you sure you want to restart the bot?');">
            Restart Bot
          </button>
        </div>
      </form>
      </body>
    </html>
    `;
  }

  /**
   * Start the web server
   */
  start() {
    this.app.listen(this.port, () => {
      console.log(MESSAGES.WEB_UI_STARTED(this.port));
    });
  }

  /**
   * Update Discord bot settings when settings change
   */
  updateDiscordSettings(settings, openai) {
    if (settings.enableDiscordBot) {
      discordBot.initializeDiscord(settings, openai);
      if (discordClientToken !== settings.discordBotToken) {
        discordClientToken = settings.discordBotToken;
        discordBot.loginDiscord(discordClientToken);
      }
    } else {
      discordBot.disconnectDiscord();
    }
  }
}

module.exports = WebInterface;
