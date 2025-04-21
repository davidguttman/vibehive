# Tutorial 21: Execute Wrapper with Sudo and Adjust Key Permissions

**Goal:** Modify the Python wrapper invocation to use `sudo` to run as the assigned `coderX` user, set the correct working directory for the wrapper process, and update the secure key handling to set correct file ownership and permissions using `sudo`.

**Recap:**
- We can now assign a specific `coderX` user ID to each repository (`assignedUserId`).
- The `appuser` (running the Node.js bot) needs to invoke the Python wrapper script (`aider_wrapper.py`) *as* the assigned `coderX` user.
- The SSH key needs to be owned by the `coderX` user and have strict permissions (600) to be accepted by Git.
- The Python wrapper needs to run within the repository's directory.

**Requirements from `docs/prompts/21.md`:**

1.  **Modify `lib/secureKeys.js`:**
    *   Update function signatures to include `ownerUserId`.
    *   After writing the temporary key file, use `sudo` with `child_process` to change the file's owner and permissions to the specified `ownerUserId`.
2.  **Modify `lib/pythonWrapper.js`:**
    *   Retrieve the `assignedUserId` from the repository configuration.
    *   Construct the full path to the repository checkout directory.
    *   Pass the `assignedUserId` as `ownerUserId` when writing the temporary key.
    *   Update the `spawn` call to use `sudo -u <assignedUserId>` to execute the Python wrapper.
    *   Set the `cwd` (current working directory) option in `spawn` to the repository path.
3.  **Update Tests:**
    *   Adjust tests for `secureKeys.js` to include `ownerUserId` and mock/verify the `sudo` calls for `chown` and `chmod`.
    *   Adjust tests for `pythonWrapper.js` to provide a mock `repoConfig` with `assignedUserId`, verify `writeTempKey` receives the correct ID, and mock/verify the `spawn` call uses `sudo` with the correct user and `cwd`.

---

## Step 1: Update `lib/secureKeys.js`

We need to pass the intended owner's user ID (`ownerUserId`) to `writeTempKey` and `deleteTempKey`. In `writeTempKey`, after creating the key file, we'll use `sudo` to set the correct ownership and permissions.

**1.1: Modify Signatures and Add `child_process`**

Require `execFileSync` from `child_process` and update the function signatures.

```diff
--- a/lib/secureKeys.js
+++ b/lib/secureKeys.js
@@ -1,6 +1,7 @@
 const fs = require('fs')
 const path = require('path')
 const os = require('os')
+const { execFileSync } = require('child_process')
 const log = require('./log')
 
 // Base directory for storing temporary keys
@@ -10,7 +11,7 @@
  * Writes a temporary SSH key file.
  * @param {object} options - The options object.
  * @param {string} options.repoName - The name of the repository (used for subdirectory).
- * @param {string} options.keyContent - The content of the SSH key.
+ * @param {string} options.keyContent - The content of the SSH key. * @param {string} options.ownerUserId - The system user ID that should own the key file.
  * @returns {string} The path to the temporary key file.
  * @throws {Error} If the directory cannot be created or the file cannot be written.
  */
@@ -35,14 +36,17 @@
  * Writes a temporary SSH key file.
  * @param {object} options - The options object.
  * @param {string} options.repoName - The name of the repository (used for subdirectory).
- * @param {string} options.keyContent - The content of the SSH key.
+ * @param {string} options.keyContent - The content of the SSH key.
+ * @param {string} options.ownerUserId - The system user ID that should own the key file.
  * @returns {string} The path to the temporary key file.
  * @throws {Error} If the directory cannot be created or the file cannot be written.
  */
-const writeTempKey = ({ repoName, keyContent }) => {
+const writeTempKey = ({ repoName, keyContent, ownerUserId }) => {
   if (!repoName || !keyContent) {
     throw new Error('repoName and keyContent are required for writeTempKey')
   }
+  if (!ownerUserId) throw new Error('ownerUserId is required for writeTempKey')
+
   const repoKeyDir = path.join(keysBaseDir, repoName)
   try {
     // Ensure the subdirectory exists with appropriate permissions for appuser initially
@@ -57,6 +61,21 @@
     // Write the key file with strict permissions (only owner can read/write)
     fs.writeFileSync(targetFilePath, keyContent, { mode: 0o600 })
     log.info(`Temporary key written to ${targetFilePath} with mode 600`)
+
+    // Change ownership and permissions using sudo
+    try {
+      log.info(`Attempting to chown ${targetFilePath} to ${ownerUserId}`)
+      execFileSync('sudo', ['-u', ownerUserId, 'chown', `${ownerUserId}:${ownerUserId}`, targetFilePath])
+      log.info(`Successfully chowned ${targetFilePath} to ${ownerUserId}`)
+
+      // Re-apply chmod just in case, though chown might preserve it depending on sudo setup
+      log.info(`Attempting to chmod 600 ${targetFilePath} as ${ownerUserId}`)
+      execFileSync('sudo', ['-u', ownerUserId, 'chmod', '600', targetFilePath])
+      log.info(`Successfully chmod 600 ${targetFilePath}`)
+    } catch (error) {
+      log.error(`Error setting ownership/permissions for ${targetFilePath} via sudo: ${error.message}`)
+      throw new Error(`Failed to set ownership/permissions via sudo: ${error.message}`) // Re-throw to signal failure
+    }
+
     return targetFilePath
   } catch (error) {
     log.error(`Failed to write temporary key to ${targetFilePath}: ${error.message}`)
@@ -69,11 +88,13 @@
  * Deletes a temporary SSH key file and its directory if empty.
  * @param {object} options - The options object.
  * @param {string} options.repoName - The name of the repository.
+ * @param {string} options.ownerUserId - The system user ID (needed if appuser lacks direct delete permissions).
  * @returns {void}
  */
-const deleteTempKey = ({ repoName }) => {
+const deleteTempKey = ({ repoName, ownerUserId }) => {
   if (!repoName) {
     log.warn('repoName is required for deleteTempKey, skipping deletion.')
+    // Note: ownerUserId might not be strictly necessary if appuser has sudo rm rights,
     // but we include it for consistency and potential future permission models.
     return
   }

```

**1.2: Explanation**

*   We added `ownerUserId` to the parameters of `writeTempKey` and `deleteTempKey`.
*   Inside `writeTempKey`, after `fs.writeFileSync`, we use `execFileSync` to run two `sudo` commands:
    *   `sudo -u <ownerUserId> chown <ownerUserId>:<ownerUserId> <keyFilePath>`: Changes the owner and group of the key file to the `ownerUserId`.
    *   `sudo -u <ownerUserId> chmod 600 <keyFilePath>`: Ensures the file permissions are strictly 600 (read/write for owner only). This might be slightly redundant if `chown` preserves the mode set by `writeFileSync`, but it guarantees the correct state.
*   We wrap the `sudo` calls in a `try...catch` block to handle potential errors (e.g., `appuser` not having the necessary `sudo` permissions configured).
*   The `deleteTempKey` signature is updated, but the implementation doesn't strictly need `ownerUserId` yet if `appuser` can delete the file directly or via `sudo rm -f`. We add it for future-proofing and consistency. For now, deletion relies on `appuser`'s permissions. A `sudo rm` could be added similarly if needed.

---

## Step 2: Update `lib/pythonWrapper.js`

Now, modify `invokeAiderWrapper` to get the `assignedUserId`, calculate the repository path, pass the user ID to `writeTempKey`, and execute the Python script using `sudo` within the correct `cwd`.

```diff
--- a/lib/pythonWrapper.js
+++ b/lib/pythonWrapper.js
@@ -1,10 +1,14 @@
 const { spawn } = require('child_process')
 const path = require('path')
 const log = require('./log')
-const { writeTempKey, deleteTempKey } = require('./secureKeys')
+const { writeTempKey, deleteTempKey, keysBaseDir } = require('./secureKeys') // Import keysBaseDir
 const { decrypt } = require('./encryption') // Assuming encryption is set up
 
 const PYTHON_WRAPPER_SCRIPT = '/app/aider_wrapper.py' // Path inside the container
+// Base directory where repositories will be checked out/cloned
+// This should ideally come from config, but we'll define it here for now
+// It MUST match the structure expected by the user setup/volume mounts
+const REPOS_BASE_DIR = '/app/repos'
 
 /**
  * Invokes the Python aider wrapper script.
@@ -15,15 +19,25 @@
  * @returns {Promise<string>} A promise that resolves with the combined stdout and stderr of the script.
  */
 const invokeAiderWrapper = async ({ repoConfig, prompt, contextFiles = [] }) => {
-  // Validate required parameters
-  if (!repoConfig || !repoConfig.repoName || !prompt) {
+  if (!repoConfig || !repoConfig.repoName || !repoConfig.sshPrivateKey || !repoConfig.assignedUserId || !prompt) {
     log.error('invokeAiderWrapper called with missing parameters.', { repoName: repoConfig?.repoName, prompt: !!prompt, sshPrivateKey: !!repoConfig?.sshPrivateKey, assignedUserId: !!repoConfig?.assignedUserId })
     throw new Error('Missing required parameters: repoConfig (with repoName, sshPrivateKey, assignedUserId) and prompt')
   }
 
   const { repoName, sshPrivateKey: encryptedKey, assignedUserId } = repoConfig
+  const repoPath = path.join(REPOS_BASE_DIR, repoName) // Construct path to repo checkout
   let tempKeyPath = null
   let decryptedKey = null
+
+  // Log parameters for debugging (avoid logging the key itself in production)
+  log.info('Invoking Aider Wrapper', {
+    repoName,
+    promptLength: prompt.length,
+    contextFileCount: contextFiles.length,
+    assignedUserId,
+    repoPath,
+    wrapperScript: PYTHON_WRAPPER_SCRIPT
+  })
 
   try {
     // 1. Decrypt the SSH key
@@ -33,7 +47,7 @@
 
     // 2. Write the decrypted key to a temporary, secure file owned by assignedUserId
     log.info(`Writing temporary key for repo ${repoName} owned by ${assignedUserId}`)
-    tempKeyPath = writeTempKey({ repoName, keyContent: decryptedKey })
+    tempKeyPath = writeTempKey({ repoName, keyContent: decryptedKey, ownerUserId: assignedUserId })
 
     // 3. Prepare the GIT_SSH_COMMAND environment variable
     const gitSshCommand = `ssh -i ${tempKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`
@@ -46,13 +60,22 @@
     }
 
     // 4. Prepare arguments for the Python script
-    const args = [PYTHON_WRAPPER_SCRIPT, '--prompt', prompt]
+    const pythonCommand = 'python3' // Or just 'python' depending on container setup
+    const scriptArgs = [PYTHON_WRAPPER_SCRIPT, '--prompt', prompt]
     if (contextFiles.length > 0) {
-      args.push('--context-files', ...contextFiles)
+      scriptArgs.push('--context-files', ...contextFiles)
     }
 
-    // 5. Spawn the Python process
-    log.info(`Spawning Python wrapper: ${PYTHON_WRAPPER_SCRIPT} with prompt and ${contextFiles.length} context files`)
+    // 5. Prepare sudo command and arguments
+    const sudoCommand = 'sudo'
+    const sudoArgs = ['-u', assignedUserId, pythonCommand, ...scriptArgs]
+
+    log.info('Executing command with sudo:', {
+      command: sudoCommand,
+      args: sudoArgs, // Be careful logging args if they contain sensitive info
+      cwd: repoPath,
+      env: { GIT_SSH_COMMAND: '***' } // Mask sensitive env var
+    })
 
     return new Promise((resolve, reject) => {
       let stdout = ''
@@ -60,14 +83,21 @@
 
       // Pass the GIT_SSH_COMMAND via environment variables
       // Use Buffer.from to handle potentially large prompts/outputs safely
-      const pythonProcess = spawn(PYTHON_WRAPPER_SCRIPT, args, {
+      const pythonProcess = spawn(sudoCommand, sudoArgs, {
         env: processEnv,
+        cwd: repoPath, // <--- Set the working directory
         stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr
       })
 
-      // Handle potential errors during spawn itself
+      // Handle potential errors during spawn
       pythonProcess.on('error', (err) => {
         log.error(`Failed to start Python wrapper script: ${err.message}`)
+        // Clean up the key if spawn failed
+        if (tempKeyPath) {
+          try {
+            deleteTempKey({ repoName, ownerUserId: assignedUserId }) // Pass ownerUserId for potential future sudo rm
+          } catch (cleanupErr) { log.error(`Error cleaning up key after spawn failure: ${cleanupErr.message}`) }
+        }
         reject(new Error(`Failed to start Python script: ${err.message}`))
       })
 
@@ -91,13 +121,21 @@
         // Ensure the key is deleted even if the script fails after starting
         if (tempKeyPath) {
           try {
-            deleteTempKey({ repoName })
+            deleteTempKey({ repoName, ownerUserId: assignedUserId })
           } catch (cleanupErr) { log.error(`Error cleaning up key after script error: ${cleanupErr.message}`) }
         }
         reject(new Error(`Python script exited with code ${code}: ${stderr}`))
       })
     })
   } catch (error) {
+    log.error(`Error during invokeAiderWrapper execution: ${error.message}`, { repoName, assignedUserId })
+    // Ensure key is deleted on general errors as well
+    if (tempKeyPath) {
+      try {
+        deleteTempKey({ repoName, ownerUserId: assignedUserId })
+      } catch (cleanupErr) { log.error(`Error cleaning up key after general error: ${cleanupErr.message}`) }
+    }
+    // Re-throw the original error
     throw error
   } finally {
     // Double-check deletion in a finally block for robustness,
@@ -105,7 +143,7 @@
     // already been deleted in an error handler.
     if (tempKeyPath) {
       try {
-        deleteTempKey({ repoName })
+        deleteTempKey({ repoName, ownerUserId: assignedUserId })
       } catch (cleanupErr) {
         // Log error during final cleanup, but don't mask the original error (if any)
         log.error(`Error during final key cleanup: ${cleanupErr.message}`)
@@ -115,4 +153,4 @@
   }
 }
 
-module.exports = { invokeAiderWrapper }
+module.exports = { invokeAiderWrapper, REPOS_BASE_DIR } // Export REPOS_BASE_DIR if needed elsewhere

```

**2.1: Explanation**

*   We import `keysBaseDir` from `secureKeys` (though not strictly used here yet) and define `REPOS_BASE_DIR`. This should ideally be configurable, but `/app/repos` matches common Docker volume patterns.
*   We add `assignedUserId` to the required parameters validation.
*   We construct `repoPath` using `path.join(REPOS_BASE_DIR, repoName)`. **Crucially, Step 22 (not part of this tutorial) will be responsible for ensuring this directory actually exists before the wrapper is called.**
*   When calling `writeTempKey`, we now pass `ownerUserId: assignedUserId`.
*   The `spawn` call is significantly changed:
    *   The command is now `'sudo'`.
    *   The arguments array starts with `['-u', assignedUserId, 'python3', PYTHON_WRAPPER_SCRIPT, ...]`. This tells `sudo` to run the `python3` command *as* the `assignedUserId`.
    *   We add the `cwd: repoPath` option to the `spawn` options object. This makes the Python script execute with the repository directory as its current working directory, essential for Git operations.
    *   The `env` option containing `GIT_SSH_COMMAND` is kept as before.
*   Logging is updated to show the `assignedUserId`, `repoPath`, and the `sudo` command structure.
*   Error handling and cleanup (`deleteTempKey`) are updated to pass `ownerUserId` as well, anticipating potential future needs for `sudo rm`.

---

## Step 3: Update `test/secureKeys.test.js`

We need to mock `child_process.execFileSync` and verify it's called correctly after `fs.writeFileSync`.

```diff
--- a/test/secureKeys.test.js
+++ b/test/secureKeys.test.js
@@ -1,11 +1,13 @@
 const test = require('tape')
 const fs = require('fs')
 const path = require('path')
+const childProcess = require('child_process') // Import full module
 const os = require('os')
 const sinon = require('sinon')
 const proxyquire = require('proxyquire')
 
 // Mock dependencies
+const execFileSyncStub = sinon.stub()
 const writeFileSyncStub = sinon.stub()
 const unlinkSyncStub = sinon.stub()
 const rmdirSyncStub = sinon.stub()
@@ -18,6 +20,7 @@
   'fs': {
     writeFileSync: writeFileSyncStub,
     unlinkSync: unlinkSyncStub,
+    // No need to stub mkdirSync if existsSync returns true or we let it run
     existsSync: existsSyncStub,
     mkdtempSync: mkdtempSyncStub,
     rmdirSync: rmdirSyncStub,
@@ -27,6 +30,9 @@
   },
   './log': {
     info: sinon.stub(),
+    warn: sinon.stub(),
+    error: sinon.stub()
+  },
+  'child_process': {
+    execFileSync: execFileSyncStub
   }
 })
 
@@ -35,12 +41,14 @@
 // Resolve the expected base directory using mkdtemp behavior if needed, or define expected
 const expectedBaseDir = path.join(os.tmpdir(), 'vibehive-keys-') // Base pattern
 let actualBaseDir // To be set by mkdtempSync stub
+const mockOwnerUserId = 'testuser123'
 
 test('Setup secureKeys mocks', (t) => {
   // Reset stubs before each test group related to secureKeys
   writeFileSyncStub.reset()
   unlinkSyncStub.reset()
   rmdirSyncStub.reset()
+  execFileSyncStub.reset()
   existsSyncStub.reset()
   mkdtempSyncStub.reset() // Reset this too
   existsSyncStub.returns(true) // Assume base dir exists for simplicity in most tests
@@ -53,18 +61,24 @@
   t.end()
 })
 
-test('secureKeys.writeTempKey - success', (t) => {
+test('secureKeys.writeTempKey - success with sudo calls', (t) => {
   const repoName = 'test-repo'
   const keyContent = 'ssh-rsa AAA...'
   const expectedDir = path.join(actualBaseDir, repoName)
   const expectedPath = path.join(expectedDir, 'id_rsa_temp')
 
-  const result = secureKeys.writeTempKey({ repoName, keyContent })
+  const result = secureKeys.writeTempKey({ repoName, keyContent, ownerUserId: mockOwnerUserId })
 
   t.equal(result, expectedPath, 'should return the correct key path')
   t.ok(mkdirSyncStub.calledWith(expectedDir, { recursive: true, mode: 0o700 }), 'should create repo-specific directory with correct permissions')
   t.ok(writeFileSyncStub.calledOnceWith(expectedPath, keyContent, { mode: 0o600 }), 'should write the key file with correct content and mode 600')
+
+  // Verify sudo calls
+  t.equal(execFileSyncStub.callCount, 2, 'should call execFileSync twice for sudo')
+  t.ok(execFileSyncStub.calledWith('sudo', ['-u', mockOwnerUserId, 'chown', `${mockOwnerUserId}:${mockOwnerUserId}`, expectedPath]), 'should call sudo chown correctly')
+  t.ok(execFileSyncStub.calledWith('sudo', ['-u', mockOwnerUserId, 'chmod', '600', expectedPath]), 'should call sudo chmod correctly')
+
   t.end()
 })
 
@@ -73,7 +87,9 @@
   const keyContent = 'ssh-rsa AAA...'
   existsSyncStub.withArgs(actualBaseDir).returns(false) // Simulate base dir not existing
 
-  secureKeys.writeTempKey({ repoName, keyContent })
+  // We need ownerUserId now
+  secureKeys.writeTempKey({ repoName, keyContent, ownerUserId: mockOwnerUserId })
+
   t.ok(mkdirSyncStub.calledWith(actualBaseDir, { recursive: true, mode: 0o700 }), 'should create base directory if it does not exist')
   // Reset stub for next tests
   existsSyncStub.withArgs(actualBaseDir).returns(true)
@@ -84,15 +100,31 @@
   const repoName = 'write-fail-repo'
   const keyContent = 'key'
   const error = new Error('Disk full')
-  writeFileSyncStub.throws(error)
+  // Make the first sudo call fail
+  execFileSyncStub.withArgs('sudo', sinon.match.array.startsWith(['-u', mockOwnerUserId, 'chown'])).throws(error)
 
   t.throws(
-    () => secureKeys.writeTempKey({ repoName, keyContent }),
-    /Failed to write temporary key.*Disk full/,
-    'should throw error if writeFileSync fails'
+    () => secureKeys.writeTempKey({ repoName, keyContent, ownerUserId: mockOwnerUserId }),
+    /Failed to set ownership\/permissions via sudo: Disk full/,
+    'should throw error if sudo chown fails'
   )
 
-  writeFileSyncStub.resetBehavior() // Reset throw behavior
+  execFileSyncStub.resetBehavior() // Reset throw behavior for other tests
+  t.end()
+})
+
+test('secureKeys.writeTempKey - failure (chmod fails)', (t) => {
+  const repoName = 'chmod-fail-repo'
+  const keyContent = 'key'
+  const error = new Error('Permission denied')
+  // Make the second sudo call fail
+  execFileSyncStub.withArgs('sudo', sinon.match.array.startsWith(['-u', mockOwnerUserId, 'chmod'])).throws(error)
+
+  t.throws(
+    () => secureKeys.writeTempKey({ repoName, keyContent, ownerUserId: mockOwnerUserId }),
+    /Failed to set ownership\/permissions via sudo: Permission denied/,
+    'should throw error if sudo chmod fails'
+  )
   t.end()
 })
 
@@ -103,10 +135,11 @@
   const expectedDir = path.join(actualBaseDir, repoName)
   const expectedPath = path.join(expectedDir, 'id_rsa_temp')
 
-  secureKeys.deleteTempKey({ repoName })
+  // Pass ownerUserId, though it's not used for deletion logic *yet*
+  secureKeys.deleteTempKey({ repoName, ownerUserId: mockOwnerUserId })
 
-  t.ok(unlinkSyncStub.calledOnceWith(expectedPath), 'should delete the key file')
-  t.ok(rmdirSyncStub.calledOnceWith(expectedDir), 'should remove the repo directory')
+  t.ok(unlinkSyncStub.calledOnceWith(expectedPath), 'should attempt to delete the key file')
+  t.ok(rmdirSyncStub.calledOnceWith(expectedDir), 'should attempt to remove the repo directory')
   t.end()
 })
 
@@ -114,7 +147,7 @@
   const repoName = 'delete-fail-repo'
   const error = new Error('Permission denied')
   unlinkSyncStub.throws(error)
-  const expectedPath = path.join(actualBaseDir, repoName, 'id_rsa_temp')
+  // const expectedPath = path.join(actualBaseDir, repoName, 'id_rsa_temp') // Path not needed for throw check
 
   t.throws(
     () => secureKeys.deleteTempKey({ repoName }),
@@ -122,6 +155,13 @@
     'should throw error if unlinkSync fails'
   )
 
+  // Check that rmdir was not called if unlink failed
+  t.notOk(rmdirSyncStub.called, 'should not attempt to remove directory if file deletion failed')
+
   unlinkSyncStub.resetBehavior()
   t.end()
 })
+
+// Add more tests? e.g., deleteTempKey when repoName is missing
+// test('secureKeys.deleteTempKey - missing repoName', ...)
+
```

**3.1: Explanation**

*   We import the `child_process` module and create a stub `execFileSyncStub`.
*   We mock `child_process` in `proxyquire` to use our stub.
*   A `mockOwnerUserId` is defined for use in tests.
*   The stubs (including `execFileSyncStub`) are reset before tests.
*   In the `writeTempKey - success` test:
    *   We call `writeTempKey` with the `ownerUserId`.
    *   We add assertions using `execFileSyncStub.calledWith` to verify that `sudo chown` and `sudo chmod` were called with the correct arguments (`sudo`, `-u`, `mockOwnerUserId`, command, owner:owner or mode, path).
*   Error tests are updated: We now simulate failures in the `sudo` calls (`execFileSyncStub.throws(...)`) and check for the corresponding error messages.
*   The `deleteTempKey` tests are updated to pass `ownerUserId`, although the deletion logic itself doesn't use it yet. Assertions check that `unlinkSync` and `rmdirSync` are still *attempted*.

---

## Step 4: Update `test/pythonWrapper.test.js`

Here, we need to provide a mock `repoConfig` including `assignedUserId`, verify `writeTempKey` gets called correctly, and mock `child_process.spawn` to assert the `sudo` command, arguments, and `cwd` option.

```diff
--- a/test/pythonWrapper.test.js
+++ b/test/pythonWrapper.test.js
@@ -1,5 +1,6 @@
 const test = require('tape')
 const sinon = require('sinon')
+const path = require('path')
 const proxyquire = require('proxyquire').noCallThru()
 const { EventEmitter } = require('events')
 
@@ -7,6 +8,7 @@
 const decryptStub = sinon.stub()
 const writeTempKeyStub = sinon.stub()
 const deleteTempKeyStub = sinon.stub()
+const keysBaseDirStub = '/tmp/fake-keys-dir' // Mock base dir if needed by tests
 const logStub = {
   info: sinon.stub(),
   error: sinon.stub(),
@@ -21,10 +23,12 @@
   './encryption': { decrypt: decryptStub },
   './secureKeys': {
     writeTempKey: writeTempKeyStub,
-    deleteTempKey: deleteTempKeyStub
+    deleteTempKey: deleteTempKeyStub,
+    keysBaseDir: keysBaseDirStub // Provide the stubbed base dir
   },
   './log': logStub,
   'child_process': { spawn: spawnStub }
+
 })
 
 // Reset mocks before each test
@@ -35,6 +39,7 @@
   deleteTempKeyStub.reset()
   logStub.info.reset()
   logStub.error.reset()
+  logStub.warn.reset()
 
   // Reset spawn behavior
   mockChildProcess = new EventEmitter()
@@ -46,10 +51,15 @@
   spawnStub.returns(mockChildProcess)
 })
 
-const MOCK_REPO_CONFIG = {
+const MOCK_REPO_CONFIG_BASE = {
   repoName: 'test-owner/test-repo',
   sshPrivateKey: 'encrypted-key-data', // Encrypted
+  // assignedUserId will be added per test or group
+}
+const MOCK_ASSIGNED_USER_ID = 'coderxyz'
+const MOCK_REPO_CONFIG_WITH_USER = {
+  ...MOCK_REPO_CONFIG_BASE,
+  assignedUserId: MOCK_ASSIGNED_USER_ID
 }
 const MOCK_DECRYPTED_KEY = '-----BEGIN RSA PRIVATE KEY-----\n MOCK KEY \n-----END RSA PRIVATE KEY-----'
 const MOCK_PROMPT = 'Implement feature X'
@@ -58,44 +68,82 @@
 const MOCK_TEMP_KEY_PATH = '/tmp/fake-keys-dir/test-owner/test-repo/id_rsa_temp'
 const PYTHON_WRAPPER_SCRIPT = '/app/aider_wrapper.py'
 const MOCK_CONTEXT_FILES = ['src/main.js', 'README.md']
+const REPOS_BASE_DIR = '/app/repos' // Must match the one in pythonWrapper.js
+const EXPECTED_REPO_PATH = path.join(REPOS_BASE_DIR, MOCK_REPO_CONFIG_WITH_USER.repoName)
 
 test('pythonWrapper.invokeAiderWrapper - success', async (t) => {
-  decryptStub.withArgs(MOCK_REPO_CONFIG.sshPrivateKey).resolves(MOCK_DECRYPTED_KEY)
+  decryptStub.withArgs(MOCK_REPO_CONFIG_WITH_USER.sshPrivateKey).resolves(MOCK_DECRYPTED_KEY)
   writeTempKeyStub.resolves(MOCK_TEMP_KEY_PATH)
 
-  const promise = pythonWrapper.invokeAiderWrapper({ repoConfig: MOCK_REPO_CONFIG, prompt: MOCK_PROMPT })
+  const promise = pythonWrapper.invokeAiderWrapper({ repoConfig: MOCK_REPO_CONFIG_WITH_USER, prompt: MOCK_PROMPT })
 
   // Simulate successful process exit
   mockChildProcess.emit('close', 0) // Use close event, exit might not fire if stdio kept open
 
   const result = await promise
   t.equal(result, '', 'should resolve with empty string on success (no output captured yet)')
 
+  // Verify decryption and key writing
   t.ok(decryptStub.calledOnceWith(MOCK_REPO_CONFIG_WITH_USER.sshPrivateKey), 'should decrypt the key')
-  t.ok(writeTempKeyStub.calledOnceWith({
+  t.ok(writeTempKeyStub.calledOnceWithExactly({
     repoName: MOCK_REPO_CONFIG_WITH_USER.repoName,
-    keyContent: MOCK_DECRYPTED_KEY
-  }), 'should write the decrypted key')
+    keyContent: MOCK_DECRYPTED_KEY,
+    ownerUserId: MOCK_ASSIGNED_USER_ID // <-- Verify ownerUserId
+  }), 'should write the decrypted key with correct ownerUserId')
+
+  // Verify spawn call
+  t.ok(spawnStub.calledOnce, 'should spawn a process')
+  const spawnArgs = spawnStub.firstCall.args
+  t.equal(spawnArgs[0], 'sudo', 'should call sudo')
+  t.deepEqual(spawnArgs[1], [
+    '-u', MOCK_ASSIGNED_USER_ID, // <-- Verify user flag
+    'python3', // Assuming python3 is the command
+    PYTHON_WRAPPER_SCRIPT,
+    '--prompt', MOCK_PROMPT
+    // No context files in this test case yet
+  ], 'should call python script with correct args via sudo')
+
+  // Verify spawn options (env and cwd)
+  const expectedEnv = {
+    ...process.env, // Inherits environment
+    GIT_SSH_COMMAND: `ssh -i ${MOCK_TEMP_KEY_PATH} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`
+  }
+  const spawnOptions = spawnArgs[2]
+  t.deepEqual(spawnOptions.env, expectedEnv, 'should set GIT_SSH_COMMAND in env')
+  t.equal(spawnOptions.cwd, EXPECTED_REPO_PATH, 'should set cwd to the repository path') // <-- Verify cwd
+  t.deepEqual(spawnOptions.stdio, ['pipe', 'pipe', 'pipe'], 'should set stdio correctly')
 
   // Verify cleanup
-  t.ok(deleteTempKeyStub.calledOnceWith({ repoName: MOCK_REPO_CONFIG.repoName }), 'should delete the temporary key on success')
+  t.ok(deleteTempKeyStub.calledOnceWithExactly({
+    repoName: MOCK_REPO_CONFIG_WITH_USER.repoName,
+    ownerUserId: MOCK_ASSIGNED_USER_ID // <-- Verify ownerUserId on delete too
+  }), 'should delete the temporary key on success')
+
   t.end()
 })
 
 test('pythonWrapper.invokeAiderWrapper - success with context files', async (t) => {
-  decryptStub.withArgs(MOCK_REPO_CONFIG.sshPrivateKey).resolves(MOCK_DECRYPTED_KEY)
+  decryptStub.withArgs(MOCK_REPO_CONFIG_WITH_USER.sshPrivateKey).resolves(MOCK_DECRYPTED_KEY)
   writeTempKeyStub.resolves(MOCK_TEMP_KEY_PATH)
 
   const promise = pythonWrapper.invokeAiderWrapper({
-    repoConfig: MOCK_REPO_CONFIG,
+    repoConfig: MOCK_REPO_CONFIG_WITH_USER,
     prompt: MOCK_PROMPT,
     contextFiles: MOCK_CONTEXT_FILES
   })
 
   mockChildProcess.emit('close', 0)
   await promise
+
+  // Verify spawn arguments include context files
+  t.ok(spawnStub.calledOnce, 'should spawn a process')
+  const spawnArgs = spawnStub.firstCall.args[1] // Get the arguments array
+  t.deepEqual(spawnArgs.slice(4), [ // Check args after python script path
+    '--prompt', MOCK_PROMPT,
+    '--context-files', ...MOCK_CONTEXT_FILES // Verify context files are included
+  ], 'should include context files in arguments')
+
   t.end()
 })
 
@@ -110,16 +158,21 @@
   mockChildProcess.stderr.emit('data', Buffer.from(MOCK_STDERR))
   mockChildProcess.emit('close', 1) // Simulate error exit code
 
-  await t.rejects(
-    pythonWrapper.invokeAiderWrapper({ repoConfig: MOCK_REPO_CONFIG, prompt: MOCK_PROMPT }),
-    new RegExp(`Python script exited with code 1: ${MOCK_STDERR}`), // Use RegExp to match error message
-    'should reject with stderr message on non-zero exit code'
-  )
+  try {
+    await pythonWrapper.invokeAiderWrapper({ repoConfig: MOCK_REPO_CONFIG_WITH_USER, prompt: MOCK_PROMPT })
+    t.fail('Should have rejected')
+  } catch (error) {
+    t.match(error.message, /Python script exited with code 1: .*mock stderr output/s, 'should reject with stderr message on non-zero exit code')
+  }
 
   // Verify cleanup attempted even on error
-  t.ok(deleteTempKeyStub.calledOnceWith({ repoName: MOCK_REPO_CONFIG.repoName }), 'should attempt delete the temporary key on error')
+  t.ok(deleteTempKeyStub.calledOnceWithExactly({
+    repoName: MOCK_REPO_CONFIG_WITH_USER.repoName,
+    ownerUserId: MOCK_ASSIGNED_USER_ID
+  }), 'should attempt delete the temporary key on error')
   t.end()
 })
+
 
 test('pythonWrapper.invokeAiderWrapper - spawn error', async (t) => {
   const spawnError = new Error('Spawn ENOENT')
@@ -127,16 +180,23 @@
   decryptStub.withArgs(MOCK_REPO_CONFIG_WITH_USER.sshPrivateKey).resolves(MOCK_DECRYPTED_KEY)
   writeTempKeyStub.resolves(MOCK_TEMP_KEY_PATH)
 
-  // Simulate spawn error *before* process starts
   mockChildProcess.emit('error', spawnError) // Emit error event directly
 
-  await t.rejects(
-    pythonWrapper.invokeAiderWrapper({ repoConfig: MOCK_REPO_CONFIG_WITH_USER, prompt: MOCK_PROMPT }),
-    /Failed to start Python script: Spawn ENOENT/,
-    'should reject if spawn itself fails'
-  )
-
-  // Verify cleanup attempted even on spawn error
+  try {
+    await pythonWrapper.invokeAiderWrapper({ repoConfig: MOCK_REPO_CONFIG_WITH_USER, prompt: MOCK_PROMPT })
+    t.fail('Should have rejected')
+  } catch (error) {
+    t.match(error.message, /Failed to start Python script: Spawn ENOENT/, 'should reject if spawn itself fails')
+  }
+
+  // Verify cleanup attempted after spawn error
+  t.ok(deleteTempKeyStub.calledOnceWithExactly({
+    repoName: MOCK_REPO_CONFIG_WITH_USER.repoName,
+    ownerUserId: MOCK_ASSIGNED_USER_ID
+  }), 'should attempt delete the temporary key on spawn error')
+
+  // Spawn error happens before close, so 'close' cleanup shouldn't run again
+  t.equal(deleteTempKeyStub.callCount, 1, 'deleteTempKey should only be called once on spawn error')
   t.end()
 })
 
@@ -145,17 +205,39 @@
   writeTempKeyStub.throws(keyWriteError)
   decryptStub.withArgs(MOCK_REPO_CONFIG_WITH_USER.sshPrivateKey).resolves(MOCK_DECRYPTED_KEY)
 
-  await t.rejects(
-    pythonWrapper.invokeAiderWrapper({ repoConfig: MOCK_REPO_CONFIG_WITH_USER, prompt: MOCK_PROMPT }),
-    keyWriteError, // Should reject with the original error from writeTempKey
-    'should reject if writeTempKey fails'
-  )
+  try {
+    await pythonWrapper.invokeAiderWrapper({ repoConfig: MOCK_REPO_CONFIG_WITH_USER, prompt: MOCK_PROMPT })
+    t.fail('Should have rejected')
+  } catch (error) {
+    t.equal(error, keyWriteError, 'should reject with the original error from writeTempKey')
+  }
 
   t.notOk(spawnStub.called, 'should not call spawn if writing key fails')
-  t.notOk(deleteTempKeyStub.called, 'should not call deleteTempKey if write never succeeded') // writeTempKey handles its own cleanup internally if needed
+  // writeTempKey might attempt internal cleanup, but invokeAiderWrapper's cleanup shouldn't run
+  t.notOk(deleteTempKeyStub.called, 'invokeAiderWrapper should not call deleteTempKey if write never succeeded')
+  t.end()
+})
+
+test('pythonWrapper.invokeAiderWrapper - missing parameters', async (t) => {
+  await t.rejects(
+    pythonWrapper.invokeAiderWrapper({ repoConfig: { repoName: 'foo' }, prompt: MOCK_PROMPT }), // Missing sshPrivateKey, assignedUserId
+    /Missing required parameters/,
+    'should reject if repoConfig is missing fields'
+  )
+  await t.rejects(
+    pythonWrapper.invokeAiderWrapper({ repoConfig: MOCK_REPO_CONFIG_WITH_USER }), // Missing prompt
+    /Missing required parameters/,
+    'should reject if prompt is missing'
+  )
+  await t.rejects(
+    pythonWrapper.invokeAiderWrapper({ prompt: MOCK_PROMPT }), // Missing repoConfig
+    /Missing required parameters/,
+    'should reject if repoConfig is missing'
+  )
   t.end()
 })
 
+
 // TODO: Add test case for decryption failure?
 // test('pythonWrapper.invokeAiderWrapper - decryption failure', async (t) => { ... })
 

```

**4.1: Explanation**

*   We import `path` to construct the expected `cwd`.
*   A mock `keysBaseDirStub` is provided via `proxyquire` for consistency, although not strictly used in these assertions.
*   We define a base `MOCK_REPO_CONFIG_BASE` and then `MOCK_REPO_CONFIG_WITH_USER` which includes the `assignedUserId`. `EXPECTED_REPO_PATH` is calculated using `path.join` and the base directory defined in the main module.
*   In the success tests:
    *   We use `MOCK_REPO_CONFIG_WITH_USER`.
    *   We assert that `writeTempKeyStub` is called with `ownerUserId: MOCK_ASSIGNED_USER_ID`.
    *   We meticulously check the arguments passed to `spawnStub`:
        *   The command is `'sudo'`.
        *   The arguments array (`spawnArgs[1]`) matches `['-u', MOCK_ASSIGNED_USER_ID, 'python3', SCRIPT_PATH, '--prompt', ...]`.
        *   The options object (`spawnArgs[2]`) includes the correct `env` (with `GIT_SSH_COMMAND`) and, critically, `cwd: EXPECTED_REPO_PATH`.
    *   We assert that `deleteTempKeyStub` is also called with `ownerUserId` during cleanup.
*   The "context files" test is updated primarily to verify the arguments passed *after* the python script name within the `sudo` arguments.
*   Error handling tests (`script exits non-zero`, `spawn error`, `key write error`) are updated to use `MOCK_REPO_CONFIG_WITH_USER` and assert that `deleteTempKeyStub` is called with `ownerUserId` during cleanup attempts.
*   A new test `missing parameters` is added to ensure the function correctly throws an error if `assignedUserId` (or other required fields) are missing from `repoConfig`.

---

**Next Steps:**

1.  Apply these code changes to `lib/secureKeys.js`, `lib/pythonWrapper.js`, `test/secureKeys.test.js`, and `test/pythonWrapper.test.js`.
2.  Run `npx standard --fix` to ensure code style compliance.
3.  Run `npm test` to verify the tests pass with the new logic and mocks.
4.  Ensure the necessary `sudo` permissions are configured for the `appuser` in the Docker environment (or host system if not using Docker) to allow `chown` and `chmod` as other users, and to execute `python3` as other users. This typically involves editing the `/etc/sudoers` file or adding configuration snippets to `/etc/sudoers.d/`. For example:
    ```sudoers
    # Allow appuser to change ownership/permissions of keys in the designated dir
    appuser ALL=(ALL) NOPASSWD: /usr/bin/chown *:* /tmp/vibehive-keys-*/*/id_rsa_temp
    appuser ALL=(ALL) NOPASSWD: /usr/bin/chmod 600 /tmp/vibehive-keys-*/*/id_rsa_temp
    # Allow appuser to run python3 as any coderX user
    appuser ALL=(ALL) NOPASSWD: /usr/bin/python3 /app/aider_wrapper.py *
    ```
    *(Note: The exact paths and user groups might differ. Use `visudo` to edit safely.)*
5.  Address **Step 22**, which involves *creating* the repository directory (`/app/repos/<repoName>`) potentially via `git clone` or `mkdir`, likely triggered when a repository is added or first interacted with. This current step assumes the directory exists when `invokeAiderWrapper` is called.

This tutorial covers the modifications needed to execute the wrapper script correctly as the designated user with appropriate key permissions and working directory. Remember to handle the prerequisite directory creation and `sudo` configuration separately.

</rewritten_file> 