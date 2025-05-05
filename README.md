# TwitchAIchatbot
Twitch chatbot using chat history as context for Ollama or OpenAI LLMs

## Features
* Responds to mentions
* Optional adjustable timer where the bot automatically engages with chat when it's not been mentioned for a set amount of time.
* Adjustable context length (how many messages back it has knowledge about)
* Support for reasoning models (hides think tags and its content from chat output)
* Option to use OpenAI's API instead of a local Ollama model
* Generate images with DALLE 3

## Chat commands
* !aiauto - Toggle auto-messages on/off
* !aitimer \<minutes\> - Set auto-message timer
* !aisysprompt \<new prompt\> - Update system prompt
* !airesetprompt - Resets the system prompt to default
* !aicontext \<number\> - Set context history length (1-50) (how many messages it has knowledge about)
* !aistop - Pause the bot
* !aistart - Resume the bot
* !imagine \<image description\> - Generates an image with DALLE 3
* !so \<username\> A shoutout command that crafts unique messages based on the profile page and recent stream of the user getting the shoutout.
* !aihelp - Show list of commands

## Cloud hosting
If you don't want to bother setting this up yourself and want it always available in the cloud. I provide hosting of this bot for [Patreon](patreon.com/JuggleWithTim) supporters.
(NOTE: Only available with OpenAI models because my server has no GPU)

## Installation
### 1. Prerequisites
* [Node.js](https://nodejs.org/) (version 16 or higher) installed.
* An [Ollama](https://ollama.com/) instance running locally. (Not needed if using OpenAI's API)
* A Twitch account for the bot and an [OAuth](https://twitchtokengenerator.com/) token.

### 2. Clone the Repository (or download and unpack zip)
`git clone https://github.com/JuggleWithTim/TwitchAIchatbot.git`

### 3. Install Dependencies
* Open the command prompt and navigate to the folder containing bot.js
`cd /path/to/TwitchAIchatbot`
* Install required npm packages with `npm install tmi.js axios openai fs path`
* Make sure Ollama has the model you want to use installed. Run `ollama run llama3.2` in the command prompt to install the default model.

### 4. Configure the Bot
* Open `settings.json` in a text editor
* Fill in all required settings. This is the default settings when the bot is started, some settings can be changed with commands or in the webUI during runtime.

### 5. Run the bot
* Make sure your command prompt is navigated to the bots folder. `cd /path/to/TwitchAIchatbot`
* Start the bot by running `node bot.js` in your command prompt
