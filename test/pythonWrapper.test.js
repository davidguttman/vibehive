const test = require('tape')
const proxyquire = require('proxyquire')
const sinon = require('sinon')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { EventEmitter } = require('node:events')

let tempRepoBaseDir
const FAKE_ENCRYPTION_KEY = 'a'.repeat(32)
const FAKE_REPO_ID = '605fe1f4a4f9a8a8d4aae9e0' // Example ObjectId string
const FAKE_DECRYPTED_KEY = '-----BEGIN MOCK KEY-----'
let FAKE_TEMP_KEY_PATH

// --- Mocks --- START ---
const spawnStub = sinon.stub()
const decryptStub = sinon.stub()
const writeTempKeyStub = sinon.stub()
const deleteTempKeyStub = sinon.stub()

const mockChildProcess = {
  spawn: spawnStub
}
const mockCrypto = {
  decrypt: decryptStub
}
const mockSecureKeys = {
  writeTempKey: writeTempKeyStub,
  deleteTempKey: deleteTempKeyStub
}

// --- Mocks --- END ---

// Module loaded *after* setup test runs and sets env vars
let invokeAiderWrapper

// --- Test Setup --- START ---
test('Setup PythonWrapper Tests', async (t) => {
  try {
    // Ensure stubs are clean before setup
    spawnStub.reset()
    decryptStub.reset()
    writeTempKeyStub.reset()
    deleteTempKeyStub.reset()

    tempRepoBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wrapper-ssh-test-'))
    // Set env vars directly for the test suite
    process.env.REPO_BASE_DIR = tempRepoBaseDir
    process.env.ENCRYPTION_KEY = FAKE_ENCRYPTION_KEY

    // Load the module using proxyquire, but *without* mocking process
    const pythonWrapperModule = proxyquire('../lib/pythonWrapper.js', {
      'node:child_process': mockChildProcess,
      '../lib/crypto.js': mockCrypto,
      '../lib/secureKeys.js': mockSecureKeys
    })
    invokeAiderWrapper = pythonWrapperModule.invokeAiderWrapper

    // Define the expected temp key path based on the temp dir
    FAKE_TEMP_KEY_PATH = path.join(tempRepoBaseDir, FAKE_REPO_ID, '.ssh', 'id_rsa')
    t.pass('Setup complete: Temp dir created, ENV vars set, module loaded via proxyquire.')
  } catch (err) {
    t.fail(`Setup failed: ${err}`)
    process.exit(1)
  }
  t.end()
})
// --- Test Setup --- END ---

// Helper function to simulate process completion
function simulateProcess (instance, { exitCode = 0, stdout = '', stderr = '', delay = 5 } = {}) {
  // Use setTimeout instead of process.nextTick for a slightly more realistic async delay
  setTimeout(() => {
    if (stdout) {
      instance.stdout.emit('data', stdout)
    }
    if (stderr) {
      instance.stderr.emit('data', stderr)
    }
    instance.emit('close', exitCode)
  }, delay)
}

// Helper function to simulate process error
function simulateProcessError (instance, error, { delay = 5 } = {}) {
  setTimeout(() => {
    instance.emit('error', error)
  }, delay)
}

// --- Test Cases --- START ---

test('invokeAiderWrapper - No SSH Key in Config', async (t) => {
  // Reset stubs for this test
  spawnStub.reset()
  decryptStub.reset()
  writeTempKeyStub.reset()
  deleteTempKeyStub.reset()

  const mockSpawnInstance = new EventEmitter()
  mockSpawnInstance.stdout = new EventEmitter()
  mockSpawnInstance.stderr = new EventEmitter()
  spawnStub.returns(mockSpawnInstance)

  const prompt = 'test no key'
  const repoConfig = { _id: { toString: () => 'other-id' } } // Config exists, but no encrypted key
  const expectedJson = { overall_status: 'success', events: [] }

  // Use helper to simulate successful exit
  simulateProcess(mockSpawnInstance, { stdout: JSON.stringify(expectedJson) })

  const result = await invokeAiderWrapper({ prompt, repoConfig })

  t.notOk(decryptStub.called, 'decrypt should NOT be called')
  t.notOk(writeTempKeyStub.called, 'writeTempKey should NOT be called')
  t.ok(spawnStub.calledOnce, 'spawn should be called')

  const spawnOptions = spawnStub.firstCall.args[2]
  t.ok(spawnOptions.env, 'spawn env options exist')
  t.equal(spawnOptions.env.REPO_BASE_DIR, tempRepoBaseDir, 'spawn env inherits REPO_BASE_DIR from process')
  t.equal(spawnOptions.env.ENCRYPTION_KEY, FAKE_ENCRYPTION_KEY, 'spawn env inherits ENCRYPTION_KEY from process')
  t.notOk(spawnOptions.env.GIT_SSH_COMMAND, 'GIT_SSH_COMMAND should NOT be set')

  t.equal(result.overall_status, 'success', 'Overall status should be success')
  t.notOk(deleteTempKeyStub.called, 'deleteTempKey should NOT be called')

  t.end()
})

test('invokeAiderWrapper - SSH key success path', async (t) => {
  spawnStub.reset()
  decryptStub.reset()
  writeTempKeyStub.reset()
  deleteTempKeyStub.reset()

  const mockSpawnInstance = new EventEmitter()
  mockSpawnInstance.stdout = new EventEmitter()
  mockSpawnInstance.stderr = new EventEmitter()
  spawnStub.returns(mockSpawnInstance)

  // Configure mocks for success
  decryptStub.returns(FAKE_DECRYPTED_KEY)
  writeTempKeyStub.resolves(FAKE_TEMP_KEY_PATH)
  deleteTempKeyStub.resolves()

  const mockRepoConfig = { _id: { toString: () => FAKE_REPO_ID }, encryptedSshKey: 'encrypted-data' }
  const expectedJson = { overall_status: 'success', events: [{ type: 'text_response', content: 'AI response' }] }

  // Use helper to simulate successful exit
  simulateProcess(mockSpawnInstance, { stdout: JSON.stringify(expectedJson) })

  const result = await invokeAiderWrapper({ prompt: 'test with key', repoConfig: mockRepoConfig })

  // Assertions
  t.ok(decryptStub.calledOnceWith('encrypted-data'), 'decrypt called with encrypted data')
  t.ok(writeTempKeyStub.calledOnceWith({ repoName: FAKE_REPO_ID, keyContent: FAKE_DECRYPTED_KEY, repoBaseDir: tempRepoBaseDir }), 'writeTempKey called with correct args including repoBaseDir')
  t.ok(spawnStub.calledOnce, 'spawn called')

  const expectedGitSshCommand = `ssh -i "${FAKE_TEMP_KEY_PATH}" -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no`
  const spawnOptions = spawnStub.firstCall.args[2]
  t.ok(spawnOptions.env, 'spawn env options exist')
  t.equal(spawnOptions.env.GIT_SSH_COMMAND, expectedGitSshCommand, 'GIT_SSH_COMMAND is set correctly')
  t.equal(spawnOptions.env.ENCRYPTION_KEY, FAKE_ENCRYPTION_KEY, 'Inherited ENCRYPTION_KEY')
  t.equal(spawnOptions.env.REPO_BASE_DIR, tempRepoBaseDir, 'Inherited REPO_BASE_DIR')

  t.equal(result.overall_status, 'success', 'Overall status is success')
  t.ok(deleteTempKeyStub.calledOnceWith({ repoName: FAKE_REPO_ID, repoBaseDir: tempRepoBaseDir }), 'deleteTempKey called on cleanup with repoBaseDir')

  // Check call order if necessary (stubs have .calledBefore(), .calledAfter())
  t.ok(writeTempKeyStub.calledBefore(spawnStub), 'writeTempKey called before spawn')
  t.ok(deleteTempKeyStub.calledAfter(spawnStub), 'deleteTempKey called after spawn')

  t.end()
})

test('invokeAiderWrapper - SSH Key Decryption Fails', async (t) => {
  spawnStub.reset()
  decryptStub.reset()
  writeTempKeyStub.reset()
  deleteTempKeyStub.reset()

  // Configure decrypt to fail
  decryptStub.returns(null) // Or .throws(new Error('Decrypt error'))

  const mockRepoConfig = { _id: { toString: () => FAKE_REPO_ID }, encryptedSshKey: 'bad-encrypted-data' }

  const result = await invokeAiderWrapper({ prompt: 'test decrypt fail', repoConfig: mockRepoConfig })

  t.ok(decryptStub.calledOnceWith('bad-encrypted-data'), 'decrypt was called')
  t.equal(result.overall_status, 'failure', 'Overall status should be failure')
  t.ok(result.error.includes('Failed to decrypt SSH key'), 'Error message indicates decryption failure')
  t.notOk(writeTempKeyStub.called, 'writeTempKey should NOT be called')
  t.notOk(spawnStub.called, 'spawn should NOT be called')
  t.notOk(deleteTempKeyStub.called, 'deleteTempKey should NOT be called')

  t.end()
})

test('invokeAiderWrapper - writeTempKey Fails', async (t) => {
  spawnStub.reset()
  decryptStub.reset()
  writeTempKeyStub.reset()
  deleteTempKeyStub.reset()

  const writeError = new Error('Disk full')
  decryptStub.returns(FAKE_DECRYPTED_KEY)
  writeTempKeyStub.rejects(writeError) // Configure writeTempKey to fail

  const mockRepoConfig = { _id: { toString: () => FAKE_REPO_ID }, encryptedSshKey: 'good-data' }

  const result = await invokeAiderWrapper({ prompt: 'test write fail', repoConfig: mockRepoConfig })

  t.ok(decryptStub.calledOnce, 'decrypt was called')
  t.ok(writeTempKeyStub.calledOnce, 'writeTempKey was called')
  t.equal(result.overall_status, 'failure', 'Overall status should be failure')
  t.ok(result.error.includes(writeError.message), 'Error message includes writeTempKey error')
  t.notOk(spawnStub.called, 'spawn should NOT be called')
  t.notOk(deleteTempKeyStub.called, 'deleteTempKey should NOT be called (key write failed)')

  t.end()
})

test('invokeAiderWrapper - spawn Fails (after key write)', async (t) => {
  spawnStub.reset()
  decryptStub.reset()
  writeTempKeyStub.reset()
  deleteTempKeyStub.reset()

  const mockSpawnInstance = new EventEmitter()
  mockSpawnInstance.stdout = new EventEmitter()
  mockSpawnInstance.stderr = new EventEmitter()
  spawnStub.returns(mockSpawnInstance)

  decryptStub.returns(FAKE_DECRYPTED_KEY)
  writeTempKeyStub.resolves(FAKE_TEMP_KEY_PATH)
  deleteTempKeyStub.resolves() // delete should still work

  const mockRepoConfig = { _id: { toString: () => FAKE_REPO_ID }, encryptedSshKey: 'good-data' }
  const spawnErrorMessage = 'Command not found'

  // Simulate spawn emitting an error
  simulateProcessError(mockSpawnInstance, new Error(spawnErrorMessage))

  const result = await invokeAiderWrapper({ prompt: 'test spawn fail', repoConfig: mockRepoConfig })

  t.ok(decryptStub.calledOnce, 'decrypt called')
  t.ok(writeTempKeyStub.calledOnce, 'writeTempKey called')
  t.ok(spawnStub.calledOnce, 'spawn was attempted')
  t.equal(result.overall_status, 'failure', 'Overall status should be failure')
  t.ok(result.error.includes(spawnErrorMessage), 'Error message includes spawn error')
  t.ok(deleteTempKeyStub.calledOnceWith({ repoName: FAKE_REPO_ID, repoBaseDir: tempRepoBaseDir }), 'deleteTempKey SHOULD be called in finally block with repoBaseDir')

  t.end()
})

test('invokeAiderWrapper - Script Exits Non-Zero (after key write)', async (t) => {
  spawnStub.reset()
  decryptStub.reset()
  writeTempKeyStub.reset()
  deleteTempKeyStub.reset()

  const mockSpawnInstance = new EventEmitter()
  mockSpawnInstance.stdout = new EventEmitter()
  mockSpawnInstance.stderr = new EventEmitter()
  spawnStub.returns(mockSpawnInstance)

  decryptStub.returns(FAKE_DECRYPTED_KEY)
  writeTempKeyStub.resolves(FAKE_TEMP_KEY_PATH)
  deleteTempKeyStub.resolves()

  const mockRepoConfig = { _id: { toString: () => FAKE_REPO_ID }, encryptedSshKey: 'good-data' }
  const stderrMessage = 'Python script error details'

  // Simulate script exiting with error code
  simulateProcess(mockSpawnInstance, { exitCode: 1, stderr: stderrMessage })

  const result = await invokeAiderWrapper({ prompt: 'test script exit fail', repoConfig: mockRepoConfig })

  t.ok(decryptStub.calledOnce, 'decrypt called')
  t.ok(writeTempKeyStub.calledOnce, 'writeTempKey called')
  t.ok(spawnStub.calledOnce, 'spawn was called')
  t.equal(result.overall_status, 'failure', 'Overall status should be failure')
  t.ok(result.error.includes('failed with code 1'), 'Error message includes exit code')
  t.ok(result.error.includes(stderrMessage), 'Error message includes stderr')
  t.ok(deleteTempKeyStub.calledOnceWith({ repoName: FAKE_REPO_ID, repoBaseDir: tempRepoBaseDir }), 'deleteTempKey SHOULD be called in finally block with repoBaseDir')

  t.end()
})

// --- Test Cases --- END ---

// --- Test Teardown --- START ---
test('Teardown PythonWrapper Tests', async (t) => {
  // Restore all sinon stubs
  sinon.restore()

  try {
    if (tempRepoBaseDir) {
      await fs.rm(tempRepoBaseDir, { recursive: true, force: true })
      t.pass('Temp directory removed')
    } else {
      t.skip('Skipping temp dir removal (not created)')
    }
    // Clean up env vars set for the test suite
    delete process.env.REPO_BASE_DIR
    delete process.env.ENCRYPTION_KEY
    t.pass('Teardown complete.')
  } catch (err) {
    t.fail(`Teardown failed: ${err}`)
    console.error(`Warning: Failed to clean up temp directory ${tempRepoBaseDir}:`, err)
  }
  t.end()
})
// --- Test Teardown --- END ---
