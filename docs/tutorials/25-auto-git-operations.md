# Tutorial 25: Automatic Git Operations After Aider Run

This tutorial outlines how to automatically stage, commit, and push changes made by the `aider` Coder to the associated Git repository using the Node.js bot. This happens only when `aider` successfully completes and reports file changes via the wrapper script (Tutorial 24).

**Goal:** Implement automatic Git add, commit, and push functionality triggered by successful `aider` runs with detected file modifications.

## Prerequisites

*   Completion of Tutorial 24 (`24-detect-file-changes.md`). The bot must be receiving JSON output from `aider_wrapper.py` that includes `file_change` events.
*   The bot environment must have `git` installed and configured.
*   User accounts (represented by `assignedUserId`) need appropriate `sudo` permissions to run `git` commands in the target repository directories.
*   Secure handling of SSH keys for Git operations (as implemented in previous tutorials, e.g., Tutorial 17).

## Steps

1.  **Create Git Helper Module (`lib/gitHelper.js`):**
    *   Create a new file `lib/gitHelper.js`.
    *   This module will contain functions to execute Git commands using `sudo`.
    *   Use `child_process.spawn` or `execFile` for better control over execution and environment variables compared to `exec`.

    ```javascript
    // lib/gitHelper.js
    const { spawn } = require('child_process')
    const log = require('./log') // Assuming you have a logger module

    /**
     * Executes a git command using sudo for the specified user.
     * @param {object} options - Options object
     * @param {string} options.repoPath - The path to the repository.
     * @param {string} options.assignedUserId - The system user ID to run git as.
     * @param {object} options.env - Environment variables (must include GIT_SSH_COMMAND).
     * @param {string[]} options.gitArgs - Arguments for the git command.
     * @returns {Promise<void>} - Resolves on success, rejects on error.
     */
    function executeGitCommand ({ repoPath, assignedUserId, env, gitArgs }) {
      return new Promise((resolve, reject) => {
        const sudoArgs = ['-u', assignedUserId, 'git', ...gitArgs]
        const command = 'sudo'

        log.info(`Executing: ${command} ${sudoArgs.join(' ')} in ${repoPath}`)

        const gitProcess = spawn(command, sudoArgs, {
          cwd: repoPath,
          env: { ...process.env, ...env }, // Merge environment variables
          stdio: ['ignore', 'pipe', 'pipe'] // Ignore stdin, pipe stdout/stderr
        })

        let stdout = ''
        let stderr = ''

        gitProcess.stdout.on('data', (data) => {
          stdout += data.toString()
        })

        gitProcess.stderr.on('data', (data) => {
          stderr += data.toString()
        })

        gitProcess.on('close', (code) => {
          if (code === 0) {
            log.info(`Git command succeeded: ${sudoArgs.join(' ')}. Output: ${stdout}`)
            resolve()
          } else {
            log.error(`Git command failed: ${sudoArgs.join(' ')}. Exit code: ${code}. Stderr: ${stderr}. Stdout: ${stdout}`)
            reject(new Error(`Git command failed with exit code ${code}: ${stderr || stdout}`))
          }
        })

        gitProcess.on('error', (err) => {
          log.error(`Failed to spawn git process: ${err}`)
          reject(err)
        })
      })
    }

    /**
     * Stages all changes in the repository.
     * @param {object} options - Options: repoPath, assignedUserId, env
     * @returns {Promise<void>}
     */
    async function gitAddAll ({ repoPath, assignedUserId, env }) {
      await executeGitCommand({ repoPath, assignedUserId, env, gitArgs: ['add', '.'] })
    }

    /**
     * Commits staged changes.
     * @param {object} options - Options: repoPath, assignedUserId, env, message
     * @returns {Promise<void>}
     */
    async function gitCommit ({ repoPath, assignedUserId, env, message }) {
      await executeGitCommand({ repoPath, assignedUserId, env, gitArgs: ['commit', '-m', message] })
    }

    /**
     * Pushes the current branch to the remote origin.
     * @param {object} options - Options: repoPath, assignedUserId, env, branchName
     * @returns {Promise<void>}
     */
    async function gitPush ({ repoPath, assignedUserId, env, branchName }) {
      // Pushes the current HEAD to a specific remote branch
      await executeGitCommand({ repoPath, assignedUserId, env, gitArgs: ['push', 'origin', `HEAD:${branchName}`] })
    }

    module.exports = {
      gitAddAll,
      gitCommit,
      gitPush
    }
    ```
    *Self-Correction:* Initially considered `execFile`, but `spawn` provides better stream handling for potential large output from Git commands and finer control over stdio. Ensure `env` passed includes `GIT_SSH_COMMAND` setup elsewhere. Added logging.

2.  **Modify Bot Logic (e.g., Mention Handler):**
    *   Locate the part of your code where the response from `aider_wrapper.py` is processed (likely where you implemented Tutorial 9 and 24 logic).
    *   Import the new Git helper functions.
    *   After parsing the JSON output and confirming `overall_status: "success"`, check for `file_change` events.

    ```javascript
    // Example within your mention handler (e.g., handleCommand.js or similar)

    // ... require statements ...
    const { invokeAiderWrapper } = require('./aiderWrapper') // Your wrapper invoker
    const { gitAddAll, gitCommit, gitPush } = require('../lib/gitHelper') // Import new helper
    const { getRepoConfig } = require('./configManager') // Function to get repo details
    const log = require('../lib/log')
    const { constructSshCommand } = require('./secureKeys') // Function from Tutorial 17/21

    // ... inside your async function that handles the mention ...

    try {
      // ... existing code to prepare context, invoke wrapper ...
      const wrapperResultJson = await invokeAiderWrapper({ /* ... args ... */ })
      const wrapperResult = JSON.parse(wrapperResultJson)

      let replyContent = 'Aider task finished.' // Default reply

      if (wrapperResult.overall_status === 'success') {
        // Check for file changes (from Tutorial 24)
        const fileChanges = wrapperResult.events.filter(e => e.type === 'file_change')

        if (fileChanges.length > 0) {
          replyContent += `\nDetected ${fileChanges.length} file change(s).`
          log.info(`Detected ${fileChanges.length} file changes. Proceeding with Git operations.`)

          // --- Auto Git Operations ---
          try {
            const repoConfig = getRepoConfig(repoName) // Fetch repo config by name/ID
            if (!repoConfig || !repoConfig.repoPath || !repoConfig.assignedUserId || !repoConfig.secureKeyId) {
              throw new Error(`Missing critical repo config for ${repoName} for Git operations.`)
            }

            const { repoPath, assignedUserId, secureKeyId, repoUrl /* Assuming repoUrl is stored */ } = repoConfig
            const channelId = message.channel.id // Get channel ID from Discord message object
            const originalPrompt = userPrompt // The user's original request message content

            // 1. Construct Branch Name (Sanitize if necessary)
            const branchName = `aider/channel-${channelId}`.replace(/[^a-zA-Z0-9_\-\/]/g, '_') // Basic sanitization

            // 2. Construct Commit Message
            const commitMessage = `FEAT: Apply aider changes for prompt: "${originalPrompt.substring(0, 100)}${originalPrompt.length > 100 ? '...' : ''}"` // Keep it relatively short

            // 3. Prepare Environment with SSH Command (using function from Tutorial 17/21)
            const { command: gitSshCommand, cleanup: cleanupSsh } = await constructSshCommand(secureKeyId, assignedUserId)
            const gitEnv = { GIT_SSH_COMMAND: gitSshCommand }

            try {
              // 4. Execute Git Commands
              await gitAddAll({ repoPath, assignedUserId, env: gitEnv })
              await gitCommit({ repoPath, assignedUserId, env: gitEnv, message: commitMessage })
              await gitPush({ repoPath, assignedUserId, env: gitEnv, branchName: branchName })

              replyContent += `\n✅ Changes automatically staged, committed, and pushed to branch: \`${branchName}\``
              log.info(`Successfully pushed changes to branch ${branchName} for ${repoName}`)

            } catch (gitError) {
              log.error(`Git operation failed for ${repoName}: ${gitError}`)
              replyContent += `\n⚠️ Changes applied locally by aider, but failed to automatically push to remote: ${gitError.message}`
              // Do NOT roll back local changes. Aider has already made them.
            } finally {
               if (cleanupSsh) await cleanupSsh() // Important: Clean up temporary SSH key file
            }

          } catch (setupError) {
             log.error(`Failed to set up for Git operations: ${setupError}`)
             replyContent += `\n⚠️ Could not perform automatic Git operations due to a setup error: ${setupError.message}`
          }
          // --- End Auto Git Operations ---

        } else {
          replyContent += '\nNo file changes detected by aider.'
          log.info('Aider run successful, but no file changes detected.')
        }

      } else {
        // Handle aider failure case (existing logic)
        replyContent = `Aider task failed: ${wrapperResult.error || 'Unknown error'}`
        log.error(`Aider wrapper failed: ${JSON.stringify(wrapperResult)}`)
      }

      // ... send replyContent back to Discord ...

    } catch (error) {
      // ... handle errors from invokeAiderWrapper or JSON parsing ...
      log.error(`Error processing aider command: ${error}`)
      // Send error reply to Discord
    }
    ```
    *Self-Correction:* Added robust error handling for both Git command execution and the setup phase (fetching config, constructing SSH command). Included cleanup for the temporary SSH key file in a `finally` block. Made branch name and commit message construction more explicit. Ensured required config fields (`repoPath`, `assignedUserId`, `secureKeyId`) are checked. Used conventional commit type `FEAT`.

3.  **Update Dependencies (if needed):** No new npm packages are strictly required if you use `child_process`, but ensure your logger and config management modules are robust.

4.  **Run `standard --fix`:** Apply standard.js formatting to the new and modified files.
    ```bash
    npx standard --fix lib/gitHelper.js path/to/your/handler.js
    ```

## Testing

*   **Unit Tests (`test/gitHelper.test.js`):**
    *   Use a mocking library (like `sinon` or Jest's built-in mocking) to mock `child_process.spawn`.
    *   For each function (`gitAddAll`, `gitCommit`, `gitPush`):
        *   Call the function with test data (`repoPath`, `assignedUserId`, `env`, `message`, `branchName`).
        *   Assert that `spawn` was called with the correct arguments:
            *   Command: `sudo`
            *   Args: `['-u', testUserId, 'git', 'add', '.']` (for `gitAddAll`)
            *   Args: `['-u', testUserId, 'git', 'commit', '-m', testMessage]` (for `gitCommit`)
            *   Args: `['-u', testUserId, 'git', 'push', 'origin', `HEAD:${testBranchName}`]` (for `gitPush`)
            *   Options: Correct `cwd` and merged `env` (including `GIT_SSH_COMMAND`).
        *   Simulate `spawn` emitting 'close' with code 0 for success cases and code 1 (and stderr data) for failure cases. Assert the promise resolves or rejects accordingly.
        *   Simulate `spawn` emitting an 'error' event and assert the promise rejects.

*   **Integration/Handler Tests (e.g., `test/mentionHandler.test.js`):**
    *   Mock `invokeAiderWrapper` to return a success JSON *with* `file_change` events.
    *   Mock `getRepoConfig` to return valid configuration.
    *   Mock `constructSshCommand` to return a dummy command and cleanup function.
    *   Mock the actual `gitHelper` functions (`gitAddAll`, `gitCommit`, `gitPush`) using `sinon.stub` or similar.
    *   Run the handler logic.
    *   Assert that `gitAddAll`, `gitCommit`, and `gitPush` were called *in order* with the correct arguments derived from the mocked config and prompt.
    *   Assert the cleanup function from `constructSshCommand` was called.
    *   **Test Case: No Changes:** Mock `invokeAiderWrapper` to return success but with an *empty* `file_change` array. Assert *none* of the `gitHelper` functions were called.
    *   **Test Case: Git Failure:** Mock `gitPush` to throw an error. Assert `gitAddAll` and `gitCommit` were still called, but the final reply message indicates a push failure.
    *   **Test Case: Setup Failure:** Mock `getRepoConfig` to return invalid data or throw an error. Assert Git functions are not called and an appropriate error message is generated.

*   **Run Tests:** Execute `npm test` to ensure all tests pass.

## Conclusion

By adding the `gitHelper.js` module and integrating it into the bot's response processing logic, you can now automate the Git workflow after successful `aider` modifications. This streamlines the development process by ensuring changes are promptly version-controlled and pushed to a dedicated branch, improving collaboration and traceability. Remember to handle potential errors gracefully during Git operations and SSH key management. 