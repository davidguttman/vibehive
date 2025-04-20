// index.js

// 1. Package Requires
// require('dotenv').config() // Load environment variables from .env file // Removed
const {
  Client, GatewayIntentBits, Events, REST, Routes,
  PermissionsBitField, // Import PermissionsBitField // Added
  SlashCommandBuilder // Import SlashCommandBuilder // Added
} = require('discord.js')

// 2. Local Requires
const config = require('./config') // Use the config module // Added
const { connectDB } = require('./lib/mongo') // Import connectDB // Added

// 3. Constants
// const BOT_TOKEN = process.env.DISCORD_TOKEN // Removed
// const CLIENT_ID = process.env.DISCORD_CLIENT_ID // Add your Client ID to .env // Removed
// Use constants from config // Added
const { discordToken, discordClientId } = config // Added

// Command definitions using SlashCommandBuilder // Modified
const commands = [
  new SlashCommandBuilder() // Modified
    .setName('ping') // Modified
    .setDescription('Replies with Pong!'), // Modified
  new SlashCommandBuilder() // Added
    .setName('add-repo') // Added
    .setDescription('Adds a repository to be monitored in this channel.') // Added
    .addStringOption(option => // Added
      option.setName('url') // Added
        .setDescription('The full URL (HTTPS or SSH) of the repository.') // Added
        .setRequired(true)) // Added
    // Optional: Set permissions directly on the command definition // Added
    // .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator) // Added
    // .setDMPermission(false) // Disable in DMs // Added
]
  // Convert all command builder instances to JSON for the REST API // Added
  .map(command => command.toJSON()) // Added

// 4. Immediately Run Code

// Config module already handles validation // Added

// Discord Client Setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds // Required for basic guild information
    // Add other intents as needed
  ]
})

// REST API setup for command registration
const rest = new REST({ version: '10' }).setToken(discordToken); // Added

// Function to register slash commands
(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`) // Log count // Modified

    await rest.put(
      Routes.applicationCommands(discordClientId), // Register globally // Added
      // Use Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) for faster testing in a specific server
      { body: commands } // Use the mapped JSON command definitions // Modified
    )

    console.log(`Successfully reloaded ${commands.length} application (/) commands.`) // Log count // Modified
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
  // Ensure the interaction is from a guild (server) // Added
  if (!interaction.inGuild()) { // Added
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true }) // Added
    return // Added
  } // Added

  const { commandName } = interaction

  console.log(`Received interaction: ${commandName}`)

  if (commandName === 'ping') {
    try {
      // Defer reply for potentially longer operations (good practice) // Added
      // await interaction.deferReply({ ephemeral: false }); // Example: public deferral // Added
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
  } else if (commandName === 'add-repo') { // Added
    try { // Added
      // 1. Check Permissions // Added
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) { // Added
        await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true }) // Added
        console.log(`User ${interaction.user.tag} attempted to use /add-repo without permissions.`) // Added
        return // Added
      } // Added

      // 2. Get the URL option // Added
      const repoUrl = interaction.options.getString('url') // 'url' matches the option name // Added
      if (!repoUrl) { // Should not happen if option is required, but good practice to check // Added
        await interaction.reply({ content: 'Error: The repository URL is missing.', ephemeral: true }) // Added
        return // Added
      } // Added

      // 3. Reply with acknowledgement (temporary) // Added
      // It's often good to defer the reply if the next steps take time // Added
      await interaction.deferReply({ ephemeral: true }) // Acknowledge privately for now // Added

      // --- Placeholder for future logic (saving to DB) --- // Added
      console.log(`Admin ${interaction.user.tag} requested to add repo: ${repoUrl} in channel ${interaction.channelId}`) // Added
      // --- End Placeholder --- // Added

      // Follow up after deferral // Added
      await interaction.followUp({ content: `Received request to add repository: ${repoUrl}`, ephemeral: true }) // Added
    } catch (error) { // Added
      console.error('Error handling /add-repo command:', error) // Added
      if (interaction.replied || interaction.deferred) { // Added
        await interaction.followUp({ content: 'There was an error processing your request.', ephemeral: true }) // Added
      } else { // Added
        await interaction.reply({ content: 'There was an error processing your request.', ephemeral: true }) // Added
      } // Added
    } // Added
  } // Added
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

// 5. Module Exports (None needed for this file)

// 6. Functions (Helper functions could go here if the file grew larger)
