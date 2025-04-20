const { Events } = require('discord.js')
const Repository = require('../models/Repository') // Adjust path as needed
const { encrypt } = require('../lib/crypto') // Import encrypt
const mongoose = require('mongoose') // Need mongoose for validation error check

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

async function handleAddRepoCommand (interaction) {
  // Permission Check (Example: Assuming only admins can run this)
  // You might have a more sophisticated role/permission check
  if (!interaction.member.permissions.has('Administrator')) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true })
  }

  await interaction.deferReply({ ephemeral: true }) // Defer reply as fetching/encrypting might take time

  const repoUrl = interaction.options.getString('repository')
  // --- New Attachment Handling --- START ---
  const attachment = interaction.options.getAttachment('ssh_key')

  if (!attachment) {
    // This shouldn't happen if the option is required, but good practice to check
    return interaction.followUp({ content: 'Error: SSH key attachment is missing.', ephemeral: true })
  }

  // Optional: Add checks for attachment.contentType or size if desired
  // console.log('Attachment type:', attachment.contentType)

  let sshKeyContent
  try {
    console.log(`Fetching SSH key from: ${attachment.url}`)
    const response = await fetch(attachment.url)
    if (!response.ok) {
      throw new Error(`Failed to fetch key (${response.status}): ${response.statusText}`)
    }
    sshKeyContent = await response.text()
    if (!sshKeyContent || sshKeyContent.trim() === '') {
      throw new Error('Fetched key content is empty or whitespace.')
    }
    console.log('SSH key fetched successfully.')
  } catch (error) {
    console.error('Error fetching SSH key attachment:', error)
    return interaction.followUp({ content: `Error fetching the SSH key file: ${error.message}. Please check the URL or try again.`, ephemeral: true })
  }

  let encryptedKey
  try {
    encryptedKey = encrypt(sshKeyContent)
    console.log('SSH key encrypted successfully.')
  } catch (error) {
    console.error('Error encrypting SSH key:', error)
    // Provide a less specific error to the user for security
    return interaction.followUp({ content: 'Error processing the SSH key. Ensure it is a valid key file and the ENCRYPTION_KEY is set correctly.', ephemeral: true })
  }
  // --- New Attachment Handling --- END ---

  const channelId = interaction.channelId

  try {
    // Use updateOne with upsert:true to handle both create and update
    const result = await Repository.updateOne(
      { discordChannelId: channelId },
      {
        $set: {
          repoUrl,
          encryptedSshKey: encryptedKey // Store the encrypted key
        },
        $setOnInsert: { discordChannelId: channelId } // Set channelId only on insert
      },
      { upsert: true, runValidators: true } // Create if not exists, validate
    )

    let confirmationMessage = ''
    if (result.upsertedId) {
      confirmationMessage = `Repository configured: ${repoUrl}. SSH key uploaded and secured.`
      console.log(`Repository inserted for channel ${channelId}`)
    } else if (result.modifiedCount > 0) {
      confirmationMessage = `Repository configuration updated: ${repoUrl}. New SSH key uploaded and secured.`
      console.log(`Repository updated for channel ${channelId}`)
    } else {
      // This means the repoUrl and encryptedSshKey were the same as already stored
      confirmationMessage = `Repository configuration unchanged (already set to ${repoUrl}). SSH key re-uploaded and secured.`
      console.log(`Repository unchanged for channel ${channelId}`)
    }

    await interaction.followUp({ content: confirmationMessage, ephemeral: true })
  } catch (error) {
    console.error(`Database error saving repository for channel ${channelId}:`, error)
    let userErrorMessage = 'An error occurred while saving the repository configuration.'
    // Use instanceof for better error type checking
    if (error instanceof mongoose.Error.ValidationError) {
      userErrorMessage = `Validation Error: ${Object.values(error.errors).map(e => e.message).join(', ')}`
    } else if (error.code === 11000) {
      // This specific duplicate key error is less likely with updateOne/upsert on channelId,
      // unless another unique index exists.
      userErrorMessage = 'A unique constraint was violated (maybe repository URL already exists for another channel?).'
    }
    await interaction.followUp({ content: userErrorMessage, ephemeral: true })
  }
}

module.exports = {
  name: Events.InteractionCreate,
  async execute (interaction) {
    // Only handle commands from guilds
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Commands can only be used in a server.', ephemeral: true })
    }

    if (!interaction.isChatInputCommand()) return

    const { commandName } = interaction

    try {
      if (commandName === 'ping') {
        await interaction.reply('Pong!')
      } else if (commandName === 'addrepo') {
        await handleAddRepoCommand(interaction) // Use the new handler
      } else if (commandName === 'files') {
        await handleFilesCommand(interaction)
      } else if (commandName === 'add') {
        await handleAddCommand(interaction)
      } else if (commandName === 'drop') {
        await handleDropCommand(interaction)
      }
    } catch (error) {
      console.error(`Error executing command ${commandName} for user ${interaction.user.tag} in channel ${interaction.channelId}:`, error)

      const errorMessage = 'There was an error while executing this command!'
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true })
          .catch(err => console.error('Error sending followUp error message:', err))
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true })
          .catch(err => console.error('Error sending reply error message:', err))
      }
    }
  }
}
