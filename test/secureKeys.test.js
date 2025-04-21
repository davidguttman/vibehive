const test = require('ava')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const sinon = require('sinon')
const proxyquire = require('proxyquire').noCallThru() // Use proxyquire

// --- Mocks --- START ---
const execFileSyncStub = sinon.stub()

const mockChildProcess = {
  execFileSync: execFileSyncStub
}

// Load the module using proxyquire, injecting the mock
const { writeTempKey, deleteTempKey } = proxyquire('../lib/secureKeys.js', {
  'node:child_process': mockChildProcess
})
// --- Mocks --- END ---

// --- Test Globals --- START ---
let tempBaseDir // Defined in setup, used across tests
const TEST_REPO_NAME = 'test-repo-secure'
const TEST_KEY_CONTENT = '-----BEGIN RSA PRIVATE KEY-----\nTESTKEY\n-----END RSA PRIVATE KEY-----'
const TEST_OWNER_USER_ID = 'coder123' // Mock user ID
// --- Test Globals --- END ---

// --- Test Setup --- START ---
test.before('Setup secureKeys Tests', async (t) => {
  try {
    // Reset stubs before each test group
    execFileSyncStub.reset()

    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'securekeys-test-'))
    t.log(`Using temp directory for secureKeys tests: ${tempBaseDir}`)
    t.pass('Setup complete: Temp dir created and stubs prepared.')
  } catch (err) {
    t.fail(`Setup failed: ${err}`)
    process.exit(1)
  }
})
// --- Test Setup --- END ---

// --- Test Cases --- START ---

test.serial('secureKeys: writeTempKey creates file with correct content and permissions', async (t) => {
  // Reset the stub behavior for this specific test
  execFileSyncStub.returns(Buffer.from('')) // Default success

  try {
    const keyPath = await writeTempKey({
      repoName: TEST_REPO_NAME,
      keyContent: TEST_KEY_CONTENT,
      ownerUserId: TEST_OWNER_USER_ID,
      repoBaseDir: tempBaseDir
    })
    t.truthy(keyPath, 'writeTempKey should return the path to the key file')

    const expectedPath = path.join(tempBaseDir, TEST_REPO_NAME, '.ssh', 'id_rsa')
    t.is(keyPath, expectedPath, 'Returned path should match expected path')

    // Verify file content and initial mode (before sudo)
    const content = await fs.readFile(keyPath, 'utf8')
    t.is(content, TEST_KEY_CONTENT, 'File content should match input key content')
    const stats = await fs.stat(keyPath)
    t.is(stats.mode & 0o777, 0o600, 'File permissions should be 600 initially')

    // Verify mocked sudo calls
    t.is(execFileSyncStub.callCount, 2, 'Should call execFileSync twice (chown + chmod)')

    // Verify first sudo call (chown)
    t.truthy(
      execFileSyncStub.calledWith(
        'sudo',
        ['-u', TEST_OWNER_USER_ID, 'chown', `${TEST_OWNER_USER_ID}:${TEST_OWNER_USER_ID}`, expectedPath]
      ),
      'Should call sudo chown with correct parameters'
    )

    // Verify second sudo call (chmod)
    t.truthy(
      execFileSyncStub.calledWith(
        'sudo',
        ['-u', TEST_OWNER_USER_ID, 'chmod', '600', expectedPath]
      ),
      'Should call sudo chmod with correct parameters'
    )
  } catch (err) {
    t.fail(`writeTempKey failed: ${err.message}`)
    console.error('writeTempKey Error Trace:', err)
  }

  execFileSyncStub.reset() // Clean up stub for next test
})

test.serial('secureKeys: writeTempKey handles sudo failure (chown)', async (t) => {
  // Set up the stub to simulate chown failure
  const sudoError = new Error('Permission denied')
  sudoError.stderr = Buffer.from('sudo: user does not exist') // Add stderr info
  execFileSyncStub.withArgs(
    'sudo',
    sinon.match.array.startsWith(['-u', TEST_OWNER_USER_ID, 'chown'])
  ).throws(sudoError)

  try {
    await writeTempKey({
      repoName: TEST_REPO_NAME,
      keyContent: TEST_KEY_CONTENT,
      ownerUserId: TEST_OWNER_USER_ID,
      repoBaseDir: tempBaseDir
    })
    t.fail('Should have thrown an error on sudo chown failure')
  } catch (err) {
    t.truthy(err.message.includes('Failed to set ownership/permissions via sudo'), 'Error message should indicate sudo failure')
    t.truthy(err.message.includes('Permission denied'), 'Error message should include original error')
  }

  execFileSyncStub.reset() // Clean up stub for next test
})

test.serial('secureKeys: writeTempKey handles sudo failure (chmod)', async (t) => {
  // Set up the stub to simulate chmod failure
  const sudoError = new Error('Operation not permitted')
  sudoError.stderr = Buffer.from('sudo: unable to change file mode') // Add stderr info

  // Make the first call (chown) succeed
  execFileSyncStub.withArgs(
    'sudo',
    sinon.match.array.startsWith(['-u', TEST_OWNER_USER_ID, 'chown'])
  ).returns(Buffer.from(''))

  // Make the second call (chmod) fail
  execFileSyncStub.withArgs(
    'sudo',
    sinon.match.array.startsWith(['-u', TEST_OWNER_USER_ID, 'chmod'])
  ).throws(sudoError)

  try {
    await writeTempKey({
      repoName: TEST_REPO_NAME,
      keyContent: TEST_KEY_CONTENT,
      ownerUserId: TEST_OWNER_USER_ID,
      repoBaseDir: tempBaseDir
    })
    t.fail('Should have thrown an error on sudo chmod failure')
  } catch (err) {
    t.truthy(err.message.includes('Failed to set ownership/permissions via sudo'), 'Error message should indicate sudo failure')
    t.truthy(err.message.includes('Operation not permitted'), 'Error message should include original error')
  }

  execFileSyncStub.reset() // Clean up stub for next test
})

test.serial('secureKeys: deleteTempKey removes the key file', async (t) => {
  // Ensure the file exists first (create it without sudo calls for this test)
  const keyPath = path.join(tempBaseDir, TEST_REPO_NAME, '.ssh', 'id_rsa')
  await fs.mkdir(path.dirname(keyPath), { recursive: true })
  await fs.writeFile(keyPath, TEST_KEY_CONTENT, { mode: 0o600 })
  t.pass('Test key file created for delete test.')

  try {
    await deleteTempKey({
      repoName: TEST_REPO_NAME,
      ownerUserId: TEST_OWNER_USER_ID, // Passed but not used in current delete logic
      repoBaseDir: tempBaseDir
    })
    t.pass('deleteTempKey executed without throwing an error')

    // Verify the file is actually deleted
    try {
      await fs.access(keyPath)
      t.fail('Key file should not exist after deleteTempKey call')
    } catch (err) {
      t.is(err.code, 'ENOENT', 'Accessing deleted file should result in ENOENT error')
    }
  } catch (err) {
    t.fail(`deleteTempKey failed unexpectedly: ${err.message}`)
  }
})

test.serial('secureKeys: deleteTempKey does not error if file already deleted', async (t) => {
  const keyPath = path.join(tempBaseDir, TEST_REPO_NAME, '.ssh', 'id_rsa')
  // Ensure file does NOT exist
  try {
    await fs.unlink(keyPath).catch(() => {}) // Attempt deletion, ignore error if not found
    await fs.access(keyPath)
    t.fail('Key file should NOT exist before this test run')
  } catch (err) {
    t.is(err.code, 'ENOENT', 'Verified key file does not exist')
  }

  try {
    await deleteTempKey({
      repoName: TEST_REPO_NAME,
      ownerUserId: TEST_OWNER_USER_ID,
      repoBaseDir: tempBaseDir
    })
    t.pass('deleteTempKey executed without error even when file was already gone')
  } catch (err) {
    t.fail(`deleteTempKey should not have failed when file was already deleted: ${err.message}`)
  }
})

// --- Test Cases --- END ---

// --- Test Teardown --- START ---
test.after.always('Teardown secureKeys Tests', async (t) => {
  try {
    // Restore stubs if sinon sandbox was used (proxyquire doesn't need explicit restore)
    // sandbox.restore(); // No longer needed if not using sandbox

    if (tempBaseDir) {
      await fs.rm(tempBaseDir, { recursive: true, force: true })
      t.pass(`Successfully removed temp directory: ${tempBaseDir}`)
    } else {
      t.log('Skipping temp dir removal (not created)')
    }
  } catch (err) {
    t.log(`Warning: Failed to clean up temp directory ${tempBaseDir}: ${err.message}`)
  }
})
// --- Test Teardown --- END ---
