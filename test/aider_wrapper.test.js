// test/aider_wrapper.test.js
const test = require('tape')
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

test('Aider Wrapper Script - Success Case', (t) => {
  const promptText = 'hello world'
  runScript(['--prompt', promptText], (error, stdout, stderr) => {
    t.error(error, 'Script should exit without error (error code 0)')
    t.equal(stderr, '', 'Stderr should be empty on success')

    try {
      const output = JSON.parse(stdout)
      t.ok(output, 'Stdout should be valid JSON')
      t.equal(output.overall_status, 'success', 'Status should be success')
      t.equal(output.error, null, 'Error field should be null')
      t.ok(Array.isArray(output.events), 'Events should be an array')
      t.equal(output.events.length, 1, 'Events array should have one element')
      t.equal(output.events[0].type, 'text_response', 'Event type should be text_response')
      t.equal(output.events[0].content, `Placeholder response for prompt: ${promptText}`, 'Event content should contain the prompt')
    } catch (parseError) {
      t.fail(`Failed to parse JSON output: ${parseError}\nOutput: ${stdout}`)
    }

    t.end()
  })
})

test('Aider Wrapper Script - Success Case with Context Files', (t) => {
  const promptText = 'process these files'
  const contextFiles = ['file1.txt', 'path/to/file2.js']
  const args = ['--prompt', promptText]
  contextFiles.forEach(file => {
    args.push('--context-file', file)
  })

  runScript(args, (error, stdout, stderr) => {
    t.error(error, 'Script should exit without error (error code 0)')
    t.equal(stderr, '', 'Stderr should be empty on success')

    try {
      const output = JSON.parse(stdout)
      t.ok(output, 'Stdout should be valid JSON')
      t.equal(output.overall_status, 'success', 'Status should be success')
      t.equal(output.error, null, 'Error field should be null')
      t.ok(Array.isArray(output.events), 'Events should be an array')
      t.ok(output.events.length > 0, 'Events array should have at least one element') // Basic check
      t.equal(output.events[0].type, 'text_response', 'First event type should be text_response')
      t.ok(output.events[0].content.includes(promptText), 'Event content should contain the prompt')
      t.ok(output.received_context_files, 'Output should contain received_context_files field')
      t.deepEqual(output.received_context_files, contextFiles, 'received_context_files should match input context files')
    } catch (parseError) {
      t.fail(`Failed to parse JSON output: ${parseError}\nOutput: ${stdout}`)
    }

    t.end()
  })
})

test('Aider Wrapper Script - Error Case (Missing Prompt)', (t) => {
  runScript([], (error, stdout, stderr) => {
    t.ok(error, 'Script should exit with an error (non-zero code)')
    // Different Python/argparse versions might exit with 1 or 2
    t.ok(error.code !== 0, `Exit code should be non-zero (was ${error.code})`)
    t.ok(stderr.includes('Error: --prompt argument is required.'), 'Stderr should contain the custom error message')
    // Depending on argparse version, stdout might be empty or contain usage info
    // t.equal(stdout, '', 'Stdout should ideally be empty on argument error')
    t.comment(`Stdout content on error: ${stdout}`)
    t.comment(`Stderr content on error: ${stderr}`)
    t.end()
  })
})
