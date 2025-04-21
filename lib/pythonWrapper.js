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

// 4. Immediately Run Code (None)

// 5. Module Exports
module.exports = {
  invokeAiderWrapper
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

  let keyFilePath = null
  let repoName = null // To be used for temp key management
  const spawnEnv = { ...process.env } // Use const
  const repoBaseDir = process.env.REPO_BASE_DIR // Use const

  // --- SSH Key Handling ---
  if (repoConfig && repoConfig.encryptedSshKey) {
    console.log('Encrypted SSH key found, attempting to use it...')
    // Use document ID for unique temp dir name, ensure it's a string
    repoName = repoConfig._id ? repoConfig._id.toString() : null

    if (!repoName) {
      console.error('Error: Cannot determine repoName for temporary key storage (missing _id).')
      return { overall_status: 'failure', error: 'Cannot determine repoName for temporary key storage.' }
    }

    try {
      const decryptedKey = decrypt(repoConfig.encryptedSshKey)
      if (!decryptedKey) {
        // Decrypt returns null on failure (e.g., wrong key, bad format)
        throw new Error('Failed to decrypt SSH key (decrypt returned null).')
      }

      // Pass repoBaseDir to writeTempKey
      keyFilePath = await writeTempKey({ repoName, keyContent: decryptedKey, repoBaseDir })
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
  } // --- End SSH Key Handling ---

  const args = [
    SCRIPT_PATH,
    '--prompt',
    prompt
  ]

  // Add context file arguments
  if (contextFiles && contextFiles.length > 0) {
    contextFiles.forEach(file => {
      args.push('--context-file', file)
    })
  }

  let child // Define child process variable outside try
  try {
    return await new Promise((resolve) => {
      console.log(`Spawning python script: ${PYTHON_COMMAND} ${args.join(' ')}`)
      // Spawn using the potentially modified spawnEnv
      child = spawn(PYTHON_COMMAND, args, { env: spawnEnv })
      console.log('>>> [Wrapper] Spawn initiated.')

      let stdoutData = ''
      let stderrData = ''

      child.stdout.on('data', (data) => {
        // console.log('>>> [Wrapper] stdout data event');
        stdoutData += data.toString()
      })

      child.stderr.on('data', (data) => {
        // console.log('>>> [Wrapper] stderr data event');
        stderrData += data.toString()
      })

      child.on('close', (code) => {
        console.log(`>>> [Wrapper] Spawn 'close' event received. Code: ${code}`)
        console.log(`Python script exited with code ${code}`)
        if (stderrData) {
          console.error('Python script stderr:', stderrData)
        }
        if (code !== 0) {
          // Script failed (non-zero exit code)
          resolve({
            overall_status: 'failure',
            error: `Python script failed with code ${code}. Stderr: ${stderrData || 'N/A'}`,
            stdout: stdoutData
          })
        } else {
          // Script succeeded (zero exit code)
          try {
            const result = JSON.parse(stdoutData)
            if (result && typeof result.overall_status !== 'undefined') {
              resolve(result)
            } else {
              console.error('Parsed JSON from Python script is missing overall_status.')
              resolve({
                overall_status: 'failure',
                error: 'Parsed JSON from script missing overall_status field.',
                stdout: stdoutData
              })
            }
          } catch (parseError) {
            console.error('Failed to parse JSON from Python script:', parseError)
            console.error('Raw stdout:', stdoutData)
            resolve({
              overall_status: 'failure',
              error: `Failed to parse JSON output from Python script: ${parseError.message}`,
              stdout: stdoutData
            })
          }
        }
        console.log('>>> [Wrapper] Promise resolved in \'close\' handler.')
      })

      child.on('error', (spawnError) => {
        console.log('>>> [Wrapper] Spawn \'error\' event received.', spawnError)
        console.error('Failed to start Python script:', spawnError)
        resolve({
          overall_status: 'failure',
          error: `Failed to start Python script: ${spawnError.message}`
        })
        console.log('>>> [Wrapper] Promise resolved in \'error\' handler.')
      })
    })
  } finally {
    console.log('>>> [Wrapper] Entering finally block.')
    if (keyFilePath && repoName) {
      console.log(`>>> [Wrapper] Attempting cleanup for repoName: ${repoName} at path: ${keyFilePath}`)
      try {
        console.log('>>> [Wrapper] Calling deleteTempKey...')
        // Pass repoBaseDir to deleteTempKey
        await deleteTempKey({ repoName, repoBaseDir })
        console.log(`>>> [Wrapper] deleteTempKey call completed (awaited). Path: ${keyFilePath}`)
        console.log(`Successfully initiated deletion for temporary key: ${keyFilePath}`)
      } catch (cleanupError) {
        console.error(`>>> [Wrapper] Error during deleteTempKey call: ${cleanupError.message}`)
        console.error(`Error cleaning up temporary SSH key ${keyFilePath}:`, cleanupError)
      }
    } else if (repoConfig && repoConfig.encryptedSshKey) {
      console.log('>>> [Wrapper] Cleanup skipped because temporary SSH key was not successfully written.')
    }
    console.log('>>> [Wrapper] Exiting finally block.')
  }
}
