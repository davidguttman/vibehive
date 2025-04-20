# Tutorial 16: Secure Temporary SSH Key Handling

This tutorial details the creation of Node.js functions to securely manage temporary SSH private key files needed for repository operations. We'll focus on writing and deleting these keys, ensuring proper permissions (mode `0o600`) are set on the key file. Handling directory ownership/permissions for broader security contexts (like Docker) will be addressed separately.

**Goal:** Create utility functions `writeTempKey` and `deleteTempKey` in a new `lib/secureKeys.js` module, along with corresponding tests.

## Steps:

1.  **Create `lib/secureKeys.js`:**
    -   Create a new directory `lib` if it doesn't exist.
    -   Create a new file `lib/secureKeys.js`.

2.  **Add Requirements and Base Directory:**
    -   Require `node:fs/promises` and `node:path`.
    -   Define `REPO_BASE_DIR`. Read `process.env.REPO_BASE_DIR`. If it's not set, default to `/repos`. *For local development/testing, you might temporarily use `path.join(process.cwd(), 'repos')`.*

    ```javascript
    // lib/secureKeys.js
    const fs = require('node:fs/promises')
    const path = require('node:path')

    const REPO_BASE_DIR = process.env.REPO_BASE_DIR || '/repos' // Use '/repos' or adjust for local testing
    ```

3.  **Implement `writeTempKey`:**
    -   Define an async function `writeTempKey` accepting an object `{ repoName, keyContent }`.
    -   Construct the `.ssh` directory path within the specific repo's directory under `REPO_BASE_DIR`.
    -   Construct the full path for the `id_rsa` file.
    -   Use `fs.mkdir` with `{ recursive: true }` to ensure the `.ssh` directory exists.
    -   Use `fs.writeFile` to write the `keyContent`. Crucially, set the `mode` option to `0o600` to restrict permissions.
    -   Return the full path to the created key file.

    ```javascript
    // lib/secureKeys.js
    // ... (require statements and REPO_BASE_DIR)

    async function writeTempKey ({ repoName, keyContent }) {
      if (!repoName || !keyContent) {
        throw new Error('repoName and keyContent are required')
      }
      const repoDir = path.join(REPO_BASE_DIR, repoName)
      const targetDir = path.join(repoDir, '.ssh')
      const targetFile = path.join(targetDir, 'id_rsa')

      await fs.mkdir(targetDir, { recursive: true })
      // Write the key file with restricted permissions
      await fs.writeFile(targetFile, keyContent, { mode: 0o600 })

      console.log(`Temporary key written to ${targetFile}`) // Optional logging
      return targetFile
    }

    module.exports = {
      writeTempKey
      // deleteTempKey will be added next
    }
    ```

4.  **Implement `deleteTempKey`:**
    -   Define an async function `deleteTempKey` accepting an object `{ repoName }`.
    -   Construct the `id_rsa` file path similarly to `writeTempKey`.
    -   Use `fs.unlink` to delete the file. Wrap this in a `try...catch` block. If the error code is `ENOENT` (file not found), ignore it; otherwise, re-throw the error.
    -   *Optional:* Attempt to remove the `.ssh` directory using `fs.rmdir`. Also wrap this in `try...catch` and ignore `ENOENT` or `ENOTEMPTY` errors.

    ```javascript
    // lib/secureKeys.js
    // ... (require statements, REPO_BASE_DIR, writeTempKey)

    async function deleteTempKey ({ repoName }) {
      if (!repoName) {
        throw new Error('repoName is required')
      }
      const repoDir = path.join(REPO_BASE_DIR, repoName)
      const targetDir = path.join(repoDir, '.ssh')
      const targetFile = path.join(targetDir, 'id_rsa')

      try {
        await fs.unlink(targetFile)
        console.log(`Temporary key deleted: ${targetFile}`) // Optional logging
      } catch (err) {
        if (err.code !== 'ENOENT') {
          // Ignore 'file not found' errors, re-throw others
          console.error(`Error deleting key file ${targetFile}:`, err)
          throw err
        }
        console.log(`Temporary key already deleted or never existed: ${targetFile}`) // Optional logging
      }

      // Optional: Attempt to remove the .ssh directory if it's empty
      try {
        await fs.rmdir(targetDir)
        console.log(`Removed empty directory: ${targetDir}`) // Optional logging
      } catch (err) {
        // Ignore errors if directory not found or not empty
        if (err.code !== 'ENOENT' && err.code !== 'ENOTEMPTY') {
          console.error(`Error removing directory ${targetDir}:`, err)
          // Decide if this should be a fatal error or just logged
        }
      }
    }

    module.exports = {
      writeTempKey,
      deleteTempKey
    }

    // Functions should be defined above module.exports
    // Ensure standard.js compliance
    ```

5.  **Export Functions:**
    -   Ensure both `writeTempKey` and `deleteTempKey` are exported via `module.exports`.

6.  **Apply Linting:**
    -   Run `npx standard --fix` to ensure code style consistency.

    ```bash
    npx standard --fix lib/secureKeys.js
    ```

7.  **Create Test File `test/secureKeys.test.js`:**
    -   Require `tape`, `node:fs/promises`, `node:path`, `node:os`.
    -   Require the functions from `../lib/secureKeys.js`.
    -   Use `os.tmpdir()` and `fs.mkdtemp` to create a unique temporary directory for test artifacts.
    -   Crucially, **set `process.env.REPO_BASE_DIR`** to this temporary directory *before* requiring your `secureKeys` module or at the very start of the test file, so the module picks up the correct base path for testing.
    -   Define tests using `test('description', async (t) => { ... })`.

    ```javascript
    // test/secureKeys.test.js
    const test = require('tape')
    const fs = require('node:fs/promises')
    const path = require('node:path')
    const os = require('node:os')

    // Create a temporary directory for testing BEFORE requiring the module under test
    let tempBaseDir
    try {
      tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'securekeys-test-'))
      process.env.REPO_BASE_DIR = tempBaseDir // Set env var for the module
      console.log(`Using temp directory for tests: ${tempBaseDir}`)
    } catch (err) {
      console.error('Failed to create temp directory for tests:', err)
      process.exit(1) // Exit if setup fails
    }

    // Now require the module - it will use the tempBaseDir via the env var
    const { writeTempKey, deleteTempKey } = require('../lib/secureKeys.js')

    const TEST_REPO_NAME = 'test-repo-secure'
    const TEST_KEY_CONTENT = '-----BEGIN RSA PRIVATE KEY-----\nTESTKEY\n-----END RSA PRIVATE KEY-----'

    test('Setup: Ensure temp dir exists', async (t) => {
      t.ok(tempBaseDir, `Temp base directory should exist: ${tempBaseDir}`)
      try {
        await fs.access(tempBaseDir)
        t.pass('Successfully accessed temp base directory.')
      } catch (err) {
        t.fail(`Failed to access temp base directory: ${err.message}`)
      }
      t.end()
    })


    test('writeTempKey creates file with correct content and permissions', async (t) => {
      try {
        const keyPath = await writeTempKey({ repoName: TEST_REPO_NAME, keyContent: TEST_KEY_CONTENT })
        t.ok(keyPath, 'writeTempKey should return the path to the key file')

        const expectedPath = path.join(tempBaseDir, TEST_REPO_NAME, '.ssh', 'id_rsa')
        t.equal(keyPath, expectedPath, 'Returned path should match expected path')

        // Check file content
        const content = await fs.readFile(keyPath, 'utf8')
        t.equal(content, TEST_KEY_CONTENT, 'File content should match input key content')

        // Check file permissions (mode)
        const stats = await fs.stat(keyPath)
        // Mode check: 0o600 means read/write for owner only. stat.mode gives decimal.
        // The lower bits represent permissions. 0o100600 represents a regular file with 600 permissions.
        t.equal(stats.mode & 0o777, 0o600, 'File permissions should be 600 (owner read/write)')

      } catch (err) {
        t.fail(`writeTempKey failed: ${err.message}`)
      }
      t.end()
    })

    test('deleteTempKey removes the key file', async (t) => {
      const keyPath = path.join(tempBaseDir, TEST_REPO_NAME, '.ssh', 'id_rsa')
      // Ensure file exists first (written by previous test)
      try {
        await fs.access(keyPath)
        t.pass('Key file exists before deletion attempt.')
      } catch (err) {
        t.fail(`Key file should exist before deleteTempKey is called: ${err.message}`)
        t.end(); return // Stop test if file doesn't exist
      }

      try {
        await deleteTempKey({ repoName: TEST_REPO_NAME })
        t.pass('deleteTempKey executed without throwing an error')

        // Verify the file is actually deleted
        try {
          await fs.access(keyPath)
          t.fail('Key file should not exist after deleteTempKey call')
        } catch (err) {
          t.equal(err.code, 'ENOENT', 'Accessing deleted file should result in ENOENT error')
        }
      } catch (err) {
        t.fail(`deleteTempKey failed unexpectedly: ${err.message}`)
      }
      t.end()
    })

    test('deleteTempKey does not error if file already deleted', async (t) => {
      const keyPath = path.join(tempBaseDir, TEST_REPO_NAME, '.ssh', 'id_rsa')
      // Ensure file does NOT exist (deleted by previous test)
       try {
          await fs.access(keyPath)
          t.fail('Key file should NOT exist before this test run')
        } catch (err) {
          t.equal(err.code, 'ENOENT', 'Verified key file does not exist')
        }

      try {
        await deleteTempKey({ repoName: TEST_REPO_NAME })
        t.pass('deleteTempKey executed without error even when file was already gone')
      } catch (err) {
        t.fail(`deleteTempKey should not have failed when file was already deleted: ${err.message}`)
      }
      t.end()
    })

    // Cleanup Test
    test('Cleanup: Remove temporary directory', async (t) => {
      try {
        if (tempBaseDir) {
          await fs.rm(tempBaseDir, { recursive: true, force: true })
          t.pass(`Successfully removed temp directory: ${tempBaseDir}`)
        } else {
          t.skip('Temp directory was not created, skipping cleanup.')
        }
      } catch (err) {
        // Log error but don't fail the test suite over cleanup issues typically
        console.error(`Warning: Failed to clean up temp directory ${tempBaseDir}:`, err)
        t.comment(`Warning: Failed to clean up temp directory ${tempBaseDir}: ${err.message}`)
      }
      t.end()
    })

    // Helper to run tests using async/await with tape
    // Tape doesn't natively support top-level await, so we wrap tests or use a runner
    // Note: The tape tests above use async (t) => {}, which is supported.
    // Ensure tape is configured correctly in package.json if running directly.
    ```

8.  **Add Test Script to `package.json`:**
    -   Ensure your `package.json` includes `tape` in `devDependencies`.
    -   Add or modify the `test` script to run tape:

    ```json
    // package.json (scripts section)
    "scripts": {
      "test": "tape test/**/*.test.js",
      // ... other scripts
    },
    ```

9.  **Run Tests:**
    -   Execute `npm test` in your terminal. Verify all tests pass.

    ```bash
    npm install --save-dev tape # If not already installed
    npm test
    ```

This completes the setup for secure temporary key handling. The functions `writeTempKey` and `deleteTempKey` can now be used by other parts of the application that require temporary SSH access for specific repositories. Remember that directory-level permissions and ownership might need further configuration depending on the deployment environment (e.g., Docker user). 