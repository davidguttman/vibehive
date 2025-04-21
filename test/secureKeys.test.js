const test = require('tape')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

// Get the module directly now
const { writeTempKey, deleteTempKey } = require('../lib/secureKeys.js')

// --- Test Globals --- START ---
let tempBaseDir // Defined in setup, used across tests
const TEST_REPO_NAME = 'test-repo-secure'
const TEST_KEY_CONTENT = '-----BEGIN RSA PRIVATE KEY-----\nTESTKEY\n-----END RSA PRIVATE KEY-----'
// --- Test Globals --- END ---

// --- Test Setup --- START ---
test('Setup secureKeys Tests', async (t) => {
  try {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'securekeys-test-'))
    console.log(`Using temp directory for secureKeys tests: ${tempBaseDir}`)
    t.pass('Setup complete: Temp dir created.')
  } catch (err) {
    t.fail(`Setup failed: ${err}`)
    process.exit(1)
  }
  t.end()
})
// --- Test Setup --- END ---

// --- Test Cases --- START ---

test('secureKeys: writeTempKey creates file with correct content and permissions', async (t) => {
  try {
    const keyPath = await writeTempKey({ repoName: TEST_REPO_NAME, keyContent: TEST_KEY_CONTENT, repoBaseDir: tempBaseDir })
    t.ok(keyPath, 'writeTempKey should return the path to the key file')

    const expectedPath = path.join(tempBaseDir, TEST_REPO_NAME, '.ssh', 'id_rsa')
    t.equal(keyPath, expectedPath, 'Returned path should match expected path')

    const content = await fs.readFile(keyPath, 'utf8')
    t.equal(content, TEST_KEY_CONTENT, 'File content should match input key content')

    const stats = await fs.stat(keyPath)
    t.equal(stats.mode & 0o777, 0o600, 'File permissions should be 600')
  } catch (err) {
    t.fail(`writeTempKey failed: ${err.message}`)
    console.error('writeTempKey Error Trace:', err) // Added trace
  }
  t.end()
})

test('secureKeys: deleteTempKey removes the key file', async (t) => {
  const keyPath = path.join(tempBaseDir, TEST_REPO_NAME, '.ssh', 'id_rsa')
  // Ensure file exists first
  try {
    await fs.access(keyPath)
    t.pass('Key file exists before deletion attempt.')
  } catch (err) {
    t.fail(`Key file should exist before deleteTempKey is called: ${err.message}`)
    t.end(); return
  }

  try {
    await deleteTempKey({ repoName: TEST_REPO_NAME, repoBaseDir: tempBaseDir })
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

test('secureKeys: deleteTempKey does not error if file already deleted', async (t) => {
  const keyPath = path.join(tempBaseDir, TEST_REPO_NAME, '.ssh', 'id_rsa')
  // Ensure file does NOT exist
  try {
    await fs.access(keyPath)
    t.fail('Key file should NOT exist before this test run')
  } catch (err) {
    t.equal(err.code, 'ENOENT', 'Verified key file does not exist')
  }

  try {
    await deleteTempKey({ repoName: TEST_REPO_NAME, repoBaseDir: tempBaseDir })
    t.pass('deleteTempKey executed without error even when file was already gone')
  } catch (err) {
    t.fail(`deleteTempKey should not have failed when file was already deleted: ${err.message}`)
  }
  t.end()
})

// --- Test Cases --- END ---

// --- Test Teardown --- START ---
test('Teardown secureKeys Tests', async (t) => {
  try {
    if (tempBaseDir) {
      await fs.rm(tempBaseDir, { recursive: true, force: true })
      t.pass(`Successfully removed temp directory: ${tempBaseDir}`)
    } else {
      t.skip('Skipping temp dir removal (not created)')
    }
  } catch (err) {
    t.comment(`Warning: Failed to clean up temp directory ${tempBaseDir}: ${err.message}`)
  }
  t.end()
})
// --- Test Teardown --- END ---
