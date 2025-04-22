const { Events } = require('discord.js')
const path = require('node:path')
const Repository = require('../models/Repository')
const { decrypt } = require('../lib/crypto')
const { writeTempKey, deleteTempKey } = require('../lib/secureKeys')
const { gitAddAll, gitCommit, gitPush } = require('../lib/gitHelper')
const config = require('../config')
const { invokeAiderWrapper } = require('../lib/pythonWrapper.js')
const fs = require('fs')

module.exports = {
  name: Events.MessageCreate,
  async execute (message) {
    console.log('>>> TEST DEBUG: Entering execute function')
    console.log('>>> TEST DEBUG: message.channel.id:', message?.channel?.id)
    console.log('>>> TEST DEBUG: message.guildId:', message?.guildId)
    // 1. Ignore bot messages
    if (message.author.bot) return

    // 2. Check if bot was mentioned
    if (!message.mentions.has(message.client.user)) return // Use message.client.user

    // 3. Extract prompt (remove bot mention)
    const mentionRegex = new RegExp(`^<@!?${message.client.user.id}>\\s*`)
    const prompt = message.content.replace(mentionRegex, '').trim()

    if (!prompt) {
      // Handle cases where the bot is mentioned but no text follows
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
        await message.reply({ content: 'No repository configured for this channel. Use `/addrepo` to set one up.', ephemeral: true })
        return
      }

      console.log(`Found repository config for channel ${message.channel.id}: ${repo.repoUrl}`)
    } catch (dbError) {
      console.error(`Database error finding repository for channel ${message.channel.id}:`, dbError)
      await message.reply({ content: 'There was a database error trying to find the repository configuration.', ephemeral: true })
      return
    }

    // 6. Invoke the Python wrapper
    let result
    let processingMessage
    let repoPath = null
    let repoDirName = null
    let assignedUserId = ''

    try {
      // 5. Show initial processing message
      processingMessage = await message.reply('Processing your request with Aider...')

      // Pass the entire repo document as repoConfig
      result = await invokeAiderWrapper({
        prompt,
        contextFiles: repo.contextFiles || [],
        repoConfig: repo
      })

      console.log('Aider wrapper result:', result)

      // 7. Handle the wrapper result
      if (result.overall_status === 'success' && result.events) {
        let gitOpSuccess = false
        let branchName = ''

        const textResponse = result.events.find(e => e.type === 'text_response')?.content
        const fileChangeEvents = result.events.filter(e => e.type === 'file_change')

        if (fileChangeEvents.length > 0) {
          console.log(`Detected ${fileChangeEvents.length} file changes from Aider. Proceeding with Git operations.`)

          let keyFilePath = null

          try {
            console.log('>>> TEST DEBUG: Entering Git Ops try block')
            if (!repo || !repo.assignedUserId || !repo.encryptedSshKey || !repo.repoUrl || !message.guildId) {
              console.error('>>> TEST DEBUG: Failing pre-condition check:', { hasRepo: !!repo, hasUserId: !!repo?.assignedUserId, hasKey: !!repo?.encryptedSshKey, hasUrl: !!repo?.repoUrl, hasGuildId: !!message.guildId })
              throw new Error('Missing repository configuration or guild ID for Git operations.')
            }

            assignedUserId = repo.assignedUserId
            repoDirName = `${message.guildId}-${message.channel.id}`
            repoPath = path.join(config.repoBaseDir, repoDirName)

            const decryptedKey = decrypt(repo.encryptedSshKey)
            if (!decryptedKey) {
              throw new Error('Failed to decrypt SSH key for Git operation.')
            }
            keyFilePath = await writeTempKey({ repoName: repoDirName, keyContent: decryptedKey, ownerUserId: assignedUserId })
            const gitSshCommand = `ssh -i ${keyFilePath} -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no`
            const spawnEnv = {
              ...process.env,
              GIT_SSH_COMMAND: gitSshCommand
            }

            branchName = `aider/channel-${message.channel.id}`.replace(/[^a-zA-Z0-9_\\-\\/]/g, '-')
            const commitMessage = `FEAT: Aider changes based on prompt: "${prompt.substring(0, 72)}"`

            await gitAddAll({ repoPath, assignedUserId, env: spawnEnv })
            await gitCommit({ repoPath, assignedUserId, env: spawnEnv, message: commitMessage })
            await gitPush({ repoPath, assignedUserId, env: spawnEnv, branchName })

            gitOpSuccess = true
            console.log(`Successfully pushed changes to branch: ${branchName}`)
          } catch (gitError) {
            console.error('Error during automatic Git operations:', gitError)
            await message.reply(`❌ Changes applied by Aider locally, but failed to push to remote branch \`${branchName}\`: ${gitError.message.substring(0, 1500)}`)
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

          if (gitOpSuccess) {
            if (textResponse) {
              console.log('Sending text response to Discord:', textResponse)
              const finalResponse = gitOpSuccess
                ? `${textResponse}\n\n✅ _Changes also pushed to branch \`${branchName}\`._`
                : textResponse

              await message.reply({ content: finalResponse.substring(0, 2000), ephemeral: false })
                .catch(async (err) => {
                  console.warn('Failed to reply directly to mention, sending to channel instead.', err)
                  await message.channel.send(`${message.author} ${finalResponse.substring(0, 1900)}...`)
                })
            } else {
              await message.reply({ content: `✅ Processing completed. Changes pushed to branch \`${branchName}\`.`, ephemeral: false })
                .catch(async (err) => {
                  console.warn('Failed to reply directly (git success, no text), sending to channel instead.', err)
                  await message.channel.send(`${message.author} ✅ Processing completed. Changes pushed to branch \`${branchName}\`.`)
                })
            }
          } else {
            console.log('Skipping final success response modification due to Git operation failure.')
          }
        } else {
          console.log('Aider run successful, but no file changes detected. Skipping Git operations.')
          if (textResponse) {
            console.log('Sending text response (no changes) to Discord:', textResponse)
            await message.reply({ content: textResponse.substring(0, 2000), ephemeral: false })
              .catch(async (err) => {
                console.warn('Failed to reply directly (no changes), sending to channel instead.', err)
                await message.channel.send(`${message.author} ${textResponse.substring(0, 1900)}...`)
              })
          } else {
            await message.reply({ content: '✅ Processing completed. No changes were made.', ephemeral: false })
              .catch(async (err) => {
                console.warn('Failed to reply directly (no changes, no text), sending to channel instead.', err)
                await message.channel.send(`${message.author} ✅ Processing completed. No changes were made.`)
              })
          }
        }
      } else if (result.overall_status === 'error') {
        console.error(`Aider wrapper failed: ${result.error}`)
        await message.reply({ content: `Sorry, there was an error processing your request with the script: ${result.error || 'Unknown error'}.`, ephemeral: true })
          .catch(async (err) => {
            console.warn('Failed to reply directly (script failure), sending to channel instead.', err)
            await message.channel.send(`${message.author} Sorry, there was an error processing your request with the script.`)
          })
      } else {
        console.error('Aider wrapper returned unexpected or missing status:', result)
        await message.reply({ content: 'Sorry, there was an unexpected issue processing your request.', ephemeral: true })
          .catch(async (err) => {
            console.warn('Failed to reply directly (unexpected status), sending to channel instead.', err)
            await message.channel.send(`${message.author} Sorry, there was an unexpected issue processing your request.`)
          })
      }
    } catch (wrapperError) {
      console.error('Error invoking or handling result from Aider wrapper:', wrapperError)
      await message.reply({ content: 'An unexpected error occurred while communicating with the processing script.', ephemeral: true })
        .catch(async (err) => {
          console.warn('Failed to reply directly (wrapper error), sending to channel instead.', err)
          await message.channel.send(`${message.author} An unexpected error occurred while communicating with the processing script.`)
        })
    } finally {
      if (processingMessage) {
        try {
          await processingMessage.delete()
        } catch (deleteError) {
          console.warn('Failed to delete processing message (non-critical):', deleteError)
        }
      }

      if (repoPath) {
        console.log(`>>> TEST DEBUG: Attempting cleanup for repoPath: ${repoPath}`)
        try {
          await fs.promises.rm(path.join(repoPath, '.git'), { recursive: true, force: true })
          await fs.promises.rm(repoPath, { recursive: true, force: true })
          console.log(`Cleaned up temporary directory: ${repoPath}`)
        } catch (cleanupError) {
          console.error(`Error during temporary directory cleanup for ${repoPath}: ${cleanupError}`)
        }
      } else {
        console.log('>>> TEST DEBUG: Skipping directory cleanup as repoPath was not set.')
      }
    }
  }
}
