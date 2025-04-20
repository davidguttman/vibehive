const { Events } = require('discord.js')
const Repository = require('../models/Repository') // Adjust path as needed

async function handleFilesCommand (interaction) {
  const repo = await Repository.findOne({ discordChannelId: interaction.channelId })
  if (!repo) {
    await interaction.reply({ content: 'No repository configured for this channel.', ephemeral: true })
    return
  }

  if (repo.contextFiles.length === 0) {
    await interaction.reply({ content: 'No files currently in context.', ephemeral: true })
  } else {
    const fileList = repo.contextFiles.map(f => `\`${f}\``).join('\n')
    await interaction.reply({ content: `**Files in context:**\n${fileList}`, ephemeral: true })
  }
}

async function handleAddCommand (interaction) {
  const repo = await Repository.findOne({ discordChannelId: interaction.channelId })
  if (!repo) {
    await interaction.reply({ content: 'No repository configured for this channel.', ephemeral: true })
    return
  }

  const pathsToAdd = interaction.options.getString('paths').split(' ').filter(p => p.trim() !== '')
  const validPaths = []
  const invalidPaths = []

  for (const p of pathsToAdd) {
    if (p.startsWith('/') || p.includes('..')) {
      invalidPaths.push(p)
    } else {
      validPaths.push(p)
    }
  }

  if (invalidPaths.length > 0) {
    await interaction.reply({ content: `Error: Invalid paths detected: ${invalidPaths.map(p => `\`${p}\``).join(', ')}. Paths cannot start with / or contain ..`, ephemeral: true })
    return // Stop if any path is invalid
  }

  if (validPaths.length === 0) {
    await interaction.reply({ content: 'No valid file paths provided to add.', ephemeral: true })
    return
  }

  try {
    const result = await Repository.updateOne(
      { discordChannelId: interaction.channelId },
      { $addToSet: { contextFiles: { $each: validPaths } } }
    )

    // $addToSet doesn't easily tell us *which* specific files were newly added if some already existed.
    // We rely on the user providing valid paths and confirm the operation based on the attempt.
    if (result.modifiedCount > 0 || result.matchedCount > 0) { // matchedCount > 0 covers case where all files already existed
      await interaction.reply({ content: `Attempted to add files: ${validPaths.map(p => `\`${p}\``).join(', ')}. Use \`/files\` to see the updated list.`, ephemeral: true })
    } else {
      // This case should ideally not happen if the repo was found earlier, but good to handle.
      await interaction.reply({ content: 'Could not find the repository to add files to.', ephemeral: true })
    }
  } catch (error) {
    console.error('Error adding context files:', error)
    await interaction.reply({ content: 'There was an error trying to add the files.', ephemeral: true })
  }
}

async function handleDropCommand (interaction) {
  const repo = await Repository.findOne({ discordChannelId: interaction.channelId })
  if (!repo) {
    await interaction.reply({ content: 'No repository configured for this channel.', ephemeral: true })
    return
  }

  const pathsToRemove = interaction.options.getString('paths').split(' ').filter(p => p.trim() !== '')

  if (pathsToRemove.length === 0) {
    await interaction.reply({ content: 'No file paths provided to remove.', ephemeral: true })
    return
  }

  // Check if any of the paths to remove actually exist in the context
  const currentFiles = repo.contextFiles || []
  const filesActuallyPresent = pathsToRemove.filter(p => currentFiles.includes(p))

  if (filesActuallyPresent.length === 0) {
    await interaction.reply({ content: `None of the specified files (${pathsToRemove.map(p => `\`${p}\``).join(', ')}) were found in the context list.`, ephemeral: true })
    return // Exit early if no files to remove are found
  }

  try {
    // We know at least one file to remove is present, so proceed with update
    const result = await Repository.updateOne(
      { discordChannelId: interaction.channelId },
      { $pull: { contextFiles: { $in: pathsToRemove } } } // Use original pathsToRemove
    )

    // Since we checked existence beforehand, modifiedCount > 0 should be reliable here
    // If somehow modifiedCount is 0 even though we found files, it implies a race condition or unexpected DB state
    if (result.modifiedCount > 0) {
      await interaction.reply({ content: `Removed files: ${pathsToRemove.map(p => `\`${p}\``).join(', ')}. Use \`/files\` to see the updated list.`, ephemeral: true })
    } else {
      // This case *might* happen if files were removed between findOne and updateOne, or if update failed silently
      console.warn(`Context file removal for channel ${interaction.channelId}: modifiedCount was 0 despite files being present initially.`)
      await interaction.reply({ content: 'Attempted to remove files, but the list may not have changed. Please check `/files`.', ephemeral: true })
    }
  } catch (error) {
    console.error('Error removing context files:', error)
    await interaction.reply({ content: 'There was an error trying to remove the files.', ephemeral: true })
  }
}

module.exports = {
  name: Events.InteractionCreate,
  async execute (interaction) {
    if (!interaction.isChatInputCommand()) return

    const { commandName } = interaction

    try {
      if (commandName === 'ping') {
        await interaction.reply('Pong!')
      } else if (commandName === 'addrepo') {
        // Placeholder for addrepo logic (from previous tutorials)
        // Typically involves finding or creating/updating a Repository document
        // const repositoryUrl = interaction.options.getString('repository');
        // const branch = interaction.options.getString('branch');
        // await Repository.findOneAndUpdate(...);
        await interaction.reply({ content: 'Addrepo command acknowledged (implementation pending).', ephemeral: true })
      } else if (commandName === 'files') {
        await handleFilesCommand(interaction)
      } else if (commandName === 'add') {
        await handleAddCommand(interaction)
      } else if (commandName === 'drop') {
        await handleDropCommand(interaction)
      }
    } catch (error) {
      console.error(`Error executing command ${commandName}:`, error)
      // Use deferReply or followUp if reply was already sent/deferred
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true })
      } else {
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true })
      }
    }
  }
}
