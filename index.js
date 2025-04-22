// index.js

// 1. Package Requires
// require('dotenv').config() // Load environment variables from .env file // Removed
const fs = require('node:fs') // Added for event file loading
const path = require('node:path') // Added for event file loading
const {
  Client, GatewayIntentBits, Events
  // Removed unused: REST, Routes, PermissionsBitField, SlashCommandBuilder
} = require('discord.js')

// 2. Local Requires
const config = require('./config') // Use the config module // Added
const { connectDB } = require('./lib/mongo') // Import connectDB // Added
// const Repository = require('./models/Repository') // <<< REMOVE
// const { invokeAiderWrapper } = require('./lib/pythonWrapper') // <<< REMOVE

// 3. Constants
// const BOT_TOKEN = process.env.DISCORD_TOKEN // Removed
// const CLIENT_ID = process.env.DISCORD_CLIENT_ID // Add your Client ID to .env // Removed
// Use constants from config // Added
const { discordToken } = config // Added

// Command definitions using SlashCommandBuilder // Modified
// const commands = [
//   new SlashCommandBuilder() // Modified
//     .setName('ping') // Modified
//     .setDescription('Replies with Pong!'), // Modified
//   new SlashCommandBuilder() // Added
//     .setName('add-repo') // Added
//     .setDescription('Adds a repository to be monitored in this channel.') // Added
//     .addStringOption(option => // Added
//       option.setName('url') // Added
//         .setDescription('The full URL (HTTPS or SSH) of the repository.') // Added
//         .setRequired(true)) // Added
//     // Optional: Set permissions directly on the command definition // Added
//     // .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator) // Added
//     // .setDMPermission(false) // Disable in DMs // Added
// ]
//   // Convert all command builder instances to JSON for the REST API // Added
//   .map(command => command.toJSON()) // Added

// 4. Immediately Run Code

// Config module already handles validation // Added

// Discord Client Setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // Required for basic guild information
    GatewayIntentBits.GuildMessages, // Added
    GatewayIntentBits.MessageContent // Added (Privileged)
  ]
})

// REST API setup for command registration
// const rest = new REST({ version: '10' }).setToken(discordToken) // Added // MOVED to deploy-commands.js

// Function to register slash commands // MOVED to deploy-commands.js
// async function registerCommands () {
//   try {
//     console.log(`Started refreshing ${commands.length} application (/) commands.`) // Log count // Modified
//
//     await rest.put(
//       Routes.applicationCommands(discordClientId), // Register globally // Added
//       // Use Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) for faster testing in a specific server
//       { body: commands } // Use the mapped JSON command definitions // Modified
//     )
//
//     console.log(`Successfully reloaded ${commands.length} application (/) commands.`) // Log count // Modified
//   } catch (error) {
//     console.error('Error registering commands:', error)
//   }
// }

// Event: Bot Ready
client.once(Events.ClientReady, c => {
  console.log(`Ready! Logged in as ${c.user.tag}`)
})

// --- Load Event Handlers --- // Added Block
const eventsPath = path.join(__dirname, 'events')
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'))

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file)
  const event = require(filePath)
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args))
  } else {
    client.on(event.name, (...args) => event.execute(...args))
  }
  console.log(`Loaded event handler: ${event.name} from ${file}`)
}
// --- End Load Event Handlers --- // Added Block

// Login to Discord and Connect to DB
async function startBot () {
  try {
    await connectDB() // Connect to DB first
    // await registerCommands() // Register commands after DB connection, before login // MOVED to deploy-commands.js
    await client.login(discordToken) // Then login to Discord
    console.log('Login successful!')
  } catch (error) {
    console.error('Bot failed to start:', error)
    process.exit(1)
  }
}

// Only run startup logic if this file is executed directly
if (require.main === module) {
  startBot()
}

// 5. Module Exports (None needed for this file)
module.exports = {} // Remove handleMessageCreate export

// 6. Functions (Helper functions could go here if the file grew larger)
