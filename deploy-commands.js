const { REST, Routes, SlashCommandBuilder } = require('discord.js')
const config = require('./config')

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Replies with pong!'),
  new SlashCommandBuilder()
    .setName('addrepo')
    .setDescription('Adds or updates a repository configuration for this channel')
    .addStringOption(option =>
      option.setName('repository')
        .setDescription('The GitHub repository URL (e.g., https://github.com/owner/repo)')
        .setRequired(true))
    .addAttachmentOption(option =>
      option.setName('ssh_key')
        .setDescription('Your SSH private key file (will be encrypted).')
        .setRequired(true))
    .setDefaultMemberPermissions(0)
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('files')
    .setDescription('Lists the files currently in context for this channel'),
  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Adds files to the context for this channel')
    .addStringOption(option =>
      option.setName('paths')
        .setDescription('Space-separated file paths to add')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('drop')
    .setDescription('Removes files from the context for this channel')
    .addStringOption(option =>
      option.setName('paths')
        .setDescription('Space-separated file paths to remove')
        .setRequired(true))
]
  .map(command => command.toJSON())

const rest = new REST({ version: '10' }).setToken(config.discord.token)

;(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`)

    // The put method is used to fully refresh all commands in the guild with the current set
    const data = await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body: commands }
    )

    console.log(`Successfully reloaded ${data.length} application (/) commands.`)
  } catch (error) {
    // And of course, make sure you catch and log any errors!
    console.error(error)
  }
})()
