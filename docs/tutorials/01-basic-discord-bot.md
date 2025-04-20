# Tutorial: Creating a Basic Discord Bot with Node.js

This tutorial walks you through creating a simple Discord bot using Node.js and the `discord.js` v14 library. The bot will connect to Discord, register a basic slash command (`/ping`), and respond with "Pong!".

## Prerequisites

*   Node.js installed (v16.9.0 or higher recommended for discord.js v14)
*   npm (comes with Node.js)
*   A Discord Bot Token (You can create a bot application and get a token from the [Discord Developer Portal](https://discord.com/developers/applications))

## Step 1: Initialize Project and Install Dependencies

1.  Create a new directory for your project and navigate into it:
    ```bash
    mkdir my-discord-bot
    cd my-discord-bot
    ```

2.  Initialize a new Node.js project:
    ```bash
    npm init -y
    ```

3.  Install the necessary libraries:
    *   `discord.js`: The main library for interacting with the Discord API.
    *   `dotenv`: To manage environment variables (like your bot token).
    *   `standard`: A linter to enforce JavaScript Standard Style (as a dev dependency).

    ```bash
    npm install discord.js dotenv
    npm install --save-dev standard
    ```

4.  Add a lint script to your `package.json`:
    Open `package.json` and add the following script under `"scripts"`:
    ```json
    "scripts": {
      "lint": "standard --fix",
      "start": "node index.js" // Optional: Add a start script
    },
    ```
    Your `package.json` should look something like this (versions might differ):
    ```json
    {
      "name": "my-discord-bot",
      "version": "1.0.0",
      "description": "",
      "main": "index.js",
      "scripts": {
        "lint": "standard --fix",
        "start": "node index.js",
        "test": "echo \\"Error: no test specified\\" && exit 1"
      },
      "keywords": [],
      "author": "",
      "license": "ISC",
      "dependencies": {
        "discord.js": "^14.7.1", // Example version
        "dotenv": "^16.0.3"    // Example version
      },
      "devDependencies": {
        "standard": "^17.0.0" // Example version
      }
    }
    ```

## Step 2: Create the Bot Entry Point (`index.js`)

Create a file named `index.js` in your project root. This will be the main file for your bot.

```javascript
// index.js

// 1. Package Requires
require('dotenv').config() // Load environment variables from .env file
const { Client, GatewayIntentBits, Events, REST, Routes } = require('discord.js')

// 2. Local Requires (None for this simple example)

// 3. Constants
const BOT_TOKEN = process.env.DISCORD_TOKEN
const CLIENT_ID = process.env.DISCORD_CLIENT_ID // Add your Client ID to .env

// Simple command definition
const commands = [
  {
    name: 'ping',
    description: 'Replies with Pong!'
  }
]

// 4. Immediately Run Code

// Check if token is provided
if (!BOT_TOKEN) {
  console.error('Error: DISCORD_TOKEN is required in your .env file')
  process.exit(1)
}
if (!CLIENT_ID) {
  console.error('Error: DISCORD_CLIENT_ID is required in your .env file')
  process.exit(1)
}

// Discord Client Setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds // Required for basic guild information
    // Add other intents as needed
  ]
})

// REST API setup for command registration
const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

// Function to register slash commands
(async () => {
  try {
    console.log('Started refreshing application (/) commands.')

    await rest.put(
      Routes.applicationCommands(CLIENT_ID), // Register globally - takes time to propagate
      // Use Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) for faster testing in a specific server
      { body: commands }
    )

    console.log('Successfully reloaded application (/) commands.')
  } catch (error) {
    console.error('Error registering commands:', error)
  }
})()

// Event: Bot Ready
client.once(Events.ClientReady, c => {
  console.log(\`Ready! Logged in as ${c.user.tag}\`)
})

// Event: Interaction Created (Slash Command Execution)
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return // Only handle slash commands

  const { commandName } = interaction

  console.log(\`Received interaction: ${commandName}\`)

  if (commandName === 'ping') {
    try {
      await interaction.reply('Pong!')
      console.log('Replied to /ping command.')
    } catch (error) {
      console.error('Error replying to ping:', error)
      // Inform user if possible
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true })
      } else {
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true })
      }
    }
  }
  // Add handlers for other commands here
})

// Login to Discord
client.login(BOT_TOKEN)
  .then(() => console.log('Login successful!'))
  .catch(error => {
    console.error('Login failed:', error)
    process.exit(1) // Exit if login fails
  })

// 5. Module Exports (None needed for this file)

// 6. Functions (Helper functions could go here if the file grew larger)

```

## Step 3: Configure Environment Variables (`.env`)

Create a file named `.env` in the root of your project. **Important:** Add `.env` to your `.gitignore` file to avoid committing your bot token!

```
# .env
DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE
DISCORD_CLIENT_ID=YOUR_APPLICATION_CLIENT_ID_HERE
```

Replace `YOUR_BOT_TOKEN_HERE` with your actual bot token and `YOUR_APPLICATION_CLIENT_ID_HERE` with your bot's Application Client ID (found on the same page as the token in the Discord Developer Portal).

Create or update your `.gitignore` file:
```
# .gitignore
node_modules
.env
```

## Step 4: Run the Linter

Ensure your code follows standard style:
```bash
npm run lint
```
This command will automatically fix most style issues.

## Step 5: Run the Bot

Start your bot using Node.js:
```bash
node index.js
# Or if you added the start script: npm start
```
You should see output like:
```
Started refreshing application (/) commands.
Successfully reloaded application (/) commands.
Login successful!
Ready! Logged in as YourBotName#1234
```

## Step 6: Invite Your Bot and Test

1.  Go to the Discord Developer Portal -> Your Application -> OAuth2 -> URL Generator.
2.  Select the `bot` and `applications.commands` scopes.
3.  Select necessary Bot Permissions (e.g., `Send Messages`).
4.  Copy the generated URL and paste it into your browser to invite the bot to a server where you have permissions.
5.  In the Discord server, type `/ping`. The bot should respond with "Pong!". You should also see log messages in your terminal.

    *Note:* Global slash commands can take up to an hour to register. For faster testing during development, consider registering commands to a specific guild (server) using `Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)`. You'll need the Guild ID and potentially need to add `GatewayIntentBits.GuildMessages` and `GatewayIntentBits.MessageContent` intents depending on your commands.

## Step 7: Basic README.md

Create a `README.md` file in your project root:

```markdown
# My Discord Bot

A basic Discord bot built with Node.js and discord.js v14.

## Setup

1.  Clone the repository (or download the files).
2.  Install dependencies:
    \`\`\`bash
    npm install
    \`\`\`
3.  Create a \`.env\` file in the project root with your bot token and client ID:
    \`\`\`
    DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE
    DISCORD_CLIENT_ID=YOUR_APPLICATION_CLIENT_ID_HERE
    \`\`\`
4.  (Optional) Lint the code:
    \`\`\`bash
    npm run lint
    \`\`\`

## Running the Bot

\`\`\`bash
node index.js
# or
npm start
\`\`\`

## Features

*   Responds "Pong!" to the \`/ping\` slash command.
```

## Step 8: Testing with Tape (Optional but Recommended)

1.  Install `tape`:
    ```bash
    npm install --save-dev tape
    ```
2.  Update the `test` script in `package.json`:
    ```json
    "scripts": {
      "lint": "standard --fix",
      "start": "node index.js",
      "test": "tape test/**/*.test.js" // Run all .test.js files in the test directory
    },
    ```
3.  Create a `test` directory and a `test/ping.test.js` file:
    ```bash
    mkdir test
    touch test/ping.test.js
    ```
4.  Write a basic test for the ping command logic. *Note: This is a simplified example. Properly testing Discord interactions often requires more sophisticated mocking.*

    ```javascript
    // test/ping.test.js
    const test = require('tape')

    // Mock interaction object (very basic)
    const createMockInteraction = (commandName) => ({
      commandName: commandName,
      isChatInputCommand: () => true,
      reply: async (message) => {
        // In a real test, you might assert the message content
        console.log(`Mock Reply: ${message}`)
        return Promise.resolve() // Simulate successful reply
      },
      // Add other methods/properties used by your handler as needed
      replied: false,
      deferred: false
    })

    // Simulate the core logic from your interaction handler
    async function handlePingInteraction (interaction) {
      if (interaction.commandName === 'ping') {
        try {
          await interaction.reply('Pong!')
          return 'Replied Pong!' // Return status for testing
        } catch (error) {
          console.error('Mock Error replying:', error)
          return 'Error occurred'
        }
      }
      return 'Not a ping command'
    }

    test('Ping Command Handler', async (t) => {
      const mockPingInteraction = createMockInteraction('ping')
      const result = await handlePingInteraction(mockPingInteraction)

      t.equal(result, 'Replied Pong!', 'Should reply Pong! to /ping command')

      const mockOtherInteraction = createMockInteraction('other')
      const otherResult = await handlePingInteraction(mockOtherInteraction)
      t.equal(otherResult, 'Not a ping command', 'Should ignore non-ping commands')

      t.end() // End the test explicitly
    })

    // Add more tests as needed
    ```

5.  Run the tests:
    ```bash
    npm test
    ```
    You should see output indicating the test passed. Ensure the process exits cleanly (it should with `tape` and `t.end()`).

---

Congratulations! You've built and tested a basic Discord bot. You can expand on this foundation by adding more commands, event listeners, and features. Remember to consult the [discord.js documentation](https://discord.js.org/) for more advanced usage. 