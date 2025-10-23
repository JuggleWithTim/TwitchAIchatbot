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

      // Update settings from form data
      for (const k of SETTINGS_EDITABLE_FIELDS) {
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

      const action = req.body.action || "save";
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
   * Render the complete settings page
   */
  renderSettingsPage() {
    const settings = getSettings();

    return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Twitch AI Bot Settings</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; background: #262729; color: #f2f2f2; padding:40px; }
          h2 { color: #b080fa; }
          form { background: #35363a; padding: 24px; border-radius: 12px; max-width: 600px; margin: auto;}
          .field { margin-bottom: 22px; }
          label { display: block; font-weight: bold; margin-bottom: 6px; }
          input[type="text"], input[type="number"], textarea {
            width: 92%; padding: 7px; border-radius: 5px; border: 1px solid #8070c7; font-size: 1em; background: #202025; color: #fafaff;
          }
          input[type="checkbox"] { width: 20px; height: 20px; }
          textarea { min-height: 80px; }
          button { background: #b080fa; color: #fff; font-weight: bold; border: none; padding: 10px 24px; border-radius: 6px; cursor: pointer; font-size: 1.05em; }
          button:hover { background: #8253d8;}
        </style>
      </head>
      <body>
      <h2>Twitch AI Bot Settings</h2>
      <form method="POST" action="/">
        ${SETTINGS_EDITABLE_FIELDS.map((k) => {
          const label = FIELD_LABELS[k] || k;
          const value = settings[k];
          const field = this.renderInputField(k, value);
          return `<div class="field"><label for="${k}">${label}</label>${field}</div>`;
        }).join("")}
        <button type="submit" name="action" value="save">Save</button>
        <button type="submit" name="action" value="restart" style="background:#e74c3c;margin-left:16px;" onclick="return confirm('Are you sure you want to restart the bot?');">
          Restart Bot
        </button>
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
