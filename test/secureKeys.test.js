const test = require('tape')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

// Create a temporary directory for testing BEFORE requiring the module under test
let tempBaseDir
let setupError = null

// Top-level async IIFE for setup
;(async () => {
  try {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'securekeys-test-'))
    process.env.REPO_BASE_DIR = tempBaseDir // Set env var for the module
    console.log(`Using temp directory for tests: ${tempBaseDir}`)
  } catch (err) {
    console.error('Failed to create temp directory for tests:', err)
    setupError = err // Store the error to fail tests later
  }
})().then(() => {
  // Only run tests if setup was successful
  if (setupError) {
    test('Setup Failed', (t) => {
      t.fail(`Failed to create temporary directory: ${setupError.message}`)
      t.end()
      // Optionally exit here if setup is critical for all tests
      // process.exit(1)
    })
    return
  }

  // Now require the module - it will use the tempBaseDir via the env var
  // Place require here to ensure env var is set
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

  // Cleanup Test - runs last
  test('Cleanup: Remove temporary directory', async (t) => {
    // Ensure this runs after all other tests
    try {
      if (tempBaseDir) {
        await fs.rm(tempBaseDir, { recursive: true, force: true })
        t.pass(`Successfully removed temp directory: ${tempBaseDir}`)
      } else {
        t.skip('Temp directory was not created or setup failed, skipping cleanup.')
      }
    } catch (err) {
      // Log error but don't fail the test suite over cleanup issues typically
      console.error(`Warning: Failed to clean up temp directory ${tempBaseDir}:`, err)
      t.comment(`Warning: Failed to clean up temp directory ${tempBaseDir}: ${err.message}`)
    }
    t.end()
  })
})
