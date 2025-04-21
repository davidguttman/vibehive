// test/aider_wrapper.test.js
const test = require('ava')
const { execFile } = require('child_process')
const path = require('path')

// Resolve the path to the Python script relative to the test file
const scriptPath = path.resolve(__dirname, '../aider_wrapper.py')

// Helper to run the script
function runScript (args, callback) {
  // Use 'python3' or 'python' depending on your system setup
  // Ensure the script is executable or call python3 directly
  execFile('python3', [scriptPath, ...args], (error, stdout, stderr) => {
    callback(error, stdout, stderr)
  })
}

test.serial('Aider Wrapper Script - Success Case', async (t) => {
  const promptText = 'hello world'
  await new Promise((resolve, reject) => {
    runScript(['--prompt', promptText], (error, stdout, stderr) => {
      try {
        t.falsy(error, 'Script should exit without error (error code 0)')
        t.is(stderr, '', 'Stderr should be empty on success')

        try {
          const output = JSON.parse(stdout)
          t.truthy(output, 'Stdout should be valid JSON')
          t.is(output.overall_status, 'success', 'Status should be success')
          t.is(output.error, null, 'Error field should be null')
          t.true(Array.isArray(output.events), 'Events should be an array')
          t.is(output.events.length, 1, 'Events array should have one element')
          t.is(output.events[0].type, 'text_response', 'Event type should be text_response')
          t.is(output.events[0].content, `Placeholder response for prompt: ${promptText}`, 'Event content should contain the prompt')
        } catch (parseError) {
          t.fail(`Failed to parse JSON output: ${parseError}\nOutput: ${stdout}`)
        }
        resolve()
      } catch (assertionError) {
        reject(assertionError)
      }
    })
  })
})

test.serial('Aider Wrapper Script - Success Case with Context Files', async (t) => {
  const promptText = 'process these files'
  const contextFiles = ['file1.txt', 'path/to/file2.js']
  const args = ['--prompt', promptText]
  contextFiles.forEach(file => {
    args.push('--context-file', file)
  })

  await new Promise((resolve, reject) => {
    runScript(args, (error, stdout, stderr) => {
      try {
        t.falsy(error, 'Script should exit without error (error code 0)')
        t.is(stderr, '', 'Stderr should be empty on success')

        try {
          const output = JSON.parse(stdout)
          t.truthy(output, 'Stdout should be valid JSON')
          t.is(output.overall_status, 'success', 'Status should be success')
          t.is(output.error, null, 'Error field should be null')
          t.true(Array.isArray(output.events), 'Events should be an array')
          t.truthy(output.events.length > 0, 'Events array should have at least one element')
          t.is(output.events[0].type, 'text_response', 'First event type should be text_response')
          t.truthy(output.events[0].content.includes(promptText), 'Event content should contain the prompt')
          t.truthy(output.received_context_files, 'Output should contain received_context_files field')
          t.deepEqual(output.received_context_files, contextFiles, 'received_context_files should match input context files')
        } catch (parseError) {
          t.fail(`Failed to parse JSON output: ${parseError}\nOutput: ${stdout}`)
        }
        resolve()
      } catch (assertionError) {
        reject(assertionError)
      }
    })
  })
})

test.serial('Aider Wrapper Script - Error Case (Missing Prompt)', async (t) => {
  await new Promise((resolve, reject) => {
    runScript([], (error, stdout, stderr) => {
      try {
        t.truthy(error, 'Script should exit with an error (non-zero code)')
        // Different Python/argparse versions might exit with 1 or 2
        t.truthy(error.code !== 0, `Exit code should be non-zero (was ${error.code})`)
        t.truthy(stderr.includes('Error: --prompt argument is required.'), 'Stderr should contain the custom error message')
        // Depending on argparse version, stdout might be empty or contain usage info
        // t.is(stdout, '', 'Stdout should ideally be empty on argument error')
        t.log(`Stdout content on error: ${stdout}`)
        t.log(`Stderr content on error: ${stderr}`)
        resolve()
      } catch (assertionError) {
        reject(assertionError)
      }
    })
  })
})
