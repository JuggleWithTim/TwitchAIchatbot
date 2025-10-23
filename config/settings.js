const fs = require('fs').promises;
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '..', 'settings.json');

let SETTINGS = {};

async function loadSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
    SETTINGS = JSON.parse(raw);
  } catch (error) {
    console.error('Error loading settings:', error);
    SETTINGS = {};
  }

  return SETTINGS;
}

async function saveSettings(newSettings = null) {
  if (newSettings) {
    SETTINGS = { ...SETTINGS, ...newSettings };
  }

  try {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(SETTINGS, null, 2), 'utf-8');
    console.log('Settings saved successfully');
  } catch (error) {
    console.error('Error saving settings:', error);
    throw error;
  }
}

function getSettings() {
  return SETTINGS;
}

function getSetting(key, defaultValue = null) {
  return SETTINGS[key] !== undefined ? SETTINGS[key] : defaultValue;
}

function setSetting(key, value) {
  SETTINGS[key] = value;
}

module.exports = {
  loadSettings,
  saveSettings,
  getSettings,
  getSetting,
  setSetting
};
