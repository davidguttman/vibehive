// lib/pythonWrapper.js

// 1. Package Requires
const { spawn } = require('child_process')
const path = require('path')

// 2. Local Requires (None)

// 3. Constants
// Resolve the path to the Python script relative to this module file
// Use '..' because this file is in lib/, and the script is in the root.
const scriptPath = path.resolve(__dirname, '../aider_wrapper.py')
const PYTHON_COMMAND = 'python3' // Or 'python' depending on your system PATH

// 4. Immediately Run Code (None)

// 5. Module Exports
module.exports = {
  invokeAiderWrapper
}

// 6. Functions

/**
 * Invokes the aider_wrapper.py script with a given prompt.
 * @param {object} options - The options object.
 * @param {string} options.prompt - The prompt string to pass to the script.
 * @param {string[]} [options.contextFiles=[]] - Optional array of context file paths.
 * @returns {Promise<{status: string, data?: object, error?: string, stdout?: string}>}
 *          Promise resolving to an object indicating success or failure.
 *          On success: { status: 'success', data: parsedJsonObject }
 *          On failure: { status: 'failure', error: errorMessage, stdout?: stdoutContent }
 */
async function invokeAiderWrapper ({ prompt, contextFiles = [] }) {
  return new Promise((resolve, reject) => {
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      // Basic validation
      return resolve({ status: 'failure', error: 'Invalid prompt provided.' })
    }

    const args = [
      scriptPath,
      '--prompt',
      prompt
    ]

    // Add context file arguments
    for (const filePath of contextFiles) {
      args.push('--context-file', filePath)
    }

    let stdoutData = ''
    let stderrData = ''

    try {
      const pythonProcess = spawn(PYTHON_COMMAND, args)

      pythonProcess.stdout.on('data', (data) => {
        stdoutData += data.toString()
      })

      pythonProcess.stderr.on('data', (data) => {
        stderrData += data.toString()
      })

      pythonProcess.on('error', (spawnError) => {
        // Errors during the spawning process itself (e.g., command not found)
        console.error(`Error spawning Python script: ${spawnError}`)
        resolve({ status: 'failure', error: `Failed to spawn script: ${spawnError.message}` })
      })

      pythonProcess.on('close', (code) => {
        console.log(`Python script exited with code ${code}`)
        console.log(`Stderr: ${stderrData}`)
        console.log(`Stdout: ${stdoutData}`)

        if (code !== 0) {
          resolve({ status: 'failure', error: stderrData || `Script exited with code ${code}`, stdout: stdoutData })
          return
        }

        if (stderrData) {
          // Sometimes scripts might print warnings to stderr but still exit 0
          // Treat non-empty stderr as a potential issue, though this might be adjusted based on script behavior
          console.warn(`Python script exited successfully (code 0) but produced stderr output: ${stderrData}`)
          // Optionally, could still try to parse stdout or return failure based on stderr content
        }

        // Try parsing stdout as JSON
        try {
          const parsedJson = JSON.parse(stdoutData)
          resolve({ status: 'success', data: parsedJson })
        } catch (parseError) {
          console.error(`Failed to parse JSON from Python script: ${parseError}`)
          resolve({ status: 'failure', error: `Failed to parse JSON output: ${parseError.message}`, stdout: stdoutData })
        }
      })
    } catch (initialError) {
      // Catch errors thrown synchronously by spawn if PYTHON_COMMAND is invalid etc.
      console.error(`Synchronous error spawning Python script: ${initialError}`)
      resolve({ status: 'failure', error: `Failed to start script execution: ${initialError.message}` })
    }
  })
}
