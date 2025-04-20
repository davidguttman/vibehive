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
const Repository = require('./models/Repository') // Import the Repository model // Added
const { invokeAiderWrapper } = require('./lib/pythonWrapper') // Added import

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

// Exportable handler function
async function handleMessageCreate (client, message) {
  // 1. Ignore messages from bots (including self)
  if (message.author.bot) return

  // 2. Check if the bot was mentioned
  if (message.mentions.has(client.user)) {
    console.log(`Bot mentioned by ${message.author.tag} in channel ${message.channel.id}`)

    // 3. Extract the prompt (remove mention + trim)
    const mentionRegex = new RegExp(`^<@!?${client.user.id}>\\s*`)
    const prompt = message.content.replace(mentionRegex, '').trim()

    if (!prompt) {
      // If the message was just the mention with nothing else
      console.log('Mention received without a prompt.')
      message.reply('You mentioned me, but didn\'t provide a prompt!').catch(console.error) // Optional reply
      return
    }

    console.log(`Extracted prompt: "${prompt}"`)

    // 4. Get channelId
    const channelId = message.channelId

    let processingMessage // Declare outside try
    try {
      // Ensure DB is connected (assuming connectDB handles multiple calls safely)
      await connectDB()

      // 5. Find Repository config for this channel
      const repoConfig = await Repository.findOne({ discordChannelId: channelId })

      if (!repoConfig) {
        console.log(`No repository configured for channel ${channelId}`)
        message.reply({ content: 'This channel is not configured for AI interactions. An admin can use `/add-repo` to set it up.', ephemeral: true }).catch(console.error)
        return
      }

      console.log(`Found repository config for channel ${channelId}: ${repoConfig.repoUrl}`)

      // Get context files from the repo doc
      const contextFiles = repoConfig.contextFiles || [] // Added

      // Add some user feedback that the request is being processed
      processingMessage = await message.reply('Processing your request...').catch(console.error)

      // 6. Invoke the Python wrapper
      const result = await invokeAiderWrapper({ prompt, contextFiles }) // Pass contextFiles

      // 7. Process the result (Revised logic)
      if (result.status === 'failure') {
        console.error('Python wrapper execution failed:', { error: result.error, stdout: result.stdout })
        message.reply('❌ An error occurred while processing your request. Details logged.').catch(console.error)
      } else if (result.status === 'success') {
        // Access parsed JSON data
        const data = result.data
        if (!data) {
          console.error('Python wrapper succeeded but returned no data.')
          message.reply('❌ An error occurred: No data received from the process.').catch(console.error)
        } else if (data.overall_status === 'failure') {
          console.error('Python script reported failure:', data.error)
          message.reply('❌ An error occurred within the script execution. Details logged.').catch(console.error)
        } else if (data.overall_status === 'success') {
          // Find the text response event
          const textEvent = data.events?.find(event => event.type === 'text_response')

          if (textEvent && textEvent.content) {
            // Reply with the content
            console.log('Sending text response to Discord:', textEvent.content)
            // Split long messages if necessary (Discord limit is 2000 chars)
            const content = textEvent.content
            const maxLength = 1950 // Leave room for formatting/mention
            if (content.length > maxLength) {
              // Simple split, could be improved later
              const chunks = []
              for (let i = 0; i < content.length; i += maxLength) {
                chunks.push(content.substring(i, i + maxLength))
              }
              message.reply(`**Response for @${message.author.username}:** (Part 1)`).catch(console.error)
              for (let i = 0; i < chunks.length; i++) {
                message.channel.send(`\`\`\`\n${chunks[i]}\n\`\`\` ${i + 1 < chunks.length ? `(Part ${i + 2})` : ''}`).catch(console.error)
              }
            } else {
              message.reply(`**Response for @${message.author.username}:**\n\`\`\`\n${content}\n\`\`\``).catch(console.error)
            }
          } else {
            // No text response found
            console.log('Script execution succeeded, but no text_response event found.')
            message.reply('✅ Process completed successfully, but no text output was generated.').catch(console.error)
          }
        } else {
          // Unknown overall_status
          console.warn('Unknown overall_status received:', data.overall_status)
          message.reply('❓ The process finished with an unknown status.').catch(console.error)
        }
      } else {
        // Unknown wrapper status
        console.error('Unknown status received from Python wrapper:', result.status)
        message.reply('❌ An unexpected error occurred while processing your request.').catch(console.error)
      }

      // Optionally delete the 'Processing...' message if it exists
      if (processingMessage) {
        processingMessage.delete().catch(console.error)
      }
    } catch (error) {
      console.error('Error handling mention:', error)
      // Ensure 'processingMessage' is accessible if declared outside try
      if (typeof processingMessage !== 'undefined' && processingMessage) {
        processingMessage.delete().catch(console.error) // Attempt deletion even on error
      }
      try {
        message.reply('Sorry, something went wrong while processing your request.').catch(console.error)
      } catch (replyError) {
        // Should not happen if initial reply error is caught
        console.error('Failed to send error reply:', replyError)
      }
    }
  }
  // No mention or handled above, ignore the message otherwise
}

// Attach the handler
client.on(Events.MessageCreate, (message) => handleMessageCreate(client, message))

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
module.exports = { handleMessageCreate } // Remove client export

// 6. Functions (Helper functions could go here if the file grew larger)
