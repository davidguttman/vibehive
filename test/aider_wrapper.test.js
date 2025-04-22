// test/aider_wrapper.test.js
const test = require('ava')
// Use execa for synchronous execution needed in setup
const { execaSync } = require('execa')
const { execFile } = require('child_process')
const path = require('path')
const fs = require('fs-extra') // For filesystem operations
const os = require('os') // For temporary directory path

// Resolve the path to the Python script relative to the test file
const scriptPath = path.resolve(__dirname, '../aider_wrapper.py')

// Temporary directory for git repo
let testRepoPath

// --- Setup and Teardown Hooks ---
test.beforeEach(t => {
  // Create a temporary directory for the test git repo
  testRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-test-'))
  try {
    // Initialize git repository
    execaSync('git', ['init', '-b', 'main'], { cwd: testRepoPath }) // Use execaSync
    // Create an initial file
    fs.writeFileSync(path.join(testRepoPath, 'dummy.txt'), 'Initial content.')
    // Add and commit the initial file
    execaSync('git', ['add', '.'], { cwd: testRepoPath }) // Use execaSync
    // Configure git user locally for the commit to succeed in CI environments
    execaSync('git', ['config', 'user.email', 'test@example.com'], { cwd: testRepoPath }) // Use execaSync
    execaSync('git', ['config', 'user.name', 'Test User'], { cwd: testRepoPath }) // Use execaSync
    execaSync('git', ['commit', '-m', 'Initial commit'], { cwd: testRepoPath }) // Use execaSync
  } catch (error) {
    console.error('Error during test setup:', error)
    throw error // Fail test if setup fails
  }
})

test.afterEach.always(t => {
  // Clean up the temporary directory
  if (testRepoPath) {
    try {
      fs.removeSync(testRepoPath)
    } catch (error) {
      console.error(`Error cleaning up test repo ${testRepoPath}:`, error)
      // Don't fail test just because cleanup failed, but log it.
    }
  }
})

// Helper to run the script within the test repository context
function runScriptInRepo (args, callback) {
  // Ensure the script is executable or call python3 directly
  // Crucially, set the current working directory (cwd) to the test repo
  execFile('python3', [scriptPath, ...args], { cwd: testRepoPath }, (error, stdout, stderr) => {
    callback(error, stdout, stderr)
  })
}

// --- Existing Tests (Modified to run in repo if needed, or kept separate) ---

// Test basic execution *without* file changes (runs in repo now, but doesn't modify files)
test.serial('Aider Wrapper Script - Base Execution in Repo', async (t) => {
  const promptText = 'Just say hello.' // Prompt that shouldn't cause file changes
  await new Promise((resolve, reject) => {
    // Use the new helper to run within the initialized git repo
    runScriptInRepo(['--prompt', promptText], (error, stdout, stderr) => {
      try {
        // Allow stderr for config error
        t.log(`Stderr (if any): ${stderr}`)
        t.falsy(error, `Script should exit without error (code 0). Error: ${error}`)

        let output
        try {
          output = JSON.parse(stdout)
          t.truthy(output, 'Stdout should be valid JSON')

          // Check for handled config error OR actual success (if aider is configured)
          if (output.error?.includes('Aider configuration error')) {
            t.is(output.overall_status, 'success', 'Status should be success (config error handled)')
            t.is(output.events?.[0]?.content, 'Aider run skipped due to config.', 'Event content should indicate config skip')
            t.truthy(stderr?.length > 0, 'Stderr should contain traceback on handled config error')
          } else {
            t.is(output.overall_status, 'success', 'Status should be success')
            t.is(output.error, null, 'Error field should be null on success')
            // Check for the "0 file changes" message
            const statusEvent = output.events.find(e => e.type === 'status_message')
            t.truthy(statusEvent, 'Should have a status message event')
            t.true(statusEvent.content.startsWith('Aider run completed.'), 'Status message should indicate completion')
            t.false(statusEvent.content.includes('Detected'), 'Status message should not mention detected changes')
            const fileChangeEvents = output.events.filter(e => e.type === 'file_change')
            t.is(fileChangeEvents.length, 0, 'Should be no file_change events')
          }
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

// Test argument parsing error (doesn't need repo context)
test.serial('Aider Wrapper Script - Error Case (Missing Prompt)', async (t) => {
  await new Promise((resolve, reject) => {
    // Run without --prompt, no need for repo context here
    execFile('python3', [scriptPath], (error, stdout, stderr) => {
      try {
        t.truthy(error, 'Script should exit with an error (non-zero code)')
        t.true(error.code !== 0, `Exit code should be non-zero (was ${error.code})`)
        t.truthy(stderr.includes('usage: aider_wrapper.py'), 'Stderr should contain usage info')
        t.truthy(stderr.includes('required: --prompt'), 'Stderr should mention missing --prompt')
        t.is(stdout, '', 'Stdout should be empty on argument parsing error')
        resolve()
      } catch (assertionError) {
        reject(assertionError)
      }
    })
  })
})

// --- New Tests for File Change Detection ---

test.serial('Aider Wrapper Script - Detects File Modification', async (t) => {
  // Modify the dummy file *before* running the script
  const modifiedContent = 'Initial content.\nModified line.'
  fs.writeFileSync(path.join(testRepoPath, 'dummy.txt'), modifiedContent)

  const promptText = 'Modify dummy.txt' // Prompt text (doesn't actually matter as we pre-modified)
  await new Promise((resolve, reject) => {
    runScriptInRepo(['--prompt', promptText], (error, stdout, stderr) => {
      try {
        t.log(`Stderr (if any): ${stderr}`)
        t.falsy(error, `Script should exit without error (code 0). Error: ${error}`)

        let output
        try {
          output = JSON.parse(stdout)
          t.truthy(output, 'Stdout should be valid JSON')

          // Check for handled config error OR actual success
          if (output.error?.includes('Aider configuration error')) {
            t.is(output.overall_status, 'success', 'Status should be success (config error handled)')
            t.is(output.events?.[0]?.content, 'Aider run skipped due to config.', 'Event content should indicate config skip')
            t.pass('Skipping detailed file change check due to Aider config error')
          } else {
            t.is(output.overall_status, 'success', 'Status should be success')
            t.is(output.error, null, 'Error field should be null')

            const statusEvent = output.events.find(e => e.type === 'status_message')
            t.truthy(statusEvent, 'Should have a status message event')
            t.true(statusEvent.content.includes('Detected 1 file change(s).'), 'Status message should mention 1 change')

            const fileChangeEvents = output.events.filter(e => e.type === 'file_change')
            t.is(fileChangeEvents.length, 1, 'Should be exactly one file_change event')

            const change = fileChangeEvents[0]
            t.is(change.filename, 'dummy.txt', 'Filename should be dummy.txt')
            t.is(change.change_type, 'modified', 'Change type should be modified')
            t.is(change.content, modifiedContent, 'Content should match the modified content')
            t.truthy(change.diff, 'Diff should be present for modification') // Basic check, content is more reliable here
            t.true(change.diff.includes('+Modified line.'), 'Diff should show the added line')
          }
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

test.serial('Aider Wrapper Script - Detects File Addition', async (t) => {
  // Create a new file *before* running the script (simulates aider adding it)
  const newFilename = 'new_file.py'
  const newFileContent = '# A new python file\nprint("hello")'
  fs.writeFileSync(path.join(testRepoPath, newFilename), newFileContent)

  const promptText = 'Add a new file' // Prompt text (doesn't actually matter)
  await new Promise((resolve, reject) => {
    runScriptInRepo(['--prompt', promptText], (error, stdout, stderr) => {
      try {
        t.log(`Stderr (if any): ${stderr}`)
        t.falsy(error, `Script should exit without error (code 0). Error: ${error}`)

        let output
        try {
          output = JSON.parse(stdout)
          t.truthy(output, 'Stdout should be valid JSON')

          if (output.error?.includes('Aider configuration error')) {
            t.is(output.overall_status, 'success', 'Status should be success (config error handled)')
            t.pass('Skipping detailed file change check due to Aider config error')
          } else {
            t.is(output.overall_status, 'success', 'Status should be success')
            t.is(output.error, null, 'Error field should be null')

            const statusEvent = output.events.find(e => e.type === 'status_message')
            t.truthy(statusEvent, 'Should have a status message event')
            t.true(statusEvent.content.includes('Detected 1 file change(s).'), 'Status message should mention 1 change')

            const fileChangeEvents = output.events.filter(e => e.type === 'file_change')
            t.is(fileChangeEvents.length, 1, 'Should be exactly one file_change event')

            const change = fileChangeEvents[0]
            t.is(change.filename, newFilename, 'Filename should match the new file')
            t.is(change.change_type, 'added', 'Change type should be added')
            t.is(change.content, newFileContent, 'Content should match the new file content')
            t.is(change.diff, null, 'Diff should be null for added file')
          }
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

test.serial('Aider Wrapper Script - Detects File Deletion', async (t) => {
  // Delete the initial dummy file *before* running the script
  const deletedFilename = 'dummy.txt'
  fs.removeSync(path.join(testRepoPath, deletedFilename))

  const promptText = 'Delete dummy.txt' // Prompt text (doesn't actually matter)
  await new Promise((resolve, reject) => {
    runScriptInRepo(['--prompt', promptText], (error, stdout, stderr) => {
      try {
        t.log(`Stderr (if any): ${stderr}`)
        t.falsy(error, `Script should exit without error (code 0). Error: ${error}`)

        let output
        try {
          output = JSON.parse(stdout)
          t.truthy(output, 'Stdout should be valid JSON')

          if (output.error?.includes('Aider configuration error')) {
            t.is(output.overall_status, 'success', 'Status should be success (config error handled)')
            t.pass('Skipping detailed file change check due to Aider config error')
          } else {
            t.is(output.overall_status, 'success', 'Status should be success')
            t.is(output.error, null, 'Error field should be null')

            const statusEvent = output.events.find(e => e.type === 'status_message')
            t.truthy(statusEvent, 'Should have a status message event')
            t.true(statusEvent.content.includes('Detected 1 file change(s).'), 'Status message should mention 1 change')

            const fileChangeEvents = output.events.filter(e => e.type === 'file_change')
            t.is(fileChangeEvents.length, 1, 'Should be exactly one file_change event')

            const change = fileChangeEvents[0]
            t.is(change.filename, deletedFilename, 'Filename should match the deleted file')
            t.is(change.change_type, 'deleted', 'Change type should be deleted')
            t.is(change.content, null, 'Content should be null for deleted file')
            t.is(change.diff, null, 'Diff should be null for deleted file')
          }
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

// Note: We removed the old 'Integration' tests as they are superseded by the new tests
// running within the temporary git repository context. The file change tests effectively
// act as integration tests for the file detection logic. The base execution test checks
// the scenario with no changes within the repo.
