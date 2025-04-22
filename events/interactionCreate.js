const { Events } = require('discord.js')
const path = require('node:path') // <<< Added
const fs = require('node:fs/promises') // <<< Added
const { execFileSync, spawn } = require('node:child_process') // <<< Added
const Repository = require('../models/Repository') // Adjust path as needed
const { encrypt, decrypt } = require('../lib/crypto') // Import encrypt and decrypt
const { writeTempKey, deleteTempKey } = require('../lib/secureKeys') // <<< Added
const config = require('../config') // <<< Added
const { gitAddAll, gitCommit, gitPush } = require('../lib/gitHelper') // <<< Add this
const { invokeAiderWrapper } = require('../lib/aider') // <<< Ensure this is imported

// Define the pool of available coder users
const CODER_USER_POOL = ['coder1', 'coder2', 'coder3', 'coder4', 'coder5']

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
  if (!interaction.member.permissions.has('Administrator')) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true })
  }

  await interaction.deferReply({ ephemeral: true }) // Defer reply

  // Assign these early for use in potential cleanup blocks
  let repoPath = null
  let keyFilePath = null
  let assignedUserId = null // Defined here for scope in finally
  let repoDirName = null // Defined here for scope in finally
  let repoSaved = false // <<< Added: Track if the DB save happened

  try {
    const repoUrl = interaction.options.getString('repository')
    const attachment = interaction.options.getAttachment('ssh_key')
    const channelId = interaction.channelId // Using channelId
    const guildId = interaction.guildId

    if (!attachment) {
      return interaction.followUp({ content: 'Error: SSH key attachment is missing.', ephemeral: true })
    }
    if (!guildId) {
      console.error('Guild ID is missing from interaction.')
      return interaction.followUp({ content: 'Error: Guild ID is missing. Cannot create repository directory.', ephemeral: true })
    }
    if (!config.repoBaseDir) {
      console.error('REPO_BASE_DIR is not configured.')
      return interaction.followUp({ content: 'Internal Server Error: Repository base directory not configured.', ephemeral: true })
    }

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
      return interaction.followUp({ content: 'Error processing the SSH key. Ensure it is a valid key file and the ENCRYPTION_KEY is set correctly.', ephemeral: true })
    }

    // --- Coder User Assignment Logic --- START ---
    const usedIdsResult = await Repository.distinct('assignedUserId')
    const usedIds = new Set(usedIdsResult.filter(id => id != null))
    // assignedUserId is declared outside try block
    for (const userId of CODER_USER_POOL) {
      if (!usedIds.has(userId)) {
        assignedUserId = userId
        break
      }
    }
    if (!assignedUserId) {
      console.warn('Maximum repository limit reached (coder pool exhausted).')
      return interaction.followUp({ content: 'Maximum repository limit reached. Cannot add more repositories.', ephemeral: true })
    }
    console.log(`Assigning coder user ID: ${assignedUserId} to channel ${channelId}`)
    // --- Coder User Assignment Logic --- END ---

    // === INSERT / MODIFY CORE LOGIC HERE ===
    // --- Create Repo Directory ---
    repoDirName = `${guildId}-${channelId}` // Use guildId-channelId for uniqueness
    repoPath = path.join(config.repoBaseDir, repoDirName)
    await fs.mkdir(repoPath, { recursive: true })
    console.log(`Created directory: ${repoPath}`)

    // --- Set Directory Ownership ---
    console.log(`Changing ownership of ${repoPath} to ${assignedUserId}`)
    // Ensure sudo and chown are available in the Docker container
    // *** Use 'coders' group as per previous tutorials/context if applicable ***
    // *** Assuming 'coders' group exists and user is part of it ***
    execFileSync('sudo', ['chown', `${assignedUserId}:coders`, repoPath]) // <<< Adjusted group if needed
    console.log('Ownership changed successfully.')

    // --- Prepare SSH Key and Environment ---
    const decryptedKey = decrypt(encryptedKey) // Use the encrypted key from above
    if (!decryptedKey) {
      throw new Error('Failed to decrypt SSH key.')
    }
    // Use assignedUserId and repoDirName for temp key scoping
    keyFilePath = await writeTempKey({ repoName: repoDirName, keyContent: decryptedKey, ownerUserId: assignedUserId })
    console.log(`Temporary SSH key written to: ${keyFilePath}`)
    const gitSshCommand = `ssh -i ${keyFilePath} -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no`
    const spawnEnv = {
      ...process.env,
      GIT_SSH_COMMAND: gitSshCommand
    }

    // --- Save/Update Repository Document in DB ---
    const dbResult = await Repository.updateOne(
      { discordChannelId: interaction.channelId },
      {
        $set: {
          repoUrl,
          encryptedSshKey: encryptedKey, // Store the *encrypted* key
          assignedUserId // Store the assigned user ID
        },
        $setOnInsert: { discordChannelId: interaction.channelId } // Set channelId only on insert
      },
      { upsert: true, runValidators: true } // Create if not exists, validate
    )
    repoSaved = dbResult.acknowledged // Or check modifiedCount/upsertedId

    console.log(`Repository document saved/updated for channel ${interaction.channelId}. Upserted: ${!!dbResult.upsertedId}, Modified: ${dbResult.modifiedCount}`)

    // --- Execute Git Clone ---
    console.log(`Attempting to clone ${repoUrl} into ${repoPath} as user ${assignedUserId}`)
    const cloneProcess = spawn('sudo', ['-u', assignedUserId, 'git', 'clone', repoUrl, '.'], {
      cwd: repoPath, // Set the working directory for the clone command
      env: spawnEnv, // Pass the environment with GIT_SSH_COMMAND
      stdio: ['ignore', 'pipe', 'pipe'] // Ignore stdin, pipe stdout/stderr
    })

    let cloneStdout = ''
    let cloneStderr = ''
    cloneProcess.stdout.on('data', (data) => { cloneStdout += data.toString(); console.log(`Clone stdout: ${data}`) })
    cloneProcess.stderr.on('data', (data) => { cloneStderr += data.toString(); console.error(`Clone stderr: ${data}`) })

    const cloneExitCode = await new Promise((resolve, reject) => {
      cloneProcess.on('close', resolve)
      cloneProcess.on('error', (err) => {
        console.error('Spawn error during git clone:', err)
        reject(err)
      })
    })

    console.log(`Git clone process exited with code ${cloneExitCode}`)

    if (cloneExitCode !== 0) {
      // --- Clone Failed ---
      console.error(`Git clone failed with code ${cloneExitCode}. Stderr: ${cloneStderr}`)
      // Throw an error to trigger the catch block for cleanup
      // <<< Modified error message formatting
      throw new Error(`Failed to clone repository. Exit code: ${cloneExitCode}. Stderr: ${cloneStderr.substring(0, 500)}...`)
    } else {
      // --- Clone Succeeded ---
      console.log(`Repository cloned successfully into ${repoPath}. Stdout: ${cloneStdout}`)
      // Update reply on success
      await interaction.followUp({
        content: `✅ Repository '${repoUrl}' configured, cloned successfully, and assigned User ID: ${assignedUserId}.`
      })
    }
    // === END OF INSERTED/MODIFIED CORE LOGIC ===
  } catch (error) {
    console.error(`Error in /add-repo for channel ${interaction.channelId}:`, error)

    // --- Error Handling and Cleanup ---
    // <<< Modified error message generation
    const errorMessage = error.message.includes('Failed to clone repository') || error.message.includes('Failed to decrypt SSH key') || error.message.includes('Spawn error during git clone') || error.message.includes('Error preparing SSH key')
      ? `❌ ${error.message}`
      : `❌ An unexpected error occurred while processing /add-repo: ${error.message}`

    try {
      // Ensure we don't exceed Discord limits
      await interaction.followUp({ content: errorMessage.substring(0, 1900), ephemeral: true })
    } catch (replyError) {
      console.error('Failed to send error reply:', replyError)
    }

    // Cleanup: Remove directory ONLY if the clone itself failed
    // <<< Modified check to only remove dir on clone failure >>>
    if (repoPath && error.message.includes('Failed to clone repository')) {
      console.log(`Cleaning up failed clone directory: ${repoPath}`)
      try {
        // Use simple rm, assuming container/bot has permission in REPO_BASE_DIR
        await fs.rm(repoPath, { recursive: true, force: true })
        console.log(`Cleaned up directory: ${repoPath}`)
      } catch (cleanupErr) {
        console.error(`Failed to clean up directory ${repoPath}:`, cleanupErr)
      }
    } else if (repoPath) {
      // Log that we are *not* cleaning up for other errors
      console.log(`Error occurred before/during clone setup (${error.message}), not cleaning up directory: ${repoPath}`)
    }

    // Cleanup: Potentially revert DB changes? (Logging inconsistency as per tutorial)
    if (repoSaved) {
      console.warn(`Operation failed for channel ${interaction.channelId} after DB record was potentially saved/updated. Manual review might be needed if cleanup fails.`)
      // Optional: Add logic here to delete document if dbResult.upsertedId exists
    }
    // --- End Error Handling ---
  } finally {
    // --- Final Cleanup ---
    // Always try to delete the temporary SSH key if its path was set
    if (keyFilePath && assignedUserId) {
      console.log(`Finally block: Cleaning up temporary SSH key for user ${assignedUserId}...`)
      try {
        // Need repoDirName from try block
        // Ensure repoDirName is available if repoPath wasn't set (e.g., error before dir creation)
        const dirNameForCleanup = repoDirName || (repoPath ? path.basename(repoPath) : `unknown-${Date.now()}`)
        await deleteTempKey({ repoName: dirNameForCleanup, ownerUserId: assignedUserId }) // Use assignedUserId
        console.log(`Successfully deleted temporary key file: ${keyFilePath}`)
      } catch (cleanupError) {
        console.error(`Error cleaning up temporary SSH key ${keyFilePath}:`, cleanupError)
      }
    }
    // --- End Final Cleanup ---
  }
}

async function handleMentionInteraction (interactionOrMessage) {
  // Determine if it's an interaction or message
  const isInteraction = !!interactionOrMessage.isChatInputCommand // Check if it has interaction properties
  const message = isInteraction ? interactionOrMessage : interactionOrMessage // Use interaction or message object
  const channelId = message.channelId
  const guildId = message.guildId
  // Extract prompt - handle both interaction options and message content
  const userPrompt = isInteraction
    ? message.options.getString('prompt')
    // For message, remove bot mention and trim
    : message.content.replace(/<@!?\\d+>/g, '').trim()

  // Original reply/defer logic might be here...
  // e.g., await message.reply('Processing your request...'); or interaction.deferReply()
  // Let's assume a 'processingMessage' variable holds the message object we can edit later.
  let processingMessage
  try { // Wrap main logic for initial message sending
    if (isInteraction) {
      await message.deferReply()
      // If deferring, followUp is used first time, then edit
      processingMessage = await message.followUp('Processing your request with Aider...')
    } else {
      processingMessage = await message.reply('Processing your request with Aider...')
    }
  } catch (initialReplyError) {
    console.error('Failed to send initial processing message:', initialReplyError)
    // If we can't even send the first message, log and exit
    return
  }

  try {
    // --- 1. Find Repository Config & Context ---
    const repoConfig = await Repository.findOne({ discordChannelId: channelId })
    if (!repoConfig) {
      return processingMessage.edit('Error: No repository is configured for this channel. Use `/addrepo` first.')
    }
    if (!repoConfig.assignedUserId) { // <<< Check assignedUserId early
      return processingMessage.edit('Error: Repository configuration is incomplete (missing assigned user ID). Please re-add the repository.')
    }

    // --- 2. Invoke Aider Wrapper ---
    console.log(`Invoking aider for channel ${channelId} with prompt: "${userPrompt}"`)
    const wrapperResult = await invokeAiderWrapper({
      repoConfig, // Pass the whole config
      prompt: userPrompt,
      guildId,
      channelId
      // contextFiles: repoConfig.contextFiles // Already in repoConfig
    })

    console.log('Aider Wrapper Result:', JSON.stringify(wrapperResult, null, 2)) // Log the raw result

    // --- 3. Process Aider Result & Update User ---
    let finalReply = 'Aider processing finished.' // Default message

    if (wrapperResult.stdout) {
      // Append stdout, ensuring it's not too long for Discord
      const output = wrapperResult.stdout.substring(0, 1900) // Limit length
      finalReply += `\n\n**Output:**\n\`\`\`\n${output}\n\`\`\``
    }
    if (wrapperResult.stderr) {
      finalReply += `\n\n**Errors:**\n\`\`\`\n${wrapperResult.stderr.substring(0, 500)}\n\`\`\``
    }
    if (wrapperResult.error) {
      // If the wrapper script itself threw an error
      finalReply += `\n\n**Wrapper Error:** ${wrapperResult.error.message}`
    }

    // --- START: Auto Git Commit/Push Logic (from Tutorial 25) ---
    // Ensure wrapperResult.data exists before accessing its properties
    if (wrapperResult.data && wrapperResult.data.overall_status === 'success') {
      const fileChangeEvents = wrapperResult.data.events?.filter(e => e.type === 'file_change') || [] // Use optional chaining and default to empty array

      if (fileChangeEvents.length > 0) {
        console.log(`Detected ${fileChangeEvents.length} file changes from Aider. Proceeding with Git operations.`)
        finalReply += '\n\nAttempting to commit and push changes...' // Add feedback

        let keyFilePath = null
        let repoPath = null
        let repoDirName = null
        // Define branchName here for use in success/error messages
        const branchName = `aider/channel-${channelId}`.replace(/[^a-zA-Z0-9_\-/]/g, '-')

        try {
          // 1. Retrieve necessary info (repoConfig already available)
          // Added check for repoUrl earlier, check key here specifically
          if (!repoConfig.encryptedSshKey) {
            throw new Error('Missing repository configuration fields (encrypted SSH key) for Git operations.')
          }

          const assignedUserId = repoConfig.assignedUserId // Already checked this exists
          repoDirName = `${guildId}-${channelId}` // Reconstruct repoDirName
          repoPath = path.join(config.repoBaseDir, repoDirName) // Reconstruct repoPath

          // 2. Prepare SSH environment
          const decryptedKey = decrypt(repoConfig.encryptedSshKey)
          if (!decryptedKey) {
            throw new Error('Failed to decrypt SSH key for Git operation.')
          }
          // Ensure assignedUserId is passed correctly for scoping
          keyFilePath = await writeTempKey({ repoName: repoDirName, keyContent: decryptedKey, ownerUserId: assignedUserId })
          const gitSshCommand = `ssh -i ${keyFilePath} -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no`
          const spawnEnv = {
            ...process.env,
            GIT_SSH_COMMAND: gitSshCommand
          }

          // 3. Define Commit Message
          const originalPrompt = userPrompt // Use the already extracted prompt
          const commitMessage = `FEAT: Aider changes based on prompt: "${originalPrompt.substring(0, 72)}"`

          // 4. Execute Git Commands
          await gitAddAll({ repoPath, assignedUserId, env: spawnEnv })
          await gitCommit({ repoPath, assignedUserId, env: spawnEnv, message: commitMessage })
          await gitPush({ repoPath, assignedUserId, env: spawnEnv, branchName })

          // 5. Success Feedback (Append to finalReply)
          console.log('Successfully pushed changes to branch: ' + branchName)
          finalReply += '\n✅ Changes applied and pushed to branch `' + branchName + '`.'
        } catch (gitError) {
          console.error('Error during automatic Git operations:', gitError)
          // Provide specific branch name in error message
          finalReply += '\n❌ Changes applied locally, but failed to push to remote branch `' + branchName + '`:' + gitError.message
        } finally {
          // 6. Clean up temp SSH key
          if (keyFilePath) {
            // Ensure ownerUserId matches what was used in writeTempKey
            // Need assignedUserId from repoConfig here
            await deleteTempKey({ repoName: repoDirName, ownerUserId: repoConfig.assignedUserId })
            console.log(`Cleaned up temporary SSH key: ${keyFilePath}`)
          }
        }
      } else {
        console.log('Aider run successful, but no file changes detected. Skipping Git operations.')
        finalReply += '\n\nℹ️ Aider finished successfully, but no file changes were detected.'
      }
    } else if (wrapperResult.data && wrapperResult.data.overall_status === 'error') {
      console.log('Aider run failed. Skipping Git operations.')
      // Check if stderr already captured the error details
      if (!wrapperResult.stderr) {
        finalReply += '\n\n⚠️ Aider run reported errors. Check bot logs for details. No Git operations performed.'
      } else {
        finalReply += '\n\n⚠️ Aider run reported errors (see above). No Git operations performed.'
      }
    } else {
      // Handle unexpected output format or missing data object
      console.error('Unexpected or missing aider wrapper output data. Skipping Git operations.', wrapperResult.data)
      finalReply += '\n\n⚠️ Could not determine Aider status or changes due to unexpected output format. No Git operations performed.'
    }
    // --- END: Auto Git Commit/Push Logic ---

    // --- 4. Final Update to User ---
    // Ensure finalReply fits within Discord's 2000 character limit
    await processingMessage.edit(finalReply.substring(0, 2000))
  } catch (error) {
    console.error('Error handling mention interaction:', error)
    // Use edit on processingMessage if available, otherwise reply/followUp
    const errorMessage = `An unexpected error occurred: ${error.message}`
    try {
      await processingMessage.edit(errorMessage.substring(0, 2000))
    } catch (editErr) {
      console.error('Failed to edit original message with error:', editErr)
      // Fallback reply if editing fails (should be rare after initial success)
      try {
        if (isInteraction) await message.followUp(errorMessage.substring(0, 2000))
        else await message.reply(errorMessage.substring(0, 2000))
      } catch (fallbackReplyError) {
        console.error('Failed fallback reply:', fallbackReplyError)
      }
    }
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
      } else if (commandName === 'add-repo') {
        await handleAddRepoCommand(interaction)
      } else if (commandName === 'files') {
        await handleFilesCommand(interaction)
      } else if (commandName === 'add') {
        await handleAddCommand(interaction)
      } else if (commandName === 'drop') {
        await handleDropCommand(interaction)
      } else if (commandName === 'mention') {
        await handleMentionInteraction(interaction)
      } else {
        // Handle other chat input commands or provide a default response
        console.log(`Received unhandled chat input command: ${commandName}`)
        // You might want to fetch the command from client.commands and execute it if it exists
        // Example: const command = interaction.client.commands.get(commandName);
        // if (command) { await command.execute(interaction); }
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

// Add separate handling for regular messages mentioning the bot
module.exports.handleMessage = async (message) => {
  // Ignore messages from bots or without mention
  if (message.author.bot || !message.mentions.has(message.client.user)) {
    return
  }
  console.log(`Received mention from ${message.author.tag}: ${message.content}`)
  await handleMentionInteraction(message) // Reuse the same handler
}
