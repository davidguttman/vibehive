// lib/pythonWrapper.js

// 1. Package Requires
const { spawn } = require('node:child_process')
const path = require('node:path')

// 2. Local Requires
const { decrypt } = require('../lib/crypto.js')
const { writeTempKey, deleteTempKey } = require('../lib/secureKeys.js')

// 3. Constants
// Resolve the path to the Python script relative to this module file
// Use '..' because this file is in lib/, and the script is in the root.
const SCRIPT_PATH = path.join(__dirname, '..', 'aider_wrapper.py')
const PYTHON_COMMAND = 'python3' // Or 'python' depending on your system PATH
// Base directory where repositories will be checked out/cloned
// This should ideally come from config, but we'll define it here for now
const REPOS_BASE_DIR = process.env.REPO_BASE_DIR || '/app/repos'

// 4. Immediately Run Code (None)

// 5. Module Exports
module.exports = {
  invokeAiderWrapper,
  REPOS_BASE_DIR
}

// 6. Functions

/**
 * Invokes the aider_wrapper.py script with a given prompt and optional repo config.
 * @param {object} options - The options object.
 * @param {string} options.prompt - The prompt string to pass to the script.
 * @param {string[]} [options.contextFiles=[]] - Optional array of context file paths.
 * @param {object} [options.repoConfig=null] - Optional repository configuration object from DB.
 * @returns {Promise<{overall_status: string, events?: Array, error?: string, stdout?: string}>}
 *          Promise resolving to an object indicating success or failure.
 *          Matches the JSON structure expected from aider_wrapper.py on success.
 */
async function invokeAiderWrapper ({ prompt, contextFiles = [], repoConfig = null }) {
  if (!prompt) {
    console.error('Error: Prompt is required to invoke the Aider wrapper.')
    // Return structure matching expected Python output format for consistency
    return { overall_status: 'failure', error: 'Prompt is required.' }
  }

  if (!repoConfig || !repoConfig.repoName || !repoConfig.encryptedSshKey || !repoConfig.assignedUserId) {
    console.error('Error: repoConfig with repoName, encryptedSshKey, and assignedUserId is required.')
    return {
      overall_status: 'failure',
      error: 'Missing required repoConfig parameters: repoName, encryptedSshKey, assignedUserId'
    }
  }

  const { repoName, encryptedSshKey, assignedUserId } = repoConfig
  const repoPath = path.join(REPOS_BASE_DIR, repoName) // Full path to repository
  let keyFilePath = null
  let decryptedKey = null
  const spawnEnv = { ...process.env } // Use const

  console.log('Invoking Aider Wrapper', {
    repoName,
    promptLength: prompt.length,
    contextFileCount: contextFiles?.length || 0,
    assignedUserId,
    repoPath,
    scriptPath: SCRIPT_PATH
  })

  // --- SSH Key Handling ---
  try {
    console.log('Encrypted SSH key found, attempting to use it...')

    try {
      decryptedKey = decrypt(encryptedSshKey)
      if (!decryptedKey) {
        // Decrypt returns null on failure (e.g., wrong key, bad format)
        throw new Error('Failed to decrypt SSH key (decrypt returned null).')
      }

      // Pass ownerUserId to writeTempKey
      keyFilePath = await writeTempKey({
        repoName,
        keyContent: decryptedKey,
        ownerUserId: assignedUserId
      })
      console.log(`Temporary SSH key written to: ${keyFilePath}`)

      // Construct GIT_SSH_COMMAND
      const gitSshCommand = `ssh -i "${keyFilePath}" -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no` // Added quotes for safety
      // Modify property, not reassign spawnEnv itself
      spawnEnv.GIT_SSH_COMMAND = gitSshCommand
      console.log('GIT_SSH_COMMAND prepared for spawn.')
    } catch (error) {
      console.error('Error handling SSH key:', error)
      keyFilePath = null // Ensure keyFilePath is null if setup failed
      return { overall_status: 'failure', error: `Failed to prepare SSH key: ${error.message}` }
    }

    // 4. Prepare arguments for running the Python script through sudo
    const sudoCommand = 'sudo'
    const sudoArgs = [
      '-u', assignedUserId,
      PYTHON_COMMAND,
      SCRIPT_PATH,
      '--prompt', prompt
    ]

    // Add context file arguments
    if (contextFiles && contextFiles.length > 0) {
      contextFiles.forEach(file => {
        sudoArgs.push('--context-file', file)
      })
    }

    console.log('Executing command with sudo:', {
      command: sudoCommand,
      args: sudoArgs.map(arg => arg === prompt ? `prompt (${prompt.length} chars)` : arg), // Avoid logging full prompt
      cwd: repoPath,
      env: { GIT_SSH_COMMAND: '***MASKED***' } // Mask sensitive env var
    })

    let child // Define child process variable outside try
    try {
      // eslint-disable-next-line no-async-promise-executor
      return await new Promise(async (resolve, reject) => {
        console.log(`Spawning sudo command for Python wrapper in ${repoPath}`)
        // Spawn using sudo with the repository directory as working directory
        child = spawn(sudoCommand, sudoArgs, {
          env: spawnEnv,
          cwd: repoPath, // Set working directory to repository path
          stdio: ['pipe', 'pipe', 'pipe']
        })
        console.log('>>> [Wrapper] Spawn initiated.')

        let stdoutData = ''
        let stderrData = ''

        child.stdout.on('data', (data) => {
          stdoutData += data.toString()
        })

        child.stderr.on('data', (data) => {
          stderrData += data.toString()
        })

        child.on('error', async (spawnError) => {
          console.log('>>> [Wrapper] Spawn \'error\' event received.', spawnError)
          console.error('Failed to start Python script:', spawnError)
          // Clean up the key if spawn failed
          if (keyFilePath) {
            try {
              console.log('>>> [Wrapper] Attempting cleanup inside \'error\' handler...')
              await deleteTempKey({ repoName, ownerUserId: assignedUserId })
              console.log('>>> [Wrapper] Cleanup inside \'error\' handler completed.')
            } catch (cleanupErr) {
              console.error(`Error cleaning up key after spawn failure: ${cleanupErr.message}`)
            }
          }
          reject(new Error(`Failed to start Python script: ${spawnError.message}`))
          console.log('>>> [Wrapper] Promise rejected in \'error\' handler.')
        })

        child.on('close', async (code) => {
          console.log(`>>> [Wrapper] Spawn 'close' event received. Code: ${code}`)
          console.log(`Python script exited with code ${code}`)
          if (stderrData) {
            console.error('Python script stderr:', stderrData)
          }
          if (code !== 0) {
            // Script failed (non-zero exit code)
            // Ensure the key is deleted even if the script fails after starting
            if (keyFilePath) {
              try {
                console.log('>>> [Wrapper] Attempting cleanup inside \'close\' handler (non-zero code)...')
                await deleteTempKey({ repoName, ownerUserId: assignedUserId })
                console.log('>>> [Wrapper] Cleanup inside \'close\' handler completed.')
              } catch (cleanupErr) {
                console.error(`Error cleaning up key after script error: ${cleanupErr.message}`)
              }
            }
            reject(new Error(`Python script failed with code ${code}. Stderr: ${stderrData || 'N/A'}`))
            console.log('>>> [Wrapper] Promise rejected in \'close\' handler (non-zero code).')
          } else {
            // Script succeeded (zero exit code)
            try {
              const result = JSON.parse(stdoutData)
              if (result && typeof result.overall_status !== 'undefined') {
                resolve(result)
              } else {
                console.error('Parsed JSON from Python script is missing overall_status.')
                reject(new Error('Parsed JSON from script missing overall_status field.'))
              }
            } catch (parseError) {
              console.error('Failed to parse JSON from Python script:', parseError)
              console.error('Raw stdout:', stdoutData)
              reject(new Error(`Failed to parse JSON output from Python script: ${parseError.message}`))
            }
            console.log('>>> [Wrapper] Promise resolved in \'close\' handler (code 0).')
          }
        })
      })
    } catch (error) {
      console.error(`Error during invokeAiderWrapper execution (outside promise): ${error.message}`)
      // This catch block now handles rejections from the promise (spawn error, script error, parse error)
      // Ensure cleanup runs even if the promise rejects
      if (keyFilePath && !error.message.includes('Failed to prepare SSH key')) { // Avoid double cleanup if key prep failed
        console.log(`>>> [Wrapper] Re-attempting cleanup in outer catch block due to error: ${error.message}`)
        try {
          await deleteTempKey({ repoName, ownerUserId: assignedUserId })
        } catch (cleanupErr) {
          console.error(`>>> [Wrapper] Error during cleanup in outer catch: ${cleanupErr.message}`)
        }
      }
      // Re-throw the original error to be caught by the caller
      throw error
    } finally {
      // The finally block remains important as a final safeguard,
      // especially if the async cleanup inside the handlers somehow fails.
      console.log('>>> [Wrapper] Entering finally block.')
      if (keyFilePath) { // Check if keyFilePath was set (meaning writeTempKey succeeded)
        console.log(`>>> [Wrapper] Final cleanup check for repoName: ${repoName}`)
        try {
          // We might consider checking if the file still exists before deleting,
          // but deleteTempKey handles ENOENT gracefully, so calling it again is safe.
          await deleteTempKey({ repoName, ownerUserId: assignedUserId })
          console.log('>>> [Wrapper] deleteTempKey call in finally block completed.')
        } catch (cleanupErr) {
          console.error(`>>> [Wrapper] Error during final key cleanup: ${cleanupErr.message}`)
        }
      } else {
        console.log('>>> [Wrapper] Final cleanup skipped (keyFilePath not set).')
      }
      console.log('>>> [Wrapper] Exiting finally block.')
    }
  } catch (error) {
    console.error('Error in invokeAiderWrapper:', error)
    return { overall_status: 'failure', error: error.message }
  }
}
