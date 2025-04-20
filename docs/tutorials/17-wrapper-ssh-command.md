# Tutorial 17: Injecting SSH Key via GIT_SSH_COMMAND in Wrapper

This tutorial integrates the SSH key decryption and temporary file handling (from Tutorials 13 & 16) into the Python wrapper invocation. When a repository requires an SSH key, we will decrypt it, write it to a temporary file, and then tell `git` (via the Python script) to use this key by setting the `GIT_SSH_COMMAND` environment variable.

**Goal:** Modify `lib/pythonWrapper.js` and the mention handler in `events/interactionCreate.js` to securely handle and use SSH keys for git operations performed by the wrapper.

## Steps:

1.  **Modify `lib/pythonWrapper.js` - Imports and Signature:**
    -   Require the necessary functions: `decrypt` from `../lib/crypto.js` and `writeTempKey`, `deleteTempKey` from `../lib/secureKeys.js`.
    -   Update the `invokeAiderWrapper` function signature to accept an options object containing `{ prompt, contextFiles, repoConfig }`.

    ```javascript
    // lib/pythonWrapper.js
    const { spawn } = require('node:child_process')
    const path = require('node:path')

    // Local requires
    const { decrypt } = require('../lib/crypto.js') // Added
    const { writeTempKey, deleteTempKey } = require('../lib/secureKeys.js') // Added

    // Constants
    const SCRIPT_PATH = path.join(__dirname, '..', 'aider_wrapper.py')

    // Updated function signature
    async function invokeAiderWrapper ({ prompt, contextFiles = [], repoConfig = null }) {
      // ... rest of the function
    }

    module.exports = {
      invokeAiderWrapper
    }
    ```
    *Self-correction: Ensured local requires are placed after package requires as per style guide.*

2.  **Modify `lib/pythonWrapper.js` - Key Handling Logic:**
    -   Inside `invokeAiderWrapper`, before the `spawn` call:
        -   Initialize `keyFilePath = null` and `repoName = null`.
        -   Check if `repoConfig` and `repoConfig.encryptedSshKey` are present.
        -   If yes:
            -   Determine a `repoName` for temporary key storage. Using the MongoDB document ID (`repoConfig._id.toString()`) is a reasonable unique identifier for now.
            -   Decrypt the `encryptedSshKey` using `decrypt`. Handle potential decryption errors gracefully.
            -   If decryption succeeds, call `writeTempKey` with the `repoName` and decrypted content. Store the returned `keyFilePath`.
            -   Construct the `GIT_SSH_COMMAND` string using the `keyFilePath`. This command tells `ssh` to use the specific key file and bypass host key checking (suitable for this automated context, but be aware of the security implication of ignoring host keys).
            -   Prepare the `env` object for `spawn`, merging `process.env` with the new `GIT_SSH_COMMAND`.
    -   If no key is needed, the `env` passed to `spawn` will just be `process.env`.

    ```javascript
    // lib/pythonWrapper.js
    // ... (requires, SCRIPT_PATH)

    async function invokeAiderWrapper ({ prompt, contextFiles = [], repoConfig = null }) {
      if (!prompt) {
        console.error('Error: Prompt is required to invoke the Aider wrapper.')
        return { overall_status: 'failure', error: 'Prompt is required.' }
      }

      let keyFilePath = null
      let repoName = null // To be used for temp key management
      let spawnEnv = process.env // Default environment

      // --- SSH Key Handling ---
      if (repoConfig && repoConfig.encryptedSshKey) {
        console.log('Encrypted SSH key found, attempting to use it...')
        repoName = repoConfig._id.toString() // Use document ID for unique temp dir name

        try {
          const decryptedKey = decrypt(repoConfig.encryptedSshKey)
          if (!decryptedKey) {
            throw new Error('Failed to decrypt SSH key (decrypt returned null).')
          }

          keyFilePath = await writeTempKey({ repoName, keyContent: decryptedKey })
          console.log(`Temporary SSH key written to: ${keyFilePath}`)

          const gitSshCommand = `ssh -i ${keyFilePath} -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no`
          spawnEnv = {
            ...process.env, // Inherit existing environment variables
            GIT_SSH_COMMAND: gitSshCommand
          }
          console.log('GIT_SSH_COMMAND prepared for spawn.')
        } catch (error) {
          console.error('Error handling SSH key:', error)
          // Decide how to proceed: fail, or continue without the key?
          // For now, let's log the error and proceed without the key, but return a failure later.
          // TODO: Consider returning an immediate failure status here.
          keyFilePath = null // Ensure keyFilePath is null if setup failed
          // We might want to return a failure status immediately here.
          return { overall_status: 'failure', error: `Failed to prepare SSH key: ${error.message}` }
        }
      } // --- End SSH Key Handling ---

      // ... (rest of the function: setup args, promise, spawn call using spawnEnv) ...
    }

    // ... (module.exports)
    ```
    *Self-correction: Added error handling for decryption/write and ensured failure is returned if key prep fails.*

3.  **Modify `lib/pythonWrapper.js` - `try...finally` for Cleanup:**
    -   Wrap the `spawn` call and the Promise handling logic within a `try...finally` block.
    -   In the `finally` block, check if `keyFilePath` is not null (meaning a key was successfully written).
    -   If it's not null, call `deleteTempKey({ repoName })`. This ensures the temporary key is deleted regardless of whether the Python script succeeded or failed.

    ```javascript
    // lib/pythonWrapper.js
    // ... (requires, SCRIPT_PATH)

    async function invokeAiderWrapper ({ prompt, contextFiles = [], repoConfig = null }) {
      // ... (prompt check, key handling logic from step 2) ...

      const args = [SCRIPT_PATH, '--prompt', prompt]
      if (contextFiles && contextFiles.length > 0) {
        contextFiles.forEach(file => {
          args.push('--context-file', file)
        })
      }

      let child // Define child process variable outside try
      try { // <<< Added try block
        return await new Promise((resolve, reject) => {
          console.log(`Spawning python script: ${args.join(' ')}`)
          // Use the prepared spawnEnv (might include GIT_SSH_COMMAND)
          child = spawn('python3', args, { env: spawnEnv })

          let stdoutData = ''
          let stderrData = ''

          child.stdout.on('data', (data) => {
            stdoutData += data.toString()
          })

          child.stderr.on('data', (data) => {
            stderrData += data.toString()
          })

          child.on('close', (code) => {
            console.log(`Python script exited with code ${code}`)
            if (stderrData) {
              console.error('Python script stderr:', stderrData)
            }
            if (code !== 0) {
              // Script failed (non-zero exit code)
              resolve({
                overall_status: 'failure',
                error: `Python script failed with code ${code}. Stderr: ${stderrData}`,
                stdout: stdoutData
              })
            } else {
              // Script succeeded (zero exit code)
              try {
                const result = JSON.parse(stdoutData)
                // Add stdout for debugging if needed, but it might be large
                // result.raw_stdout = stdoutData;
                resolve(result)
              } catch (parseError) {
                console.error('Failed to parse JSON from Python script:', parseError)
                console.error('Raw stdout:', stdoutData)
                resolve({
                  overall_status: 'failure',
                  error: `Failed to parse JSON output from Python script: ${parseError.message}`,
                  stdout: stdoutData // Include raw output for debugging
                })
              }
            }
          })

          child.on('error', (error) => {
            console.error('Failed to start Python script:', error)
            resolve({ // Resolve instead of reject to keep consistent return structure
              overall_status: 'failure',
              error: `Failed to start Python script: ${error.message}`
            })
          })
        })
      } finally { // <<< Added finally block
        if (keyFilePath && repoName) {
          console.log(`Cleaning up temporary SSH key for repoName: ${repoName}`)
          try {
            await deleteTempKey({ repoName })
            console.log(`Successfully deleted temporary key file: ${keyFilePath}`)
          } catch (cleanupError) {
            // Log cleanup errors but don't let them mask the main result/error
            console.error(`Error cleaning up temporary SSH key ${keyFilePath}:`, cleanupError)
          } 
        } else {
          // Optional: log if cleanup wasn't needed
          // console.log('No temporary SSH key to clean up.')
        }
      }
    }

    module.exports = {
      invokeAiderWrapper
    }
    ```
    *Self-correction: Added check for `repoName` in finally block, included error handling for `deleteTempKey`.*

4.  **Modify `events/interactionCreate.js` (@mention handler):**
    -   Find the part of the code that handles mention interactions (`message.mentions.has(client.user.id)`).
    -   Locate where `Repository.findOne` is called to fetch the repository configuration.
    -   When calling `invokeAiderWrapper`, pass the entire `repo` document found in the database as the `repoConfig` property in the options object.

    ```javascript
    // events/interactionCreate.js
    // ... (requires: client, Repository, invokeAiderWrapper etc.)

    async function handleMentionInteraction (message, client) {
      // ... (ignore bot messages, extract prompt) ...

      if (!prompt) {
        // ... (handle missing prompt) ...
        return
      }

      try {
        const repo = await Repository.findOne({ discordChannelId: message.channel.id })

        if (!repo) {
          console.log(`No repository configured for channel ${message.channel.id}`)
          await message.reply({ content: 'No repository configured for this channel. Use `/addrepo` to set one up.', ephemeral: true })
          return
        }

        console.log(`Found repository config for channel ${message.channel.id}: ${repo.repoUrl}`)

        // Show initial processing message
        const processingMessage = await message.reply('Processing your request with Aider...')

        try {
          // Pass the entire repo document as repoConfig
          const result = await invokeAiderWrapper({
            prompt,
            contextFiles: repo.contextFiles || [],
            repoConfig: repo // <<< Pass the full repo object
          })

          // ... (handle result: success, failure, no text response as before) ...

        } finally {
          // Attempt to delete the "Processing..." message
          try {
            await processingMessage.delete()
          } catch (deleteError) {
            console.error('Failed to delete processing message:', deleteError)
          }
        }
      } catch (error) {
        console.error('Error processing mention interaction:', error)
        await message.reply({ content: 'An error occurred while processing your request.', ephemeral: true })
      }
    }

    module.exports = {
      name: 'messageCreate',
      async execute (message, client) {
        if (message.author.bot) return // Ignore bot messages

        // Check if the bot was mentioned
        if (message.mentions.has(client.user.id)) {
          await handleMentionInteraction(message, client)
        }
        // ... (handle commands - this part might be in a different event handler like interactionCreate)
      }
      // Or if handling slash commands:
      // name: Events.InteractionCreate,
      // async execute(interaction) { ... find repo ... invokeAiderWrapper({ ..., repoConfig: repo }) ... }
    }
    ```
    *Note: The exact structure of your mention handler might differ (e.g., if combined with slash command handling in `InteractionCreate`). The key is to pass the found `repo` object.* Update the call site wherever `invokeAiderWrapper` is used for mentions.

5.  **Apply Linting:**
    -   Run `npx standard --fix` on the modified files.

    ```bash
    npx standard --fix lib/pythonWrapper.js events/interactionCreate.js
    ```

6.  **Testing (`test/pythonWrapper.test.js`):**
    -   **Setup:**
        -   Require necessary modules (`tape`, `proxyquire`, `sinon`, `path`, `fs/promises`, `os`).
        -   Define a dummy `ENCRYPTION_KEY` (32 chars) and create a temporary `REPO_BASE_DIR` using `mkdtemp`.
        -   Mock `lib/crypto` to control `decrypt`.
        -   Mock `lib/secureKeys` to control `writeTempKey` and `deleteTempKey`. Stub them to return expected values/resolve/reject.
        -   Mock `node:child_process` to control `spawn`. Stub the `spawn` function and its event emitters (`on('close')`, `on('error')`, `stdout.on('data')`, etc.).
        -   Use `proxyquire` to load `lib/pythonWrapper.js` with the mocks injected.
    -   **Test Case: SSH Key Used:**
        -   Create a mock `repoConfig` object containing a dummy `_id` and an `encryptedSshKey`.
        -   Stub `decrypt` to return a dummy key content.
        -   Stub `writeTempKey` to resolve with a predictable temporary key path (e.g., `/tmp/securekeys-test-XYZ/mock-repo-id/.ssh/id_rsa`).
        -   Stub `spawn` to simulate a successful exit (`on('close', (cb) => cb(0))`) and provide valid JSON output (`stdout.on('data', ...)`).
        -   Call the proxied `invokeAiderWrapper` with the mock `repoConfig`.
        -   **Assert:**
            -   `decrypt` was called with `repoConfig.encryptedSshKey`.
            -   `writeTempKey` was called with `{ repoName: repoConfig._id.toString(), keyContent: ... }`.
            -   `spawn` was called.
            -   Check the `env` option passed to `spawn`: it should contain `GIT_SSH_COMMAND` with the correct `ssh -i /path/to/temp/key ...` string, and it should also include other `process.env` variables.
            -   `deleteTempKey` was called with `{ repoName: repoConfig._id.toString() }` *after* `spawn` finished.
    -   **Test Case: SSH Key Decryption Fails:**
        -   Stub `decrypt` to return `null` or throw an error.
        -   Call `invokeAiderWrapper`.
        -   **Assert:**
            -   The function returns a failure status (`{ overall_status: 'failure', error: ... }`).
            -   `writeTempKey` was *not* called.
            -   `spawn` was *not* called.
            -   `deleteTempKey` was *not* called.
    -   **Test Case: `writeTempKey` Fails:**
        -   Stub `decrypt` to succeed.
        -   Stub `writeTempKey` to reject with an error.
        -   Call `invokeAiderWrapper`.
        -   **Assert:**
            -   The function returns a failure status.
            -   `spawn` was *not* called.
            -   `deleteTempKey` was *not* called (as no key was successfully written).
    -   **Test Case: `spawn` Fails (but key was written):**
        -   Stub `decrypt` and `writeTempKey` to succeed.
        -   Stub `spawn` to emit an error (`on('error', ...)`) or exit with a non-zero code (`on('close', (cb) => cb(1))`).
        -   Call `invokeAiderWrapper`.
        -   **Assert:**
            -   The function returns a failure status.
            -   `deleteTempKey` *was* called in the `finally` block.
    -   **Test Case: No SSH Key in Config:**
        -   Call `invokeAiderWrapper` with a `repoConfig` that has no `encryptedSshKey` property (or `repoConfig` is null).
        -   **Assert:**
            -   `decrypt` was *not* called.
            -   `writeTempKey` was *not* called.
            -   `spawn` was called with `env: process.env` (no `GIT_SSH_COMMAND`).
            -   `deleteTempKey` was *not* called.
    -   **Teardown:**
        -   Ensure mocks are restored (`sinon.restore()`).
        -   Remove the temporary `REPO_BASE_DIR` created during setup.

    *Example Test Snippet Structure (Conceptual):*
    ```javascript
    // test/pythonWrapper.test.js
    const test = require('tape')
    const proxyquire = require('proxyquire')
    const sinon = require('sinon')
    const fs = require('node:fs/promises')
    const path = require('node:path')
    const os = require('node:os')
    const { EventEmitter } = require('node:events')

    let tempRepoBaseDir
    const FAKE_ENCRYPTION_KEY = 'a'.repeat(32)
    const FAKE_REPO_ID = '605fe1f4a4f9a8a8d4aae9e0' // Example ObjectId string
    const FAKE_DECRYPTED_KEY = '-----BEGIN MOCK KEY-----'
    const FAKE_TEMP_KEY_PATH = `/tmp/fake-keys/${FAKE_REPO_ID}/.ssh/id_rsa`

    // Setup: Create temp dir, set env vars
    test('Setup PythonWrapper Tests', async (t) => {
      try {
        tempRepoBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wrapper-test-'))
        process.env.REPO_BASE_DIR = tempRepoBaseDir
        process.env.ENCRYPTION_KEY = FAKE_ENCRYPTION_KEY
        t.pass('Setup complete')
      } catch (err) {
        t.fail(`Setup failed: ${err}`)
      }
      t.end()
    })

    test('invokeAiderWrapper - SSH key success path', async (t) => {
      const mockSpawnInstance = new EventEmitter()
      mockSpawnInstance.stdout = new EventEmitter()
      mockSpawnInstance.stderr = new EventEmitter()

      const spawnStub = sinon.stub().returns(mockSpawnInstance)
      const decryptStub = sinon.stub().returns(FAKE_DECRYPTED_KEY)
      const writeTempKeyStub = sinon.stub().resolves(FAKE_TEMP_KEY_PATH)
      const deleteTempKeyStub = sinon.stub().resolves()

      const { invokeAiderWrapper } = proxyquire('../lib/pythonWrapper.js', {
        'node:child_process': { spawn: spawnStub },
        '../lib/crypto.js': { decrypt: decryptStub },
        '../lib/secureKeys.js': { writeTempKey: writeTempKeyStub, deleteTempKey: deleteTempKeyStub }
      })

      const mockRepoConfig = { _id: { toString: () => FAKE_REPO_ID }, encryptedSshKey: 'encrypted-data' }

      // Simulate successful process exit after a delay
      process.nextTick(() => {
        mockSpawnInstance.stdout.emit('data', JSON.stringify({ overall_status: 'success', events: [] }))
        mockSpawnInstance.emit('close', 0)
      })

      const result = await invokeAiderWrapper({ prompt: 'test', repoConfig: mockRepoConfig })

      t.ok(decryptStub.calledOnceWith('encrypted-data'), 'decrypt called')
      t.ok(writeTempKeyStub.calledOnceWith({ repoName: FAKE_REPO_ID, keyContent: FAKE_DECRYPTED_KEY }), 'writeTempKey called')
      t.ok(spawnStub.calledOnce, 'spawn called')

      const spawnOptions = spawnStub.firstCall.args[2]
      t.ok(spawnOptions.env, 'spawn env options exist')
      t.ok(spawnOptions.env.GIT_SSH_COMMAND.includes(`ssh -i ${FAKE_TEMP_KEY_PATH}`), 'GIT_SSH_COMMAND is set correctly')
      t.equal(spawnOptions.env.NODE_ENV, process.env.NODE_ENV, 'Other env vars are inherited') // Example check

      t.equal(result.overall_status, 'success', 'Overall status is success')
      t.ok(deleteTempKeyStub.calledOnceWith({ repoName: FAKE_REPO_ID }), 'deleteTempKey called on cleanup')

      sinon.restore()
      t.end()
    })

    // ... Add more test cases for failure paths and no-key path ...

    // Teardown: Clean up temp dir, unset env vars
    test('Teardown PythonWrapper Tests', async (t) => {
      try {
        if (tempRepoBaseDir) {
          await fs.rm(tempRepoBaseDir, { recursive: true, force: true })
        }
        delete process.env.REPO_BASE_DIR
        delete process.env.ENCRYPTION_KEY
        t.pass('Teardown complete')
      } catch (err) {
        t.fail(`Teardown failed: ${err}`)
      }
      t.end()
    })
    ```

7.  **Run Tests:**
    -   Execute `npm test` and verify all tests, including the updated `pythonWrapper.test.js`, pass.

    ```bash
    npm test
    ```

This completes the integration of temporary SSH key handling into the Python wrapper invocation process. 