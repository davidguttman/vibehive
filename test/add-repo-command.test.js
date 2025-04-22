// test/add-repo-command.test.js
const test = require('ava')
const proxyquire = require('proxyquire').noCallThru()
const sinon = require('sinon')
const path = require('node:path')
const fs = require('node:fs/promises')
const { execSync, execFileSync } = require('node:child_process')
const { PermissionsBitField } = require('discord.js')
const { MongoMemoryServer } = require('mongodb-memory-server')
const mongoose = require('mongoose') // Required for ObjectId
// const { connectDB, closeDB } = require('../lib/mongo') // Use in-memory for tests

process.env.NODE_ENV = 'test'

// --- Mocks --- START ---
const mockCrypto = {
  // encrypt: sinon.stub().returns('mock-encrypted-key'), // Mocked per test if needed
  encrypt: sinon.stub(), // Stubbed globally, configure per test
  decrypt: sinon.stub().returns('-----BEGIN RSA PRIVATE KEY-----\nMOCK KEY CONTENT\n-----END RSA PRIVATE KEY-----')
}

const mockSecureKeys = {
  writeTempKey: sinon.stub(), // Stubbed, will resolve path per test
  deleteTempKey: sinon.stub().resolves() // Assume cleanup always works unless tested otherwise
}

// Mock Repository static methods
const MockRepositoryModel = {
  updateOne: sinon.stub(),
  distinct: sinon.stub(),
  findOne: sinon.stub(),
  deleteOne: sinon.stub().resolves(), // Mock deleteOne for potential cleanup tests
  // Ensure prototype methods aren't called or mock them if necessary
  prototype: {
    save: sinon.stub() // Example if instance methods were used
  }
}

// Mock config
const mockConfig = {
  repoBaseDir: '/tmp/vibehive-test-repos' // Use /tmp for test repo base dir
}

// Mock fetch (can keep the existing one or refine)
let originalFetch
const mockFetch = async (url) => {
  console.log(`TEST: Mock fetch called with URL: ${url}`)
  if (url === 'http://mock-key-url.com/valid-key') {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '-----BEGIN RSA PRIVATE KEY-----\nMOCK KEY CONTENT\n-----END RSA PRIVATE KEY-----'
    }
  } else if (url === 'http://mock-key-url.com/fetch-error') {
    return { ok: false, status: 404, statusText: 'Not Found' }
  } else if (url === 'http://mock-key-url.com/empty-key') {
    return { ok: true, status: 200, statusText: 'OK', text: async () => '' }
  }
  return { ok: false, status: 400, statusText: 'Bad Request (Mock)' }
}

// Load the handler with mocks injected
// IMPORTANT: Adjust path if your handler is not directly in interactionCreate.js
// const { handleAddRepoCommand } = proxyquire('../events/interactionCreate', {
const interactionCreateHandler = proxyquire('../events/interactionCreate', { // <<< Import the whole module
  '../lib/crypto': mockCrypto,
  '../lib/secureKeys': mockSecureKeys,
  '../models/Repository': MockRepositoryModel,
  '../config': mockConfig,
  // No need to mock 'node:fs/promises', 'node:path', 'node:child_process'
  // We are mocking 'node-fetch' indirectly via global.fetch spy
  // Ensure mongoose is mocked if interactionCreate uses it directly beyond the model
  mongoose: {
    Error: mongoose.Error, // Pass through Error types for checks
    Types: mongoose.Types // Pass through Types for ObjectId generation
  }
})

// --- Mocks --- END ---

// --- Test Environment Setup --- START ---
const TEST_REPO_BASE = mockConfig.repoBaseDir
const TEST_ORIGIN_REPO_PATH = '/tmp/test-origin-repo.git' // Dummy repo to clone FROM
const TEST_TEMP_KEY_DIR = '/tmp/test-keys' // Where mock writeTempKey will claim to put keys

let mongoServer
let fetchSpy // <<< Define variable for the spy

// Test setup: Create base test dir, dummy origin repo, temp key dir, start mongo
test.before(async () => {
  console.log('>>> TEST.BEFORE START <<<') // <<< Log start
  // Set required ENV VAR
  process.env.ENCRYPTION_KEY = 'testkey_123456789012345678901234'
  if (process.env.ENCRYPTION_KEY.length !== 32) {
    throw new Error('Test setup failed: Dummy ENCRYPTION_KEY must be 32 characters.')
  }

  try {
    console.log('Cleaning up previous test directories...')
    await fs.rm(TEST_REPO_BASE, { recursive: true, force: true })
    await fs.rm(TEST_ORIGIN_REPO_PATH, { recursive: true, force: true })
    await fs.rm(TEST_TEMP_KEY_DIR, { recursive: true, force: true })
    await fs.rm('/tmp/git-commit-temp', { recursive: true, force: true }) // <<< Clean up temp commit dir

    console.log('Creating test directories...')
    await fs.mkdir(TEST_REPO_BASE, { recursive: true })
    await fs.mkdir(TEST_TEMP_KEY_DIR, { recursive: true }) // Create dir for mock keys

    console.log('Creating bare git repo for testing...')
    execSync(`mkdir -p ${TEST_ORIGIN_REPO_PATH}`)
    execSync(`git init --bare ${TEST_ORIGIN_REPO_PATH}`)

    // <<< Simplified way to add a commit to the bare repo >>>
    console.log('Adding initial commit to bare repo...')
    execSync('mkdir -p /tmp/git-commit-temp')
    execSync(`cd /tmp/git-commit-temp && git init -b main && git config user.email "test@example.com" && git config user.name "Test User" && echo "test content" > test.txt && git add . && git commit -m "Initial commit" && git remote add origin ${TEST_ORIGIN_REPO_PATH} && git push origin main:main`, { stdio: 'inherit' })
    execSync(`cd ${TEST_ORIGIN_REPO_PATH} && git symbolic-ref HEAD refs/heads/main`)
    execSync('rm -rf /tmp/git-commit-temp')
    console.log('Initial commit added.')
    // <<< End simplified commit addition >>>

    console.log(`Created test base dir ${TEST_REPO_BASE}, bare repo ${TEST_ORIGIN_REPO_PATH}, key dir ${TEST_TEMP_KEY_DIR}`)
    // Ensure coder users exist (Dockerfile/manual setup responsibility)

    console.log('Starting in-memory MongoDB...')
    mongoServer = await MongoMemoryServer.create({ binary: { version: '4.4.6' } })
    const mongoUri = mongoServer.getUri()
    // Connect mongoose (required by the model potentially, even if mocked)
    console.log('Connecting mongoose...') // <<< Log before connect
    await mongoose.connect(mongoUri) // Use mongoose directly for test setup/teardown connection
    console.log('Mongoose connected.') // <<< Log after connect
    console.log('In-memory MongoDB connected.')
  } catch (error) {
    console.error('FATAL: Test setup failed:', error)
    process.exit(1) // Fail tests if setup fails
  }

  // Setup global fetch mock using sinon.spy
  originalFetch = global.fetch
  fetchSpy = sinon.spy(mockFetch) // <<< Wrap mockFetch with spy
  global.fetch = fetchSpy // <<< Assign the spy to global.fetch
  console.log('>>> TEST.BEFORE END <<<') // <<< Log end
})

// Test cleanup: Remove directories, stop mongo
test.after.always(async () => {
  console.log('>>> TEST.AFTER.ALWAYS START <<<') // <<< Log start
  // Restore fetch
  global.fetch = originalFetch
  // Stop mongo
  console.log('Disconnecting mongoose...') // <<< Log before disconnect
  await mongoose.disconnect()
  console.log('Mongoose disconnected.') // <<< Log after disconnect
  if (mongoServer) {
    console.log('Stopping mongo server...') // <<< Log before stop
    await mongoServer.stop()
    console.log('Mongo server stopped.') // <<< Log after stop
  }
  console.log('MongoDB disconnected and server stopped.')

  // Cleanup filesystem
  try {
    console.log('Cleaning up test directories...')
    await fs.rm(TEST_REPO_BASE, { recursive: true, force: true })
    await fs.rm(TEST_ORIGIN_REPO_PATH, { recursive: true, force: true })
    await fs.rm(TEST_TEMP_KEY_DIR, { recursive: true, force: true })
    await fs.rm('/tmp/git-commit-temp', { recursive: true, force: true }) // <<< Clean up temp commit dir
    console.log('Cleaned up test directories.')
  } catch (error) {
    console.error('Warning: Test cleanup failed:', error)
  }
  // Clear ENV VAR
  delete process.env.ENCRYPTION_KEY
  console.log('>>> TEST.AFTER.ALWAYS END <<<') // <<< Log end
})

// Reset mocks and context before each test
test.beforeEach(async t => {
  console.log(`>>> TEST.BEFOREEACH START (${t.title}) <<<`) // <<< Log start
  sinon.resetHistory() // This will now reset fetchSpy history too

  // Reset mock behaviors for Repository
  MockRepositoryModel.updateOne.resolves({ acknowledged: true, modifiedCount: 1, upsertedId: null, matchedCount: 1 }) // Default success (update)
  MockRepositoryModel.distinct.resolves([]) // Default: no users assigned yet
  MockRepositoryModel.findOne.resolves(null) // Default: repo not found
  MockRepositoryModel.deleteOne.resolves() // Default success

  // Reset other mocks
  mockCrypto.encrypt.returns('mock-encrypted-key') // Provide default return
  mockCrypto.decrypt.returns('-----BEGIN RSA PRIVATE KEY-----\nMOCK KEY CONTENT\n-----END RSA PRIVATE KEY-----')
  // Configure writeTempKey to return a predictable path for the test
  mockSecureKeys.writeTempKey.callsFake(async ({ repoName, ownerUserId }) => {
    // Use the TEST_TEMP_KEY_DIR established in before()
    const keyPath = path.join(TEST_TEMP_KEY_DIR, `${ownerUserId}-${repoName}-key.pem`)
    // Simulate writing the file if needed for other tests, but here just return path
    return keyPath
  })
  mockSecureKeys.deleteTempKey.resolves() // Assume success

  // Clean database between tests
  // Use the actual Repository model loaded via mongoose connection for cleanup
  const RepoModel = require('../models/Repository')
  console.log('Deleting existing test data...') // <<< Log before deleteMany
  await RepoModel.deleteMany({})
  console.log('Test data deleted.') // <<< Log after deleteMany

  // Context for potential cleanup in afterEach
  t.context.repoPath = null // Store the expected path for cleanup
  t.context.guildId = 'guild-test-id'
  t.context.channelId = 'channel-test-id'
  t.context.assignedUserId = 'coder1' // Default test user
  console.log(`>>> TEST.BEFOREEACH END (${t.title}) <<<`) // <<< Log end
})

// Cleanup potentially created repo directory after each test
test.afterEach.always(async t => {
  console.log(`>>> TEST.AFTEREACH.ALWAYS START (${t.title}) <<<`) // <<< Log start
  // Restore any stubs created within the test itself (if not using global mocks)
  // sinon.restore(); // Might conflict if global mocks are reused

  // Cleanup specific repo dir potentially created during the test
  if (t.context.repoPath) {
    console.log(`Attempting cleanup of: ${t.context.repoPath} using sudo rm -rf`) // <<< Log method
    try {
      // Use sudo rm -rf since appuser doesn't own the contents
      execFileSync('sudo', ['rm', '-rf', t.context.repoPath]) // <<< Use sudo rm -rf
      console.log(`Cleaned test repo dir: ${t.context.repoPath}`)
    } catch (e) {
      // Log error but don't fail test on cleanup failure
      console.error(`Failed to clean up repo path ${t.context.repoPath} using sudo: ${e.message}`) // <<< Update log message
    }
  }
  console.log(`>>> TEST.AFTEREACH.ALWAYS END (${t.title}) <<<`) // <<< Log end
})
// --- Test Environment Setup --- END ---

// Mock Interaction Object Factory - Updated
function createMockInteraction (options = {}) {
  const {
    commandName = 'add-repo',
    isChatInputCommand = true,
    inGuild = true,
    guildId = 'guild-test-id', // Default guild ID
    channelId = 'channel-test-id', // Default channel ID
    isAdmin = true, // Default to admin for most tests here
    repoUrl = TEST_ORIGIN_REPO_PATH, // Default to local test repo
    attachment = { // Default valid attachment
      name: 'id_rsa_test',
      url: 'http://mock-key-url.com/valid-key',
      contentType: 'application/octet-stream'
    },
    assignedUserId = 'coder1', // Provide a default test user ID
    encryptedSshKey = 'mock-encrypted-key' // Provide a default mock key
  } = options

  // Create new stubs for each interaction
  const replyStub = sinon.stub().resolves()
  const followUpStub = sinon.stub().resolves()
  const deferReplyStub = sinon.stub().resolves()

  return {
    commandName,
    isChatInputCommand: () => isChatInputCommand,
    inGuild: () => inGuild,
    guildId,
    channelId,
    member: {
      permissions: {
        has: (permission) => {
          const adminFlag = PermissionsBitField.Flags.Administrator
          return permission === adminFlag || permission === 'Administrator' ? isAdmin : false
        }
      }
    },
    options: {
      getString: (name) => {
        if (name === 'repository') return repoUrl
        if (name === 'assigned_user_id') return assignedUserId
        if (name === 'ssh_key_encrypted') return encryptedSshKey
        return options[name] || null
      },
      getAttachment: (name) => {
        return name === 'ssh_key' ? attachment : null
      }
    },
    // Provide the stubs directly for assertion
    reply: replyStub,
    followUp: followUpStub,
    deferReply: deferReplyStub,
    stubs: { reply: replyStub, followUp: followUpStub, deferReply: deferReplyStub }
    // Properties like .replied or .deferred are not needed with stub checks
  }
}

// --- Updated Tests --- START ---

test.serial('/add-repo Command - Non-Admin', async (t) => {
  const interaction = createMockInteraction({ isAdmin: false })

  // Directly call the mocked handler's execute method
  await interactionCreateHandler.execute(interaction) // <<< Call execute

  t.true(interaction.stubs.reply.calledOnce, 'reply should be called once')
  const replyArgs = interaction.stubs.reply.firstCall.args[0]
  t.is(replyArgs.content, 'You do not have permission to use this command.', 'Should reply with permission error')
  t.is(replyArgs.ephemeral, true, 'Permission error reply should be ephemeral')
  t.false(interaction.stubs.deferReply.called, 'deferReply should not be called')
  t.false(interaction.stubs.followUp.called, 'followUp should not be called')
  t.false(MockRepositoryModel.updateOne.called, 'Repository.updateOne should not be called')
})

test.serial('/add-repo - Success Case (New Repo, Local Clone)', async t => {
  const channelId = 'channel-success-new'
  const guildId = 'guild-success-new'
  const assignedUserId = 'coder1'
  const repoUrl = TEST_ORIGIN_REPO_PATH // Use local bare repo path
  const expectedRepoPath = path.join(TEST_REPO_BASE, `${guildId}-${channelId}`)
  t.context.repoPath = expectedRepoPath // For cleanup
  t.context.assignedUserId = assignedUserId
  t.context.channelId = channelId
  t.context.guildId = guildId

  const interaction = createMockInteraction({
    channelId,
    guildId,
    repoUrl, // Pass the local path
    assignedUserId, // Pass assigned user for mock interaction
    encryptedSshKey: 'encrypted-key-success-new' // Pass mock encrypted key
  })

  // Configure Mocks for this specific test
  MockRepositoryModel.distinct.withArgs('assignedUserId').resolves([]) // No users assigned initially
  const mockObjectId = new mongoose.Types.ObjectId()
  MockRepositoryModel.updateOne.resolves({ acknowledged: true, modifiedCount: 0, upsertedId: mockObjectId, matchedCount: 0 }) // Simulate insert
  mockCrypto.encrypt.returns('encrypted-key-success-new')
  mockSecureKeys.writeTempKey.resolves(path.join(TEST_TEMP_KEY_DIR, `${assignedUserId}-${guildId}-${channelId}-key.pem`))

  // Execute the handler's execute method
  await interactionCreateHandler.execute(interaction)

  // --- Assertions ---
  // Interaction flow
  t.true(interaction.stubs.deferReply.calledOnce, 'deferReply called')

  // Mocks called
  t.true(fetchSpy.calledOnce, 'fetch should be called for the key') // <<< Use fetchSpy
  t.true(mockCrypto.encrypt.calledOnce, 'encrypt called')
  t.true(MockRepositoryModel.distinct.calledOnceWith('assignedUserId'), 'distinct called')
  t.true(mockCrypto.decrypt.calledOnceWith('encrypted-key-success-new'), 'decrypt called with correct key')
  t.true(mockSecureKeys.writeTempKey.calledOnce, 'writeTempKey called')
  t.deepEqual(mockSecureKeys.writeTempKey.firstCall.args[0], {
    repoName: `${guildId}-${channelId}`,
    keyContent: '-----BEGIN RSA PRIVATE KEY-----\nMOCK KEY CONTENT\n-----END RSA PRIVATE KEY-----',
    ownerUserId: assignedUserId
  }, 'writeTempKey called with correct args')

  // DB Update call (before clone attempt)
  t.true(MockRepositoryModel.updateOne.calledOnce, 'updateOne called')
  const updateArgs = MockRepositoryModel.updateOne.firstCall.args
  t.deepEqual(updateArgs[0], { discordChannelId: channelId }, 'updateOne filter is correct')
  t.is(updateArgs[1].$set.repoUrl, repoUrl, 'updateOne sets correct repoUrl')
  t.is(updateArgs[1].$set.encryptedSshKey, 'encrypted-key-success-new', 'updateOne sets correct encryptedKey')
  t.is(updateArgs[1].$set.assignedUserId, assignedUserId, 'updateOne sets correct assignedUserId')
  t.deepEqual(updateArgs[1].$setOnInsert, { discordChannelId: channelId }, 'updateOne $setOnInsert is correct')
  t.deepEqual(updateArgs[2], { upsert: true, runValidators: true }, 'updateOne options are correct')

  // Check file system state *within container*
  try {
    await fs.access(expectedRepoPath) // Check clone target dir exists
    await fs.access(path.join(expectedRepoPath, '.git')) // Check clone occurred
    await fs.access(path.join(expectedRepoPath, 'test.txt')) // Check dummy file from bare repo exists
    t.pass('Repository directory, .git folder, and test file created.')
  } catch (e) {
    t.fail(`Repository directory ${expectedRepoPath} or contents not found after successful clone: ${e}`)
  }

  // Final success reply
  t.true(interaction.stubs.followUp.calledOnce, 'followUp called')
  const followUpArgs = interaction.stubs.followUp.firstCall.args[0]
  t.true(followUpArgs.content.includes(`✅ Repository '${repoUrl}' configured, cloned successfully, and assigned User ID: ${assignedUserId}`), 'FollowUp message indicates success and includes assigned user')
  t.is(followUpArgs.ephemeral, undefined, 'FollowUp is NOT ephemeral on success')

  // Cleanup mock called
  t.true(mockSecureKeys.deleteTempKey.calledOnce, 'deleteTempKey called in finally')
  t.deepEqual(mockSecureKeys.deleteTempKey.firstCall.args[0], {
    repoName: `${guildId}-${channelId}`,
    ownerUserId: assignedUserId
  }, 'deleteTempKey called with correct args')
})

test.serial('/add-repo - Clone Failure Case (Invalid Local Path)', async t => {
  const channelId = 'channel-fail-clone'
  const guildId = 'guild-fail-clone'
  const assignedUserId = 'coder2'
  const invalidRepoUrl = '/tmp/non-existent-repo.git' // Invalid local path
  const expectedRepoPath = path.join(TEST_REPO_BASE, `${guildId}-${channelId}`)
  t.context.repoPath = expectedRepoPath // For cleanup, even though it should be deleted by handler
  t.context.assignedUserId = assignedUserId
  t.context.channelId = channelId
  t.context.guildId = guildId

  const interaction = createMockInteraction({
    channelId,
    guildId,
    repoUrl: invalidRepoUrl, // Pass the invalid path
    assignedUserId, // Pass user ID
    encryptedSshKey: 'encrypted-key-fail-clone' // Pass mock key
  })

  // Configure Mocks
  MockRepositoryModel.distinct.withArgs('assignedUserId').resolves(['coder1']) // Simulate coder1 is used
  MockRepositoryModel.updateOne.resolves({ acknowledged: true, modifiedCount: 1, upsertedId: null, matchedCount: 1 }) // Simulate DB update success before clone fails
  mockCrypto.encrypt.returns('encrypted-key-fail-clone')
  mockSecureKeys.writeTempKey.resolves(path.join(TEST_TEMP_KEY_DIR, `${assignedUserId}-${guildId}-${channelId}-key.pem`))

  // Execute the handler's execute method
  await interactionCreateHandler.execute(interaction)

  // --- Assertions ---
  // Initial steps should succeed
  t.true(interaction.stubs.deferReply.calledOnce, 'deferReply called')
  t.true(fetchSpy.calledOnce, 'fetch called') // <<< Use fetchSpy
  t.true(mockCrypto.encrypt.calledOnce, 'encrypt called')
  t.true(MockRepositoryModel.distinct.calledOnce, 'distinct called')
  t.true(mockCrypto.decrypt.calledOnce, 'decrypt called')
  t.true(mockSecureKeys.writeTempKey.calledOnce, 'writeTempKey called')
  t.true(MockRepositoryModel.updateOne.calledOnce, 'updateOne called before clone attempt')

  // Check file system state *within container* - directory should be removed by error handler
  try {
    await fs.access(expectedRepoPath)
    // If access succeeds, the cleanup failed
    t.fail(`Repository directory ${expectedRepoPath} should have been deleted after clone failure.`)
  } catch (e) {
    // Error is expected (ENOENT - No Such Entity), means directory doesn't exist
    t.pass('Repository directory correctly cleaned up by error handler.')
  }

  // Error reply should be sent
  t.true(interaction.stubs.followUp.calledOnce, 'followUp called with error')
  const followUpArgs = interaction.stubs.followUp.firstCall.args[0]
  t.true(followUpArgs.content.includes('❌ Failed to clone repository'), 'FollowUp message indicates clone failure')
  t.true(followUpArgs.content.includes('Stderr:'), 'FollowUp message includes Stderr') // Check stderr is included
  t.is(followUpArgs.ephemeral, true, 'Error FollowUp is ephemeral')

  // Cleanup mock called
  t.true(mockSecureKeys.deleteTempKey.calledOnce, 'deleteTempKey called in finally')
})

// Add more tests for other failure scenarios as needed:
// - fetch failure (already exists, verify mocks)
// - encrypt failure (already exists, verify mocks)
// - distinct failure
// - pool exhausted (already exists, verify mocks)
// - mkdir failure (requires mocking fs.mkdir to reject, or setting invalid TEST_REPO_BASE perms)
// - chown failure (requires mocking execFileSync to throw, or running as non-root)
// - writeTempKey failure (mockSecureKeys.writeTempKey.rejects())
// - decrypt failure (mockCrypto.decrypt.returns(null))
// - updateOne failure (MockRepositoryModel.updateOne.rejects())
// - deleteTempKey failure (mockSecureKeys.deleteTempKey.rejects())

// Example: Test case for writeTempKey failure
test.serial('/add-repo - Failure Case (writeTempKey fails)', async t => {
  const channelId = 'channel-fail-writekey'
  const guildId = 'guild-fail-writekey'
  const assignedUserId = 'coder1'
  const repoUrl = TEST_ORIGIN_REPO_PATH
  const expectedRepoPath = path.join(TEST_REPO_BASE, `${guildId}-${channelId}`)
  t.context.repoPath = expectedRepoPath // For potential cleanup
  t.context.assignedUserId = assignedUserId
  t.context.channelId = channelId
  t.context.guildId = guildId

  const interaction = createMockInteraction({
    channelId,
    guildId,
    repoUrl,
    assignedUserId,
    encryptedSshKey: 'encrypted-key-fail-write'
  })

  // Configure Mocks
  MockRepositoryModel.distinct.resolves([])
  mockCrypto.encrypt.returns('encrypted-key-fail-write')
  mockSecureKeys.writeTempKey.rejects(new Error('Disk full')) // Simulate failure

  // Execute the handler's execute method
  await interactionCreateHandler.execute(interaction)

  // Assertions
  t.true(interaction.stubs.deferReply.calledOnce, 'deferReply called')
  t.true(fetchSpy.calledOnce, 'fetch called') // <<< Use fetchSpy
  t.true(mockCrypto.encrypt.calledOnce, 'encrypt called')
  t.true(MockRepositoryModel.distinct.calledOnce, 'distinct called')
  // Directory creation/ownership happens *before* writeTempKey
  t.true(mockCrypto.decrypt.calledOnce, 'decrypt should be called before writeTempKey')

  // Check directory was created (it happens before writeTempKey)
  try {
    await fs.access(expectedRepoPath)
    t.pass('Repo directory created before writeTempKey failure.')
  } catch (e) {
    t.fail(`Repo directory ${expectedRepoPath} should exist: ${e}`)
  }

  // writeTempKey mock was called
  t.true(mockSecureKeys.writeTempKey.calledOnce, 'writeTempKey was called')

  // DB update should NOT have been called
  t.false(MockRepositoryModel.updateOne.called, 'updateOne should not be called if writeTempKey fails')

  // Check directory was NOT cleaned up by error handler
  try {
    await fs.access(expectedRepoPath)
    t.pass('Repository directory correctly NOT cleaned up after writeTempKey failure.')
  } catch (e) {
    t.fail(`Repository directory ${expectedRepoPath} should have remained after writeTempKey failure, but it was removed: ${e}`)
  }

  // Error reply
  t.true(interaction.stubs.followUp.calledOnce, 'followUp called with error')
  const followUpArgs = interaction.stubs.followUp.firstCall.args[0]
  t.true(followUpArgs.content.includes('❌ Error preparing SSH key: Disk full') || followUpArgs.content.includes('❌ An unexpected error occurred while processing /add-repo: Disk full'), 'FollowUp message indicates writeTempKey failure')
  t.is(followUpArgs.ephemeral, true, 'Error FollowUp is ephemeral')

  // deleteTempKey should NOT be called in finally because keyFilePath was never set
  t.false(mockSecureKeys.deleteTempKey.called, 'deleteTempKey should not be called')
})

// Keep essential existing tests, adapt if necessary
test.serial('/add-repo - Fetch Key Failure', async (t) => {
  const interaction = createMockInteraction({
    attachment: { name: 'fetch_fail.key', url: 'http://mock-key-url.com/fetch-error' }
  })

  // Execute the handler's execute method
  await interactionCreateHandler.execute(interaction)

  t.true(interaction.stubs.deferReply.calledOnce, 'deferReply called')
  t.true(interaction.stubs.followUp.calledOnce, 'followUp called')
  const followUpArgs = interaction.stubs.followUp.firstCall.args[0]
  t.true(followUpArgs.content.includes('Error fetching the SSH key file: Failed to fetch key (404): Not Found'), 'Reply indicates fetch error with status')
  t.is(followUpArgs.ephemeral, true, 'Error reply is ephemeral')
  t.false(MockRepositoryModel.updateOne.called, 'Repository.updateOne should not be called on fetch failure')
  t.false(mockSecureKeys.writeTempKey.called, 'writeTempKey not called')
  t.false(mockSecureKeys.deleteTempKey.called, 'deleteTempKey not called')
})

// ... (Keep other relevant existing tests like Empty Key, Missing Attachment, Encrypt Fail, DB Fail, Pool Exhausted, adapting mocks as needed, ensuring they call interactionCreateHandler.execute) ...

// --- Updated Tests --- END ---

// Remove the old teardown test marker
// test('** Teardown Add-Repo Tests **', async (t) => {
//   t.pass('Teardown handled in after.always and afterEach.always')
// })
