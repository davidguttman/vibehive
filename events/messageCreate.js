const { Events } = require('discord.js')
const path = require('node:path')

// --- Remove top-level real dependency imports ---
// const realRepository = require('../models/Repository')
// const realCrypto = require('../lib/crypto')
// const realSecureKeys = require('../lib/secureKeys')
// const realGitHelper = require('../lib/gitHelper')
// const realConfig = require('../config')
// const realPythonWrapper = require('../lib/pythonWrapper.js')
// const realConstants = require('../config/constants.js')
// -------------------------------------------------

module.exports = {
  name: Events.MessageCreate,
  // Modified execute to accept optional dependencies for testing
  async execute (message, dependencies = {}) {
    // Resolve dependencies: Use injected ones if provided, otherwise require the real ones *here*
    const Repository = dependencies.Repository || require('../models/Repository')
    const { decrypt } = dependencies.crypto || require('../lib/crypto')
    const { writeTempKey, deleteTempKey } = dependencies.secureKeys || require('../lib/secureKeys')
    const { gitAddAll, gitCommit, gitPush, cleanupRepoDir } = dependencies.gitHelper || require('../lib/gitHelper')
    const config = dependencies.config || require('../config')
    const { invokeAiderWrapper } = dependencies.pythonWrapper || require('../lib/pythonWrapper.js')
    const { BOT_USER_ID } = dependencies.constants || require('../config/constants.js')

    // >>> TEST DEBUG logs can likely be removed now if tests pass <<<
    // console.log('>>> TEST DEBUG: Entering execute function')
    // console.log('>>> TEST DEBUG: message.channel.id:', message?.channel?.id)
    // console.log('>>> TEST DEBUG: message.guildId:', message?.guildId)

    // 1. Ignore bot messages
    if (message.author.bot) return

    // 2. Check if bot was mentioned using the potentially configured ID
    if (!BOT_USER_ID || !message.mentions.has(BOT_USER_ID)) return

    // 3. Extract prompt (remove bot mention using potentially configured ID)
    const mentionRegex = new RegExp(`^<@!?${BOT_USER_ID}>\\s*`)
    const prompt = message.content.replace(mentionRegex, '').trim()

    if (!prompt) {
      // Use reply for early exit - no processing message exists yet
      console.log(`Mention received without a prompt in channel ${message.channel.id}.`)
      await message.reply({ content: 'You mentioned me! What can I help you with? Please provide a prompt after the mention.', ephemeral: false })
      return
    }

    console.log(`Bot mentioned by ${message.author.tag} in channel ${message.channel.id}`)
    console.log(`Extracted prompt: "${prompt}"`)

    // 4. Find repository configuration for the channel
    let repo
    try {
      repo = await Repository.findOne({ discordChannelId: message.channel.id })

      if (!repo) {
        console.log(`No repository configured for channel ${message.channel.id}`)
        // Use reply for early exit - no processing message exists yet
        await message.reply({ content: 'No repository configured for this channel. Use `/addrepo` to set one up.', ephemeral: true })
        return
      }

      console.log(`Found repository config for channel ${message.channel.id}: ${repo.repoUrl}`)
    } catch (dbError) {
      console.error(`Database error finding repository for channel ${message.channel.id}:`, dbError)
      // Use reply for early exit - no processing message exists yet
      await message.reply({ content: 'There was a database error trying to find the repository configuration.', ephemeral: true })
      return
    }

    // 5. Invoke the Python wrapper
    let result
    let processingMessage = null // Initialize to null
    let repoPath = null
    let repoDirName = null
    let assignedUserId = ''

    try {
      // Show initial processing message
      processingMessage = await message.reply('⏳ Processing your request...') // Simpler initial message

      assignedUserId = repo.assignedUserId // Assign here for cleanup
      repoDirName = `${message.guildId}-${message.channel.id}` // Assign here for cleanup
      repoPath = path.join(config.repoBaseDir, repoDirName) // Assign here for cleanup

      // Pass the entire repo document as repoConfig
      result = await invokeAiderWrapper({
        prompt,
        contextFiles: repo.contextFiles || [],
        repoConfig: repo
      })

      console.log('Aider wrapper result:', JSON.stringify(result, null, 2)) // Log full result

      // 7. Handle the wrapper result
      if (result.overall_status === 'success' && result.events) {
        let branchName = ''
        let finalContent = ''

        const textResponse = result.events.find(e => e.type === 'text_response')?.content
        const fileChangeEvents = result.events.filter(e => e.type === 'file_change')

        if (fileChangeEvents.length > 0) {
          console.log(`Detected ${fileChangeEvents.length} file changes. Proceeding with Git operations.`)

          let keyFilePath = null

          try {
            if (!repo || !assignedUserId || !repo.encryptedSshKey || !repo.repoUrl || !message.guildId) {
              throw new Error('Missing repository configuration, assigned user, key, URL, or guild ID for Git operations.')
            }

            const decryptedKey = decrypt(repo.encryptedSshKey)
            if (!decryptedKey) {
              throw new Error('Failed to decrypt SSH key for Git operation.')
            }
            keyFilePath = await writeTempKey({ repoName: repoDirName, keyContent: decryptedKey, ownerUserId: assignedUserId })
            const gitSshCommand = `ssh -i ${keyFilePath} -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no`
            const spawnEnv = { ...process.env, GIT_SSH_COMMAND: gitSshCommand }

            branchName = `aider/channel-${message.channel.id}`.replace(/[^a-zA-Z0-9_\\-\\/]/g, '-')
            const commitMessage = `FEAT: Aider changes based on prompt: "${prompt.substring(0, 72)}"`

            await gitAddAll({ repoPath, assignedUserId, env: spawnEnv })
            await gitCommit({ repoPath, assignedUserId, env: spawnEnv, message: commitMessage })
            await gitPush({ repoPath, assignedUserId, env: spawnEnv, branchName })

            console.log(`Successfully pushed changes to branch: ${branchName}`)

            // Construct final message for successful push
            finalContent = textResponse
              ? `${textResponse}\n\n✅ _Changes also pushed to branch \`${branchName}\`._`
              : `✅ Processing completed. Changes pushed to branch \`${branchName}\`.`
          } catch (gitError) {
            console.error('Error during automatic Git operations:', gitError)
            // Construct final message for git error
            finalContent = `❌ Changes applied by Aider locally, but failed to push to remote branch \`${branchName || 'unknown'}\`\nError: ${gitError.message}`
          } finally {
            if (keyFilePath && assignedUserId && repoDirName) {
              try {
                await deleteTempKey({ repoName: repoDirName, ownerUserId: assignedUserId })
                console.log(`Cleaned up temporary SSH key after Git op: ${keyFilePath}`)
              } catch (cleanupError) {
                console.error(`Error cleaning up temporary SSH key ${keyFilePath} after git op:`, cleanupError)
              }
            }
          }
        } else {
          // No file changes detected
          console.log('Aider run successful, but no file changes detected. Skipping Git operations.')
          finalContent = textResponse || '✅ Processing completed. No changes were made.'
        }

        // Edit the original processing message with the final result
        await processingMessage.edit({ content: finalContent.substring(0, 2000) })
      } else if (result.overall_status === 'error') {
        // Aider wrapper reported an error
        console.error(`Aider wrapper failed: ${result.error}`)
        const errorContent = `Sorry, there was an error processing your request with the script: ${result.error || 'Unknown error'}.`
        await processingMessage.edit({ content: errorContent.substring(0, 2000) })
      } else {
        // Unexpected wrapper status
        console.error('Aider wrapper returned unexpected or missing status:', result)
        await processingMessage.edit({ content: 'Sorry, there was an unexpected issue processing your request.' })
      }
    } catch (wrapperOrSetupError) {
      // Error during initial setup, wrapper invocation, or result handling (outside Git block)
      console.error('Error invoking Aider wrapper or handling its result:', wrapperOrSetupError)
      const errorMsg = 'An unexpected error occurred while processing your request.'
      if (processingMessage) {
        try {
          await processingMessage.edit({ content: errorMsg })
        } catch (editError) {
          console.error('Failed to edit processing message with general wrapper error:', editError)
        }
      } else {
        // If processingMessage failed to create, reply to original message
        try {
          await message.reply({ content: errorMsg, ephemeral: true })
        } catch (replyError) {
          console.error('Failed to send final error reply:', replyError)
        }
      }
    } finally {
      // Cleanup
      if (processingMessage) {
        try {
          // Delete the message *after* editing it with the final status
          await processingMessage.delete()
          console.log('Deleted processing message.')
        } catch (deleteError) {
          // Non-critical, log and continue
          console.warn('Failed to delete processing message (non-critical):', deleteError)
        }
      }

      // Cleanup repo directory using the helper function
      if (repoPath && assignedUserId) { // Check both repoPath and assignedUserId
        console.log(`Attempting cleanup for repoPath: ${repoPath} owned by ${assignedUserId}`)
        try {
          await cleanupRepoDir({ repoPath, assignedUserId })
          console.log(`Cleaned up temporary directory using helper: ${repoPath}`)
        } catch (cleanupError) {
          console.error(`Error during temporary directory cleanup using helper for ${repoPath}:`, cleanupError)
        }
      } else {
        console.log(`Skipping directory cleanup: repoPath (${repoPath}) or assignedUserId (${assignedUserId}) not set.`)
      }
    }
  }
}
