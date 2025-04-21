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
const FAKE_ASSIGNED_USER_ID = 'coderxyz' // Assigned user ID for sudo
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
  deleteTempKey: deleteTempKeyStub,
  keysBaseDir: '/tmp/mock-keys-base-dir'
}

// --- Mocks --- END ---

// Module loaded *after* setup test runs and sets env vars
let invokeAiderWrapper
let REPOS_BASE_DIR

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
    REPOS_BASE_DIR = pythonWrapperModule.REPOS_BASE_DIR

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

test('invokeAiderWrapper - Missing required parameters', async (t) => {
  // Test without assignedUserId
  const mockConfigNoUserId = {
    repoName: 'test-repo',
    encryptedSshKey: 'encrypted-key-data'
    // Missing assignedUserId intentionally
  }

  const result1 = await invokeAiderWrapper({
    prompt: 'Test prompt',
    repoConfig: mockConfigNoUserId
  })

  t.equal(result1.overall_status, 'failure', 'Should fail with missing assignedUserId')
  t.ok(result1.error.includes('Missing required'), 'Error should mention missing parameters')

  // Test without encryptedSshKey
  const mockConfigNoKey = {
    repoName: 'test-repo',
    assignedUserId: FAKE_ASSIGNED_USER_ID
    // Missing encryptedSshKey intentionally
  }

  const result2 = await invokeAiderWrapper({
    prompt: 'Test prompt',
    repoConfig: mockConfigNoKey
  })

  t.equal(result2.overall_status, 'failure', 'Should fail with missing encryptedSshKey')
  t.ok(result2.error.includes('Missing required'), 'Error should mention missing parameters')

  t.end()
})

test('invokeAiderWrapper - SSH Key Success Path with sudo', async (t) => {
  // Reset all stubs
  spawnStub.reset()
  decryptStub.reset()
  writeTempKeyStub.reset()
  deleteTempKeyStub.reset()

  // Set up mock objects
  const mockSpawnInstance = new EventEmitter()
  mockSpawnInstance.stdout = new EventEmitter()
  mockSpawnInstance.stderr = new EventEmitter()
  spawnStub.returns(mockSpawnInstance)

  // Configure successful decryption and key writing
  decryptStub.withArgs('encrypted-key-data').returns(FAKE_DECRYPTED_KEY)
  writeTempKeyStub.resolves(FAKE_TEMP_KEY_PATH)
  deleteTempKeyStub.resolves()

  // Complete repo config with assignedUserId
  const mockRepoConfig = {
    repoName: FAKE_REPO_ID,
    encryptedSshKey: 'encrypted-key-data',
    assignedUserId: FAKE_ASSIGNED_USER_ID
  }

  const expectedJson = {
    overall_status: 'success',
    events: [{ type: 'text_response', content: 'AI response' }]
  }

  // Start the invocation
  const promise = invokeAiderWrapper({
    prompt: 'Test prompt with key',
    repoConfig: mockRepoConfig
  })

  // Simulate successful execution
  simulateProcess(mockSpawnInstance, { stdout: JSON.stringify(expectedJson) })

  // Wait for completion
  const result = await promise

  // Verify decryption and key handling
  t.ok(decryptStub.calledOnceWith('encrypted-key-data'), 'Should decrypt the key')
  t.ok(writeTempKeyStub.calledOnce, 'Should write the key to a temp file')

  // Verify writeTempKey gets ownerUserId parameter
  const writeTempKeyArgs = writeTempKeyStub.firstCall.args[0]
  t.equal(writeTempKeyArgs.repoName, FAKE_REPO_ID, 'Should pass correct repoName')
  t.equal(writeTempKeyArgs.keyContent, FAKE_DECRYPTED_KEY, 'Should pass decrypted key content')
  t.equal(writeTempKeyArgs.ownerUserId, FAKE_ASSIGNED_USER_ID, 'Should pass assignedUserId as ownerUserId')

  // Verify spawn call with sudo
  t.ok(spawnStub.calledOnce, 'Should spawn a process')
  const spawnArgs = spawnStub.firstCall.args

  // First argument should be sudo
  t.equal(spawnArgs[0], 'sudo', 'Should use sudo as the command')

  // Second argument should be an array starting with -u FAKE_ASSIGNED_USER_ID
  t.ok(Array.isArray(spawnArgs[1]), 'Second argument should be an array')
  t.equal(spawnArgs[1][0], '-u', 'First sudo argument should be -u')
  t.equal(spawnArgs[1][1], FAKE_ASSIGNED_USER_ID, 'Second sudo argument should be the assignedUserId')

  // python3 and script path should follow
  t.ok(spawnArgs[1].includes('python3'), 'Should include python3 command')
  t.ok(spawnArgs[1].some(arg => arg.endsWith('aider_wrapper.py')), 'Should include script path')

  // Verify spawn options
  const spawnOptions = spawnArgs[2]
  t.ok(spawnOptions, 'Should provide spawn options')
  t.ok(spawnOptions.env, 'Should provide environment variables')
  t.equal(
    spawnOptions.env.GIT_SSH_COMMAND,
    `ssh -i "${FAKE_TEMP_KEY_PATH}" -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no`,
    'Should set GIT_SSH_COMMAND correctly'
  )

  // Most important: verify cwd is set correctly
  const expectedRepoPath = path.join(REPOS_BASE_DIR, FAKE_REPO_ID)
  t.equal(spawnOptions.cwd, expectedRepoPath, 'Should set cwd to the repo path')

  // Verify key cleanup
  t.ok(deleteTempKeyStub.calledOnce, 'Should clean up the key file')
  const deleteTempKeyArgs = deleteTempKeyStub.firstCall.args[0]
  t.equal(deleteTempKeyArgs.repoName, FAKE_REPO_ID, 'Should clean up the correct key')
  t.equal(deleteTempKeyArgs.ownerUserId, FAKE_ASSIGNED_USER_ID, 'Should pass ownerUserId to deleteTempKey')

  // Verify result
  t.equal(result.overall_status, 'success', 'Should return success status')
  t.deepEqual(result.events, expectedJson.events, 'Should return the parsed events')

  t.end()
})

test('invokeAiderWrapper - SSH Key with Context Files', async (t) => {
  // Reset stubs
  spawnStub.reset()
  decryptStub.reset()
  writeTempKeyStub.reset()
  deleteTempKeyStub.reset()

  // Set up mock objects
  const mockSpawnInstance = new EventEmitter()
  mockSpawnInstance.stdout = new EventEmitter()
  mockSpawnInstance.stderr = new EventEmitter()
  spawnStub.returns(mockSpawnInstance)

  // Configure successful decryption and key writing
  decryptStub.returns(FAKE_DECRYPTED_KEY)
  writeTempKeyStub.resolves(FAKE_TEMP_KEY_PATH)

  // Complete repo config with assignedUserId
  const mockRepoConfig = {
    repoName: FAKE_REPO_ID,
    encryptedSshKey: 'encrypted-key-data',
    assignedUserId: FAKE_ASSIGNED_USER_ID
  }

  // Context files to pass
  const contextFiles = ['file1.js', 'file2.js']

  // Start the invocation
  const promise = invokeAiderWrapper({
    prompt: 'Test prompt with context files',
    contextFiles,
    repoConfig: mockRepoConfig
  })

  // Simulate successful execution
  simulateProcess(mockSpawnInstance, { stdout: JSON.stringify({ overall_status: 'success' }) })

  // Wait for completion
  await promise

  // Verify context files are passed correctly
  t.ok(spawnStub.calledOnce, 'Should spawn a process')
  const spawnArgs = spawnStub.firstCall.args[1] // Command arguments array

  // Check all context files are included in arguments
  contextFiles.forEach(file => {
    t.ok(spawnArgs.includes(file), `Should include context file ${file} in arguments`)
  })

  // Verify --context-file argument is used
  t.ok(spawnArgs.includes('--context-file'), 'Should include --context-file argument')

  t.end()
})

test('invokeAiderWrapper - SSH Key Error Handling and Cleanup', async (t) => {
  // Reset stubs
  spawnStub.reset()
  decryptStub.reset()
  writeTempKeyStub.reset()
  deleteTempKeyStub.reset()

  // Set up mock objects
  const mockSpawnInstance = new EventEmitter()
  mockSpawnInstance.stdout = new EventEmitter()
  mockSpawnInstance.stderr = new EventEmitter()
  spawnStub.returns(mockSpawnInstance)

  // Configure successful decryption and key writing
  decryptStub.returns(FAKE_DECRYPTED_KEY)
  writeTempKeyStub.resolves(FAKE_TEMP_KEY_PATH)

  // Complete repo config with assignedUserId
  const mockRepoConfig = {
    repoName: FAKE_REPO_ID,
    encryptedSshKey: 'encrypted-key-data',
    assignedUserId: FAKE_ASSIGNED_USER_ID
  }

  // Start the invocation
  const promise = invokeAiderWrapper({
    prompt: 'Test prompt with error',
    repoConfig: mockRepoConfig
  })

  // Simulate process error
  const mockError = new Error('Sudo execution failed')
  simulateProcessError(mockSpawnInstance, mockError)

  // Wait for completion
  const result = await promise

  // Verify result indicates failure
  t.equal(result.overall_status, 'failure', 'Should report failure')
  t.ok(result.error.includes('Sudo execution failed'), 'Should include error message')

  // Verify key is cleaned up even on error
  t.ok(deleteTempKeyStub.called, 'Should attempt to clean up the key file even after error')
  const deleteTempKeyArgs = deleteTempKeyStub.firstCall.args[0]
  t.equal(deleteTempKeyArgs.repoName, FAKE_REPO_ID, 'Should clean up the correct key')
  t.equal(deleteTempKeyArgs.ownerUserId, FAKE_ASSIGNED_USER_ID, 'Should pass ownerUserId to deleteTempKey')

  t.end()
})

// --- Test Cases --- END ---

// --- Test Teardown --- START ---
test('Teardown PythonWrapper Tests', async (t) => {
  try {
    // Ensure stubs are reset
    spawnStub.reset()
    decryptStub.reset()
    writeTempKeyStub.reset()
    deleteTempKeyStub.reset()

    if (tempRepoBaseDir) {
      await fs.rm(tempRepoBaseDir, { recursive: true, force: true })
      t.pass(`Successfully removed temp directory: ${tempRepoBaseDir}`)
    } else {
      t.skip('Skipping temp dir removal (not created)')
    }

    // Clean up environment variables
    delete process.env.REPO_BASE_DIR
    delete process.env.ENCRYPTION_KEY
  } catch (err) {
    t.comment(`Warning: Failed to clean up: ${err.message}`)
  }
  t.end()
})
// --- Test Teardown --- END ---
