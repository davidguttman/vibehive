// index.js

// 1. Package Requires
// require('dotenv').config() // Load environment variables from .env file // Removed
const { Client, GatewayIntentBits, Events, REST, Routes } = require('discord.js')

// 2. Local Requires
const config = require('./config') // Use the config module // Added
const { connectDB } = require('./lib/mongo') // Import connectDB // Added

// 3. Constants
// const BOT_TOKEN = process.env.DISCORD_TOKEN // Removed
// const CLIENT_ID = process.env.DISCORD_CLIENT_ID // Add your Client ID to .env // Removed
// Use constants from config // Added
const { discordToken, discordClientId } = config // Added

// Simple command definition
const commands = [
  {
    name: 'ping',
    description: 'Replies with Pong!'
  }
]

// 4. Immediately Run Code

// Check if token is provided // Removed block
// if (!BOT_TOKEN) { // Removed
//   console.error('Error: DISCORD_TOKEN is required in your .env file') // Removed
//   process.exit(1) // Removed
// } // Removed
// if (!CLIENT_ID) { // Removed
//   console.error('Error: DISCORD_CLIENT_ID is required in your .env file') // Removed
//   process.exit(1) // Removed
// } // Removed
// Config module already handles validation // Added

// Discord Client Setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds // Required for basic guild information
    // Add other intents as needed
  ]
})

// REST API setup for command registration
// const rest = new REST({ version: '10' }).setToken(BOT_TOKEN); // Removed
const rest = new REST({ version: '10' }).setToken(discordToken); // Added

// Function to register slash commands
(async () => {
  try {
    console.log('Started refreshing application (/) commands.')

    await rest.put(
      // Routes.applicationCommands(CLIENT_ID), // Register globally - takes time to propagate // Removed
      Routes.applicationCommands(discordClientId), // Register globally - takes time to propagate // Added
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

// Login to Discord and Connect to DB // Added block
async function startBot () { // Added
  try { // Added
    await connectDB() // Connect to DB first // Added
    await client.login(discordToken) // Then login to Discord // Added
    console.log('Login successful!') // Added
  } catch (error) { // Added
    console.error('Bot failed to start:', error) // Added
    process.exit(1) // Added
  } // Added
} // Added

startBot() // Call the async start function // Added
// Removed block
// .then(() => console.log('Login successful!'))
// .catch(error => {
//   console.error('Login failed:', error)
//   process.exit(1) // Exit if login fails
// })

// 5. Module Exports (None needed for this file)

// 6. Functions (Helper functions could go here if the file grew larger)
