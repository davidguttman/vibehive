# Tutorial 25: Auto Git Commit/Push after Aider Changes

This tutorial explains how to automatically stage, commit, and push changes made by the `aider` Coder back to the configured Git repository. This happens within the Node.js bot after a successful `aider` run that resulted in file modifications detected in Tutorial 24.

**Goal:** Integrate Git operations into the bot's workflow to persist `aider`'s changes automatically to a dedicated branch.

## Prerequisites

*   Completion of Tutorial 24 (`24-detect-file-changes.md`).
*   The bot environment has `git` installed and accessible.
*   The bot process has `sudo` privileges configured to run commands as the `assignedUserId` (e.g., `coder1`, `coder2`). This was set up in earlier tutorials involving `secureKeys` and `chown`.
*   Repositories are cloned with valid SSH keys (Tutorial 22) and the `GIT_SSH_COMMAND` logic works (Tutorial 17).

## Steps

1.  **Create Git Helper Module (`lib/gitHelper.js`):**
    This module will encapsulate the Git command execution logic using `sudo` and `child_process`.

    ```javascript
    // lib/gitHelper.js
    const { spawn } = require(\'node:child_process\')
    const path = require(\'node:path\') // For potential path manipulation if needed

    /**
     * Executes a Git command using sudo -u.
     * @param {object} options - Options object.
     * @param {string} options.repoPath - Absolute path to the repository.
     * @param {string} options.assignedUserId - The user ID to run the command as.
     * @param {object} options.env - Environment variables (including GIT_SSH_COMMAND).
     * @param {string[]} options.gitArgs - Array of arguments for the git command.
     * @returns {Promise<{stdout: string, stderr: string}>} - Resolves with output, rejects on error.
     */
    function executeGitCommand ({ repoPath, assignedUserId, env, gitArgs }) {
      return new Promise((resolve, reject) => {
        const command = \'sudo\'
        const args = [\'-u\', assignedUserId, \'git\', ...gitArgs]
        const options = {
          cwd: repoPath,
          env,
          stdio: [\'ignore\', \'pipe\', \'pipe\'] // ignore stdin, capture stdout, stderr
        }

        console.log(`Executing: ${command} ${args.join(\' \')} in ${repoPath}`)

        const child = spawn(command, args, options)

        let stdout = \'\'
        let stderr = \'\'

        child.stdout.on(\'data\', (data) => {
          stdout += data.toString()
        })

        child.stderr.on(\'data\', (data) => {
          stderr += data.toString()
        })

        child.on(\'close\', (code) => {
          if (code === 0) {
            console.log(`Git command success (${gitArgs[0]}):\\nStdout: ${stdout}\\nStderr: ${stderr}`)
            resolve({ stdout, stderr })
          } else {
            console.error(`Git command failed (${gitArgs[0]}) with code ${code}:\\nStderr: ${stderr}\\nStdout: ${stdout}`)
            reject(new Error(`Git command failed with code ${code}. Stderr: ${stderr}`))
          }
        })

        child.on(\'error\', (err) => {
          console.error(`Failed to spawn Git command (${gitArgs[0]}):`, err)
          reject(err)
        })
      })
    }

    /**
     * Stages all changes in the repository.
     * @param {object} options - Options object.
     * @param {string} options.repoPath - Absolute path to the repository.
     * @param {string} options.assignedUserId - The user ID to run the command as.
     * @param {object} options.env - Environment variables (including GIT_SSH_COMMAND).
     * @returns {Promise<void>}
     */
    async function gitAddAll ({ repoPath, assignedUserId, env }) {
      await executeGitCommand({ repoPath, assignedUserId, env, gitArgs: [\'add\', \'.\'] })
    }

    /**
     * Commits staged changes.
     * @param {object} options - Options object.
     * @param {string} options.repoPath - Absolute path to the repository.
     * @param {string} options.assignedUserId - The user ID to run the command as.
     * @param {object} options.env - Environment variables (including GIT_SSH_COMMAND).
     * @param {string} options.message - The commit message.
     * @returns {Promise<void>}
     */
    async function gitCommit ({ repoPath, assignedUserId, env, message }) {
      // Basic commit message escaping (replace " with \\") - more robust escaping might be needed
      const escapedMessage = message.replace(/"/g, \'\\"\')
      await executeGitCommand({
        repoPath,
        assignedUserId,
        env,
        gitArgs: [\'commit\', \'-m\', escapedMessage]
      })
    }

    /**
     * Pushes the current HEAD to a specified remote branch.
     * @param {object} options - Options object.
     * @param {string} options.repoPath - Absolute path to the repository.
     * @param {string} options.assignedUserId - The user ID to run the command as.
     * @param {object} options.env - Environment variables (including GIT_SSH_COMMAND).
     * @param {string} options.branchName - The name of the remote branch to push to.
     * @returns {Promise<void>}
     */
    async function gitPush ({ repoPath, assignedUserId, env, branchName }) {
      // Push current HEAD to the remote branch, creating/updating it forcefully if needed
      // Consider if force-pushing is desired (-f) or if creating a new branch is safer.
      // Using HEAD:branchName ensures we push the current state to the specified branch.
      await executeGitCommand({
        repoPath,
        assignedUserId,
        env,
        // NOTE: Using push origin HEAD:branchName - this will create or update the branch.
        // Add -f for force push if necessary, but be careful.
        gitArgs: [\'push\', \'origin\', `HEAD:${branchName}`]
      })
    }

    module.exports = {
      gitAddAll,
      gitCommit,
      gitPush
    }
    ```
    *Self-Correction:* Initially considered `execFile`, but `spawn` provides better handling of streams (stdout/stderr) which is useful for logging and diagnosing Git issues. Ensured `stdio` is configured correctly to capture output without hanging. Added basic logging within the helper.

2.  **Modify `events/interactionCreate.js` - Imports:**
    Import the new Git helper functions and potentially `decrypt` if not already imported in the relevant scope.
    ```javascript
    // At the top of events/interactionCreate.js
    // ... other imports
    const { gitAddAll, gitCommit, gitPush } = require(\'../lib/gitHelper\') // <<< Add this
    const { decrypt } = require(\'../lib/crypto\') // Ensure decrypt is available
    const { writeTempKey, deleteTempKey } = require(\'../lib/secureKeys\') // Ensure key functions are available
    const path = require(\'node:path\') // Ensure path is available
    const config = require(\'../config\') // Ensure config is available
    ```

3.  **Modify `events/interactionCreate.js` - `handleMentionInteraction`:**
    Locate the section where the `aider_wrapper.py` result (`wrapperResult`) is processed (likely after the `invokeAiderWrapper` call). Add logic to check for success and file changes, then call the Git helper functions.

    ```javascript
    // Inside handleMentionInteraction, after processing wrapperResult.stdout
    // Assuming wrapperResult.data contains the parsed JSON { overall_status: '...', events: [...] }

    if (wrapperResult.data && wrapperResult.data.overall_status === \'success\') {
      const fileChangeEvents = wrapperResult.data.events.filter(e => e.type === \'file_change\')

      if (fileChangeEvents.length > 0) {
        // --- Start Auto Git Commit/Push ---
        console.log(\`Detected ${fileChangeEvents.length} file changes from Aider. Proceeding with Git operations.\`)

        let keyFilePath = null
        let repoPath = null // Need repoPath from repoConfig
        let repoDirName = null // Need repoDirName for temp key

        try {
          // 1. Retrieve necessary info (ensure repoConfig is available in this scope)
          const repoConfig = await Repository.findOne({ discordChannelId: message.channelId })
          if (!repoConfig || !repoConfig.assignedUserId || !repoConfig.encryptedSshKey || !repoConfig.repoUrl) {
            throw new Error(\'Missing repository configuration for Git operations.\')
          }

          const assignedUserId = repoConfig.assignedUserId
          const repoUrl = repoConfig.repoUrl // Needed? Maybe just for logging context.
          repoDirName = `${message.guildId}-${message.channelId}` // Reconstruct repoDirName
          repoPath = path.join(config.repoBaseDir, repoDirName) // Reconstruct repoPath

          // 2. Prepare SSH environment
          const decryptedKey = decrypt(repoConfig.encryptedSshKey)
          if (!decryptedKey) {
             throw new Error(\'Failed to decrypt SSH key for Git operation.\')
          }
          // Use assignedUserId and repoDirName for temp key scoping
          keyFilePath = await writeTempKey({ repoName: repoDirName, keyContent: decryptedKey, ownerUserId: assignedUserId })
          const gitSshCommand = `ssh -i ${keyFilePath} -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no`
          const spawnEnv = {
            ...process.env,
            GIT_SSH_COMMAND: gitSshCommand
          }

          // 3. Define Branch and Commit Message
          // Ensure branch name is valid (e.g., replace invalid characters)
          const branchName = `aider/channel-${message.channelId}`.replace(/[^a-zA-Z0-9_\\-\\/]/g, \'-\')
          const originalPrompt = message.content.replace(/<@!?\\d+>/g, \'\').trim() // Simple extraction
          const commitMessage = `FEAT: Aider changes based on prompt: "${originalPrompt.substring(0, 72)}"` // Conventional commit type

          // 4. Execute Git Commands
          await gitAddAll({ repoPath, assignedUserId, env: spawnEnv })
          await gitCommit({ repoPath, assignedUserId, env: spawnEnv, message: commitMessage })
          await gitPush({ repoPath, assignedUserId, env: spawnEnv, branchName })

          // 5. Success Feedback
          console.log(`Successfully pushed changes to branch: ${branchName}`)
          await message.reply(`✅ Changes applied and pushed to branch \`${branchName}\`.`) // Inform user

        } catch (gitError) {
          console.error(\'Error during automatic Git operations:\', gitError)
          // Inform user about partial success (local changes exist)
          await message.reply(\`✅ Changes applied locally, but failed to push to remote branch: ${gitError.message}\`)
        } finally {
          // 6. Clean up temp SSH key
          if (keyFilePath) {
            await deleteTempKey({ repoName: repoDirName, ownerUserId: assignedUserId }) // Use same parameters as writeTempKey
            console.log(\`Cleaned up temporary SSH key: ${keyFilePath}\`)
          }
        }
        // --- End Auto Git Commit/Push ---
      } else {
        console.log(\'Aider run successful, but no file changes detected. Skipping Git operations.\')
        // Optional: Provide different feedback if needed, but likely the wrapper already did.
        // await message.reply('✅ Aider finished. No file changes were detected.')
      }
    } else if (wrapperResult.data && wrapperResult.data.overall_status === \'error\') {
      // Handle wrapper error case (already exists likely)
      console.log(\'Aider run failed. Skipping Git operations.\')
      // Existing error handling...
    } else {
      // Handle unexpected output format
      console.error(\'Unexpected aider wrapper output format. Skipping Git operations.\', wrapperResult.data)
      // Existing error handling...
    }

    // ... rest of handleMentionInteraction logic (e.g., final message reply if not handled above) ...
    ```
    *Self-Correction:* Realized the SSH key needs to be decrypted and written to a temporary file *again* for the `git push` command, just like in `handleAddRepoCommand`. Added logic to retrieve `repoConfig`, decrypt key, write temp key, create `spawnEnv`, and ensure cleanup in a `finally` block. Also added reconstruction of `repoPath` and `repoDirName`. Used a conventional commit prefix (`FEAT:`). Included error handling specifically for the Git operations and user feedback for success/failure.

4.  **Run Code Formatter:**
    Apply standard.js style fixes.
    ```bash
    npx standard --fix
    ```

## Testing (`test/gitHelper.test.js`, `test/mentionHandler.test.js`)

1.  **`test/gitHelper.test.js`:**
    *   Use `ava` and mock `child_process`.
    *   Import the helper functions: `const { gitAddAll, gitCommit, gitPush } = require('../lib/gitHelper')`.
    *   Use `td.replace('node:child_process')` or similar mocking strategy.
    *   For each function (`gitAddAll`, `gitCommit`, `gitPush`):
        *   Create a test case.
        *   Define mock `spawn` behavior (e.g., capture args, simulate success/failure).
        *   Call the helper function with test parameters (`repoPath`, `assignedUserId`, `env`, `message`/`branchName`).
        *   Assert that `spawn` was called with the correct arguments:
            *   Command: `sudo`
            *   Args: `['-u', 'testuser', 'git', 'add', '.']` (for `gitAddAll`)
            *   Args: `['-u', 'testuser', 'git', 'commit', '-m', 'Test commit']` (for `gitCommit`)
            *   Args: `['-u', 'testuser', 'git', 'push', 'origin', 'HEAD:test/branch']` (for `gitPush`)
            *   Options: Correct `cwd` and `env` (check `GIT_SSH_COMMAND`).
        *   Test error handling by simulating non-zero exit codes from `spawn`.

2.  **`test/mentionHandler.test.js`:**
    *   Import and mock the Git helper functions: `td.replace('../lib/gitHelper')`.
    *   Import and mock `Repository.findOne`, `crypto.decrypt`, `secureKeys.writeTempKey`, `secureKeys.deleteTempKey`.
    *   **Test Case: Success with Changes:**
        *   Mock `invokeAiderWrapper` to return success JSON *with* `file_change` events.
        *   Mock `Repository.findOne` to return a valid `repoConfig`.
        *   Mock `decrypt` to return a fake key.
        *   Mock `writeTempKey` to return a fake path.
        *   Setup mocks for `gitAddAll`, `gitCommit`, `gitPush` to resolve successfully.
        *   Run the relevant part of `handleMentionInteraction`.
        *   Assert `gitAddAll`, `gitCommit`, `gitPush` were called **in order** with correct parameters (check `repoPath`, `assignedUserId`, `env`, commit message, branch name).
        *   Assert `message.reply` was called with the success message.
        *   Assert `deleteTempKey` was called.
    *   **Test Case: Success without Changes:**
        *   Mock `invokeAiderWrapper` to return success JSON *without* `file_change` events.
        *   Run handler.
        *   Assert Git helper functions were **not** called.
        *   Assert `deleteTempKey` was **not** called (as the Git block wasn't entered).
    *   **Test Case: Git Push Fails:**
        *   Mock `invokeAiderWrapper` as in the success case.
        *   Mock `Repository.findOne`, `decrypt`, `writeTempKey`.
        *   Mock `gitAddAll`, `gitCommit` to resolve.
        *   Mock `gitPush` to **reject** with an error.
        *   Run handler.
        *   Assert `gitAddAll`, `gitCommit` were called.
        *   Assert `gitPush` was called.
        *   Assert `message.reply` was called with the "failed to push" message.
        *   Assert `deleteTempKey` was still called (due to `finally`).
    *   **Test Case: Wrapper Fails:**
        *   Mock `invokeAiderWrapper` to return error status.
        *   Run handler.
        *   Assert Git helper functions were **not** called.

3.  **Run Tests:**
    Execute your test suite.
    ```bash
    npm test
    ```

## Conclusion

With these changes, the bot now automatically manages the Git workflow after `aider` successfully modifies files. It creates commits on a dedicated branch per channel and pushes them, providing feedback to the user. Error handling ensures temporary keys are cleaned up and users are informed if the push fails. Remember to ensure the `sudo` permissions and SSH key handling are correctly configured in your deployment environment. 