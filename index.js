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
  console.log(`Ready! Logged in as ${c.user.tag}`)
})

// Event: Interaction Created (Slash Command Execution)
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return // Only handle slash commands

  const { commandName } = interaction

  console.log(`Received interaction: ${commandName}`)

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
