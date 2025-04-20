# Tutorial: Creating a Node.js Wrapper for the Python Script

This tutorial covers creating a Node.js module that acts as an interface to our `aider_wrapper.py` script. This module will handle spawning the Python process, passing arguments, capturing its output (stdout and stderr), parsing the JSON result, and handling potential errors.

## Prerequisites

*   Completion of the previous tutorials (up to [06](./06-aider-wrapper.md)).
*   The `aider_wrapper.py` script exists and is executable.

## Step 1: Create the Node.js Wrapper Module (`lib/pythonWrapper.js`)

We'll create this module within the `lib` directory.

Create the file `lib/pythonWrapper.js`:

```javascript
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
 * @returns {Promise<{status: string, data?: object, error?: string, stdout?: string}>} 
 *          Promise resolving to an object indicating success or failure.
 *          On success: { status: 'success', data: parsedJsonObject }
 *          On failure: { status: 'failure', error: errorMessage, stdout?: stdoutContent }
 */
async function invokeAiderWrapper ({ prompt }) {
  return new Promise((resolve, reject) => {
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      // Basic validation
      return resolve({ status: 'failure', error: 'Invalid prompt provided.' })
    }

    const args = [scriptPath, '--prompt', prompt]
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
          console.warn(`Python script exited successfully (code 0) but produced stderr output: ${stderrData}`);
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

```

**Explanation:**
1.  **Requires**: Imports `spawn` from `child_process` for running external commands and `path` for resolving the script location.
2.  **Constants**: Defines `scriptPath` (using `path.resolve` and `__dirname` to correctly locate `aider_wrapper.py` from the `lib` directory) and `PYTHON_COMMAND`.
3.  **`invokeAiderWrapper({ prompt })`**: The main exported async function, accepting the prompt in an options object.
4.  **Promise Wrapper**: The entire logic is wrapped in a `Promise` because `spawn` is asynchronous and event-based.
5.  **Basic Validation**: Checks if a valid prompt was provided.
6.  **`spawn(PYTHON_COMMAND, args)`**: Starts the Python script.
    *   `PYTHON_COMMAND`: Should be `python3` or `python` depending on your system.
    *   `args`: An array containing the script path and its arguments (`--prompt`, `prompt`).
7.  **Stream Handling**: Event listeners (`.on('data', ...)` ) capture data from `stdout` and `stderr` as it arrives, converting it to strings and accumulating it.
8.  **Error Handling**: 
    *   `pythonProcess.on('error', ...)`: Catches errors *spawning* the process (e.g., Python command not found).
    *   `pythonProcess.on('close', ...)`: Executes when the script finishes.
        *   Checks the `code` (exit code). Non-zero indicates an error in the script.
        *   Checks if `stderrData` has content. Even with exit code 0, stderr might contain warnings.
        *   If code is 0, attempts to `JSON.parse(stdoutData)`.
        *   Catches JSON parsing errors.
    *   Outer `try...catch`: Catches potential synchronous errors when initially calling `spawn`.
9.  **Resolution**: The promise resolves with an object: `{ status: 'success', data: ... }` or `{ status: 'failure', error: ..., stdout: ... }`.

## Step 2: Run the Linter

Apply standard style to the new `lib/pythonWrapper.js` file:

```bash
npm run lint
```

## Step 3: Create Test File (`test/pythonWrapper.test.js`)

Create a test file to verify the Node.js wrapper module.

Create `test/pythonWrapper.test.js`:

```javascript
// test/pythonWrapper.test.js
const test = require('tape')
const path = require('path')
const fs = require('fs')
const sinon = require('sinon')
const childProcess = require('child_process') // To stub spawn

// Ensure NODE_ENV is test
process.env.NODE_ENV = 'test'

// Path to the script we are testing
const scriptPath = path.resolve(__dirname, '../aider_wrapper.py')
// Path to the module we are testing
const pythonWrapperPath = '../lib/pythonWrapper.js'

// --- Test Cases ---

test('Python Wrapper - Success Case', async (t) => {
  // Ensure the real script exists and is executable for this test
  try {
    fs.accessSync(scriptPath, fs.constants.X_OK)
  } catch (err) {
    t.fail(`Prerequisite failed: ${scriptPath} not found or not executable. Run chmod +x?`)
    t.end()
    return
  }

  const { invokeAiderWrapper } = require(pythonWrapperPath)
  const promptText = 'Test prompt for success'
  const result = await invokeAiderWrapper({ prompt: promptText })

  t.equal(result.status, 'success', 'Status should be success')
  t.ok(result.data, 'Should have data object on success')
  t.notOk(result.error, 'Error should be null or undefined on success')
  t.equal(result.data.overall_status, 'success', 'Inner status should be success')
  t.ok(Array.isArray(result.data.events), 'Events should be an array')
  t.equal(result.data.events[0]?.content, `Placeholder response for prompt: ${promptText}`, 'Content should match')

  t.end()
})

test('Python Wrapper - Script Error (Missing Prompt)', async (t) => {
  // This relies on the actual script exiting non-zero and writing to stderr
  const { invokeAiderWrapper } = require(pythonWrapperPath)
  // Calling without prompt relies on python script's argparser failing
  // We pass an empty string which our JS validation allows, but python script requires --prompt
  const result = await invokeAiderWrapper({ prompt: ' ' }) // Pass empty prompt to trigger python error

  // Let's modify this test to directly call without the arg
  // The previous test test/aider_wrapper.test.js already verified the script exit code
  // This test should focus on how invokeAiderWrapper handles the exit code
  
  // Re-require to avoid caching issues if necessary, or use a fresh instance
  delete require.cache[require.resolve(pythonWrapperPath)]
  const { invokeAiderWrapper: invokeAgain } = require(pythonWrapperPath)
  
  // Simulate calling the script incorrectly (e.g., invalid arg setup if spawn was mocked,
  // but here we rely on the real script failing)
  // We can't directly invoke without prompt arg via the JS function due to its internal validation.
  // So, we'll test the *handling* of a failed execution by mocking spawn.
  
  const spawnStub = sinon.stub(childProcess, 'spawn').returns({
    stdout: {
      on: (event, cb) => { if (event === 'data') cb('invalid output') }
    },
    stderr: {
      on: (event, cb) => { if (event === 'data') cb('Python script error output') }
    },
    on: (event, cb) => {
      if (event === 'close') cb(1); // Simulate non-zero exit code
      if (event === 'error') { /* Do nothing for this case */ }
    }
  })

  const resultFromMockedFailure = await invokeAgain({ prompt: 'trigger mocked failure' })

  t.equal(resultFromMockedFailure.status, 'failure', 'Status should be failure on script error')
  t.ok(resultFromMockedFailure.error, 'Should have an error message')
  t.match(resultFromMockedFailure.error, /Python script error output|Script exited with code 1/, 'Error message should contain stderr or exit code')

  spawnStub.restore()
  t.end()
})

test('Python Wrapper - Spawn Error', async (t) => {
  delete require.cache[require.resolve(pythonWrapperPath)]
  const { invokeAiderWrapper } = require(pythonWrapperPath)
  const spawnError = new Error('ENOENT: python3 not found')
  spawnError.code = 'ENOENT'

  // Stub spawn to immediately emit an 'error' event
  const spawnStub = sinon.stub(childProcess, 'spawn').throws(spawnError) // More direct simulation
  // Or simulate by emitting error event:
  // const spawnStub = sinon.stub(childProcess, 'spawn').returns({
  //   stdout: { on: () => {} },
  //   stderr: { on: () => {} },
  //   on: (event, cb) => { if (event === 'error') cb(spawnError); }
  // });

  const result = await invokeAiderWrapper({ prompt: 'trigger spawn error' })

  t.equal(result.status, 'failure', 'Status should be failure on spawn error')
  t.ok(result.error, 'Should contain an error message')
  t.match(result.error, /Failed to start script execution: ENOENT/, 'Error message should indicate spawn failure')

  spawnStub.restore()
  t.end()
})

test('Python Wrapper - JSON Parse Error', async (t) => {
  delete require.cache[require.resolve(pythonWrapperPath)]
  const { invokeAiderWrapper } = require(pythonWrapperPath)

  // Mock spawn to return invalid JSON but exit successfully
  const spawnStub = sinon.stub(childProcess, 'spawn').returns({
    stdout: {
      on: (event, cb) => { if (event === 'data') cb('this is not json') }
    },
    stderr: {
      on: (event, cb) => { /* No stderr */ }
    },
    on: (event, cb) => {
      if (event === 'close') cb(0); // Simulate success exit code
      if (event === 'error') { /* No spawn error */ }
    }
  })

  const result = await invokeAiderWrapper({ prompt: 'trigger parse error' })

  t.equal(result.status, 'failure', 'Status should be failure on parse error')
  t.ok(result.error, 'Should have an error message')
  t.match(result.error, /Failed to parse JSON output/, 'Error message should indicate JSON parse failure')
  t.equal(result.stdout, 'this is not json', 'Should include original stdout in error object')

  spawnStub.restore()
  t.end()
})

```

**Explanation of `test/pythonWrapper.test.js`:**
1.  **Requires**: Includes `tape`, `path`, `fs` (for checking script existence), `sinon`, and `child_process`.
2.  **Path**: Defines path to the module being tested (`lib/pythonWrapper.js`).
3.  **Success Test**: Requires the wrapper module and calls `invokeAiderWrapper` with a valid prompt. Asserts the returned object has `status: 'success'` and the expected parsed `data` from the real script execution.
4.  **Script Error Test**: This test now focuses on the wrapper's *handling* of a script failure. It uses `sinon.stub` to replace `child_process.spawn`. The stub simulates the Python script exiting with code 1 and outputting specific stderr. It asserts that `invokeAiderWrapper` returns `{ status: 'failure', error: ... }` containing the stderr message.
5.  **Spawn Error Test**: Stubs `spawn` to throw an error (like `ENOENT` if `python3` isn't found) *synchronously* when called. Asserts the wrapper catches this and returns a failure object indicating a spawn failure.
6.  **JSON Parse Error Test**: Stubs `spawn` to make the script exit successfully (code 0) but output invalid JSON to stdout. Asserts the wrapper catches the `JSON.parse` error and returns a failure object indicating a parse error, including the raw stdout.
7.  **`delete require.cache[...]`**: Used before requiring the module in tests that modify its dependencies (like stubbing `spawn`) to ensure a clean state for each test.

## Step 4: Run Tests

Execute the Node.js tests to verify the wrapper module handles success and various error conditions correctly.

```bash
npm test
```

---

Complete! You now have a robust Node.js module (`lib/pythonWrapper.js`) for executing the Python script, capturing its output, and handling different success and error scenarios. The accompanying tests verify this wrapper logic thoroughly. 