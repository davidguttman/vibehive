// test/add-repo-command.test.js
const test = require('tape')
const sinon = require('sinon')
const { PermissionsBitField } = require('discord.js')
const { MongoMemoryServer } = require('mongodb-memory-server')
const mongoose = require('mongoose') // Required for ObjectId and Error checking
process.env.NODE_ENV = 'test'
// const mongoose = require('mongoose') // Removed - Unused in this file
const Repository = require('../models/Repository')
const { connectDB, closeDB } = require('../lib/mongo')
const interactionCreateHandler = require('../events/interactionCreate') // Import the actual handler
const { decrypt } = require('../lib/crypto') // Import only decrypt, encrypt is unused

// We need to simulate the part of index.js that handles interactions
// Normally, you might extract the handler logic into its own module,
// but for this tutorial, we'll define a simplified mock handler.

// --- Global Mocks --- START ---
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
  // Fallback for unexpected URLs
  return { ok: false, status: 400, statusText: 'Bad Request (Mock)' }
  // throw new Error(`Unexpected fetch URL in mock: ${url}`);
}
// --- Global Mocks --- END ---

// Mock Interaction Object Factory - Enhanced for attachments
function createMockInteraction (options = {}) {
  const {
    commandName = 'add-repo',
    isChatInputCommand = true,
    inGuild = true,
    userTag = 'testuser#1234',
    channelId = 'channel-test-id',
    guildId = 'guild-test-id', // Added guildId
    isAdmin = false,
    repoUrl = 'https://github.com/test/repo.git',
    attachment = null, // { name: 'id_rsa', url: 'http://...', contentType: '...' }
    replied = false,
    deferred = false
  } = options

  const replyStub = sinon.stub().resolves()
  const followUpStub = sinon.stub().resolves()
  const deferReplyStub = sinon.stub().resolves()

  return {
    commandName,
    isChatInputCommand: () => isChatInputCommand,
    inGuild: () => inGuild,
    user: { tag: userTag },
    channelId,
    guildId,
    member: {
      permissions: {
        has: (permission) => {
          // Allow checking for specific permissions like Administrator
          if (typeof permission === 'string') {
            return permission === 'Administrator' && isAdmin
          }
          // Handle PermissionsBitField instances
          return permission === PermissionsBitField.Flags.Administrator && isAdmin
        }
      }
    },
    options: {
      getString: (name) => {
        return name === 'repository' ? repoUrl : null // Adjusted name to 'repository'
      },
      getAttachment: (name) => {
        return name === 'ssh_key' ? attachment : null
      }
    },
    reply: replyStub,
    followUp: followUpStub,
    deferReply: deferReplyStub,
    stubs: { reply: replyStub, followUp: followUpStub, deferReply: deferReplyStub },
    replied,
    deferred
  }
}

// Define the same pool as in the command handler for test assertions
const CODER_USER_POOL = ['coder1', 'coder2', 'coder3', 'coder4', 'coder5']

// --- Test Setup and Teardown --- START ---
let mongoServer
let updateOneStub // To spy on Repository.updateOne
let distinctStub // To spy/stub Repository.distinct

const setup = async (t) => {
  // Set a dummy encryption key for testing
  process.env.ENCRYPTION_KEY = 'testkey_123456789012345678901234' // 32 chars
  if (process.env.ENCRYPTION_KEY.length !== 32) {
    throw new Error('Test setup failed: Dummy ENCRYPTION_KEY must be 32 characters.')
  }

  // Mock fetch
  originalFetch = global.fetch
  global.fetch = mockFetch

  // DB setup
  mongoServer = await MongoMemoryServer.create({ binary: { version: '4.4.6' } }) // Ensure version 4.4.6
  const mongoUri = mongoServer.getUri()
  await connectDB(mongoUri)
  await Repository.deleteMany({}) // Clean slate

  // Stub Repository methods BEFORE tests use them
  updateOneStub = sinon.stub(Repository, 'updateOne')
  distinctStub = sinon.stub(Repository, 'distinct')
  // Stub the specific findOne call used in the handler for update logic
  // This stubbing is now handled within the specific test that needs it or relies on prototype stubs below
  // findOneStub = sinon.stub(Repository.prototype, 'select').returnsThis() // Chain .select()
  // sinon.stub(Repository.prototype, 'lean').resolves(null) // Chain .lean() - Default to null unless overridden per test

  t.pass('Setup complete: ENV key set, fetch mocked, DB connected, stubs created')
}

const teardown = async (t) => {
  // Restore all stubs created using sinon.stub(Object, method)
  sinon.restore()

  global.fetch = originalFetch // Restore fetch
  await closeDB()
  if (mongoServer) {
    await mongoServer.stop()
  }
  delete process.env.ENCRYPTION_KEY
  sinon.resetHistory() // Reset sinon stubs history
  t.pass('Teardown complete: Stubs restored, fetch restored, DB closed, ENV cleared')
}
// --- Test Setup and Teardown --- END ---

test('** Setup Add-Repo Tests **', async (t) => {
  // The setup is now done within each test block using setup()
  t.pass('Deferring setup to individual tests')
  t.end()
})

// --- Tests --- (Refactored to use actual handler)

test('/add-repo Command - Non-Admin', async (t) => {
  await setup(t)
  const mockInteraction = createMockInteraction({ isAdmin: false })

  await interactionCreateHandler.execute(mockInteraction)

  t.ok(mockInteraction.stubs.reply.calledOnce, 'reply should be called once')
  const replyArgs = mockInteraction.stubs.reply.firstCall.args[0]
  t.equal(replyArgs.content, 'You do not have permission to use this command.', 'Should reply with permission error')
  t.equal(replyArgs.ephemeral, true, 'Permission error reply should be ephemeral')
  t.notOk(mockInteraction.stubs.deferReply.called, 'deferReply should not be called')
  t.notOk(mockInteraction.stubs.followUp.called, 'followUp should not be called')
  t.notOk(updateOneStub.called, 'Repository.updateOne should not be called')

  await teardown(t)
  t.end()
})

test('/add-repo - Success with SSH Key Attachment (New Repo)', async (t) => {
  await setup(t)
  const testUrl = 'git@github.com:test/ssh-repo-new.git'
  const mockAttachment = {
    name: 'id_rsa_test',
    url: 'http://mock-key-url.com/valid-key',
    contentType: 'application/octet-stream'
  }
  const mockInteraction = createMockInteraction({
    isAdmin: true,
    repoUrl: testUrl,
    attachment: mockAttachment
  })

  // Configure stubs
  distinctStub.withArgs('assignedUserId').resolves([]) // <-- Add this: Assume no users assigned yet
  const mockObjectId = new mongoose.Types.ObjectId()
  updateOneStub.resolves({ acknowledged: true, modifiedCount: 0, upsertedId: mockObjectId, matchedCount: 0 })

  await interactionCreateHandler.execute(mockInteraction)

  // Assertions
  t.ok(mockInteraction.stubs.deferReply.calledOnce, 'deferReply should be called once')
  t.ok(distinctStub.calledOnce, 'distinctStub should be called') // <-- Add check for distinctStub call
  t.ok(mockInteraction.stubs.followUp.calledOnce, 'followUp should be called once')
  const followUpArgs = mockInteraction.stubs.followUp.firstCall.args[0]
  // Existing success message doesn't include assignedUserId yet, update assertion
  // t.ok(followUpArgs.content.includes(`Repository configured: ${testUrl}. SSH key uploaded and secured.`), 'FollowUp confirms key upload for new repo')
  t.ok(followUpArgs.content.includes('Assigned User ID: coder1'), 'FollowUp should include assigned user ID coder1')
  t.equal(followUpArgs.ephemeral, true, 'FollowUp is ephemeral')

  t.ok(updateOneStub.calledOnce, 'Repository.updateOne should be called once')
  const updateCallArgs = updateOneStub.firstCall.args
  t.equal(updateCallArgs[0].discordChannelId, mockInteraction.channelId, 'updateOne filter uses correct channelId')
  t.equal(updateCallArgs[1].$set.repoUrl, testUrl, 'updateOne update sets correct repoUrl')
  t.ok(updateCallArgs[1].$set.encryptedSshKey, 'updateOne update includes encryptedSshKey')
  t.equal(updateCallArgs[1].$set.assignedUserId, 'coder1', 'updateOne update includes assignedUserId coder1') // <-- Add check for assignedUserId
  t.ok(updateCallArgs[2].upsert, 'updateOne uses upsert option')

  try {
    const decryptedKey = decrypt(updateCallArgs[1].$set.encryptedSshKey)
    t.equal(decryptedKey, '-----BEGIN RSA PRIVATE KEY-----\nMOCK KEY CONTENT\n-----END RSA PRIVATE KEY-----', 'Stored key should decrypt correctly')
  } catch (e) {
    t.fail(`Failed to decrypt stored key: ${e.message}`)
  }

  await teardown(t)
  t.end()
})

test('/add-repo - Success with SSH Key Attachment (Update Repo)', async (t) => {
  await setup(t)
  const testUrl = 'git@github.com:test/ssh-repo-update.git'
  const mockAttachment = { name: 'id_rsa_upd', url: 'http://mock-key-url.com/valid-key' }
  const existingChannelId = 'channel-update-test' // Use a specific ID for stubbing findOne
  const mockInteraction = createMockInteraction({ isAdmin: true, repoUrl: testUrl, attachment: mockAttachment, channelId: existingChannelId })

  // Configure stubs
  // Assume coder1 exists, so the handler should assign coder2
  distinctStub.withArgs('assignedUserId').resolves(['coder1'])
  updateOneStub.resolves({ acknowledged: true, modifiedCount: 1, upsertedId: null, matchedCount: 1 })

  // --- Mock the findOne().select().lean() call --- Start ---
  // Restore stubs potentially made in setup to avoid conflicts
  sinon.restore()
  // Re-stub essential stubs for this test
  updateOneStub = sinon.stub(Repository, 'updateOne').resolves({ acknowledged: true, modifiedCount: 1, upsertedId: null, matchedCount: 1 })
  distinctStub = sinon.stub(Repository, 'distinct').withArgs('assignedUserId').resolves(['coder1'])

  // Mock the specific findOne -> select -> lean sequence for THIS channel ID
  const mockLean = sinon.stub().resolves({ assignedUserId: 'coder1' }) // Simulate existing doc had coder1
  const mockSelect = sinon.stub().returns({ lean: mockLean })
  sinon.stub(Repository, 'findOne').withArgs({ discordChannelId: existingChannelId }).returns({ select: mockSelect })
  // --- Mock the findOne().select().lean() call --- End ---

  await interactionCreateHandler.execute(mockInteraction)

  t.ok(mockInteraction.stubs.deferReply.calledOnce, 'deferReply called')
  t.ok(distinctStub.calledOnce, 'distinctStub should be called') // <-- Add check
  t.ok(Repository.findOne.calledOnce, 'Repository.findOne should be called for update check') // <-- Add check
  t.ok(mockInteraction.stubs.followUp.calledOnce, 'followUp called')
  const followUpArgs = mockInteraction.stubs.followUp.firstCall.args[0]
  // Existing message needs updating
  // t.ok(followUpArgs.content.includes(`Repository configuration updated: ${testUrl}. New SSH key uploaded and secured.`), 'FollowUp confirms key upload for updated repo')
  t.ok(followUpArgs.content.includes('Assigned User ID: coder2'), 'FollowUp should include assigned user ID coder2')

  t.ok(updateOneStub.calledOnce, 'Repository.updateOne called')
  const updateCallArgs = updateOneStub.firstCall.args
  t.equal(updateCallArgs[1].$set.assignedUserId, 'coder2', 'updateOne update includes assignedUserId coder2') // <-- Add check
  t.ok(updateOneStub.firstCall.args[1].$set.encryptedSshKey, 'Update includes encrypted key')

  await teardown(t)
  t.end()
})

test('/add-repo - Fetch Key Failure', async (t) => {
  await setup(t)
  const mockAttachment = { name: 'fetch_fail.key', url: 'http://mock-key-url.com/fetch-error' }
  const mockInteraction = createMockInteraction({ isAdmin: true, attachment: mockAttachment })

  await interactionCreateHandler.execute(mockInteraction)

  t.ok(mockInteraction.stubs.deferReply.calledOnce, 'deferReply called')
  t.ok(mockInteraction.stubs.followUp.calledOnce, 'followUp called')
  const followUpArgs = mockInteraction.stubs.followUp.firstCall.args[0]
  t.ok(followUpArgs.content.includes('Error fetching the SSH key file: Failed to fetch key (404): Not Found'), 'Reply indicates fetch error with status')
  t.equal(followUpArgs.ephemeral, true, 'Error reply is ephemeral')
  t.notOk(updateOneStub.called, 'Repository.updateOne should not be called on fetch failure')

  await teardown(t)
  t.end()
})

test('/add-repo - Empty Key Content Failure', async (t) => {
  await setup(t)
  const mockAttachment = { name: 'empty.key', url: 'http://mock-key-url.com/empty-key' }
  const mockInteraction = createMockInteraction({ isAdmin: true, attachment: mockAttachment })

  await interactionCreateHandler.execute(mockInteraction)

  t.ok(mockInteraction.stubs.deferReply.calledOnce, 'deferReply called')
  t.ok(mockInteraction.stubs.followUp.calledOnce, 'followUp called')
  const followUpArgs = mockInteraction.stubs.followUp.firstCall.args[0]
  t.ok(followUpArgs.content.includes('Error fetching the SSH key file: Fetched key content is empty or whitespace.'), 'Reply indicates empty key error')
  t.equal(followUpArgs.ephemeral, true, 'Error reply is ephemeral')
  t.notOk(updateOneStub.called, 'Repository.updateOne should not be called on empty key failure')

  await teardown(t)
  t.end()
})

test('/add-repo - Missing Attachment Failure', async (t) => {
  await setup(t)
  // Pass attachment: null (default)
  const mockInteraction = createMockInteraction({ isAdmin: true, attachment: null })

  await interactionCreateHandler.execute(mockInteraction)

  t.ok(mockInteraction.stubs.deferReply.calledOnce, 'deferReply called') // Handler defers before checking attachment
  t.ok(mockInteraction.stubs.followUp.calledOnce, 'followUp called')
  const followUpArgs = mockInteraction.stubs.followUp.firstCall.args[0]
  t.ok(followUpArgs.content.includes('Error: SSH key attachment is missing.'), 'Reply indicates missing attachment')
  t.equal(followUpArgs.ephemeral, true, 'Error reply is ephemeral')
  t.notOk(updateOneStub.called, 'Repository.updateOne should not be called on missing attachment')

  await teardown(t)
  t.end()
})

test('/add-repo - Encryption Failure', async (t) => {
  await setup(t)
  const mockAttachment = { name: 'valid-but-encrypt-fails.key', url: 'http://mock-key-url.com/valid-key' }
  const mockInteraction = createMockInteraction({ isAdmin: true, attachment: mockAttachment })

  // Temporarily break the encryption key to cause encrypt() to fail
  const originalKey = process.env.ENCRYPTION_KEY
  process.env.ENCRYPTION_KEY = 'shortkey' // Invalid key

  await interactionCreateHandler.execute(mockInteraction)

  process.env.ENCRYPTION_KEY = originalKey // Restore key immediately

  t.ok(mockInteraction.stubs.deferReply.calledOnce, 'deferReply called')
  t.ok(mockInteraction.stubs.followUp.calledOnce, 'followUp called')
  const followUpArgs = mockInteraction.stubs.followUp.firstCall.args[0]
  t.ok(followUpArgs.content.includes('Error processing the SSH key.'), 'Reply indicates processing/encryption error')
  t.equal(followUpArgs.ephemeral, true, 'Error reply is ephemeral')
  t.notOk(updateOneStub.called, 'Repository.updateOne should not be called on encryption failure')

  await teardown(t)
  t.end()
})

test('/add-repo - Database Save Failure (updateOne rejects)', async (t) => {
  await setup(t)
  const mockAttachment = { name: 'id_rsa_dbfail', url: 'http://mock-key-url.com/valid-key' }
  const mockInteraction = createMockInteraction({ isAdmin: true, attachment: mockAttachment })

  // Configure stubs
  distinctStub.withArgs('assignedUserId').resolves([]) // <-- Add configuration for distinct
  const dbError = new Error('Simulated DB write error')
  updateOneStub.rejects(dbError)

  await interactionCreateHandler.execute(mockInteraction)

  t.ok(mockInteraction.stubs.deferReply.calledOnce, 'deferReply called')
  t.ok(distinctStub.calledOnce, 'distinct called before update attempt') // <-- Check distinct was called
  t.ok(mockInteraction.stubs.followUp.calledOnce, 'followUp called')
  const followUpArgs = mockInteraction.stubs.followUp.firstCall.args[0]
  t.ok(followUpArgs.content.includes('An error occurred while saving the repository configuration.'), 'Reply indicates generic DB save error')
  t.equal(followUpArgs.ephemeral, true, 'Error reply is ephemeral')
  t.ok(updateOneStub.calledOnce, 'Repository.updateOne was called before error') // This assertion should now pass

  await teardown(t)
  t.end()
})

// Test other commands are ignored by addrepo logic
test('Interaction Handler - Ignores Other Commands (e.g., ping)', async (t) => {
  await setup(t) // Setup DB connection etc., even if not used by ping
  const mockInteraction = createMockInteraction({ commandName: 'ping', isAdmin: true })

  await interactionCreateHandler.execute(mockInteraction)

  // Ping should reply directly
  t.ok(mockInteraction.stubs.reply.calledOnce, 'ping reply should be called')
  t.equal(mockInteraction.stubs.reply.firstCall.args[0], 'Pong!', 'Should reply Pong! for ping command')
  t.notOk(mockInteraction.stubs.deferReply.called, 'deferReply should not be called for ping')
  t.notOk(mockInteraction.stubs.followUp.called, 'followUp should not be called for ping')
  t.notOk(updateOneStub.called, 'Repository.updateOne should not be called for ping')

  await teardown(t)
  t.end()
})

// --- New Tests for Coder Assignment --- START ---

test('/add-repo - Assigns first coder (coder1) when DB is empty', async (t) => {
  await setup(t)
  const testUrl = 'git@github.com:test/first-coder.git'
  const mockAttachment = { name: 'key1', url: 'http://mock-key-url.com/valid-key' }
  const mockInteraction = createMockInteraction({ isAdmin: true, repoUrl: testUrl, attachment: mockAttachment })

  // Configure stubs
  distinctStub.withArgs('assignedUserId').resolves([]) // No users assigned yet
  updateOneStub.resolves({ acknowledged: true, modifiedCount: 0, upsertedId: new mongoose.Types.ObjectId(), matchedCount: 0 }) // Simulate insert

  await interactionCreateHandler.execute(mockInteraction)

  // Assertions
  t.ok(distinctStub.calledOnceWith('assignedUserId'), 'Repository.distinct("assignedUserId") should be called')
  t.ok(updateOneStub.calledOnce, 'Repository.updateOne should be called')

  const updateCallArgs = updateOneStub.firstCall.args
  t.equal(updateCallArgs[1].$set.assignedUserId, 'coder1', 'updateOne should set assignedUserId to coder1')

  t.ok(mockInteraction.stubs.followUp.calledOnce, 'followUp should be called once')
  const followUpArgs = mockInteraction.stubs.followUp.firstCall.args[0]
  t.ok(followUpArgs.content.includes('Assigned User ID: coder1'), 'FollowUp message should include Assigned User ID: coder1')

  await teardown(t)
  t.end()
})

test('/add-repo - Assigns next available coder (coder3) when coder1 and coder2 are used', async (t) => {
  await setup(t)
  const testUrl = 'git@github.com:test/third-coder.git'
  const mockAttachment = { name: 'key3', url: 'http://mock-key-url.com/valid-key' }
  const mockInteraction = createMockInteraction({ isAdmin: true, repoUrl: testUrl, attachment: mockAttachment, channelId: 'channel-c' })

  // Configure stubs
  distinctStub.withArgs('assignedUserId').resolves(['coder1', 'coder2']) // coder1, coder2 used
  updateOneStub.resolves({ acknowledged: true, modifiedCount: 0, upsertedId: new mongoose.Types.ObjectId(), matchedCount: 0 }) // Simulate insert

  await interactionCreateHandler.execute(mockInteraction)

  // Assertions
  t.ok(distinctStub.calledOnceWith('assignedUserId'), 'Repository.distinct("assignedUserId") should be called')
  t.ok(updateOneStub.calledOnce, 'Repository.updateOne should be called')

  const updateCallArgs = updateOneStub.firstCall.args
  t.equal(updateCallArgs[1].$set.assignedUserId, 'coder3', 'updateOne should set assignedUserId to coder3')

  t.ok(mockInteraction.stubs.followUp.calledOnce, 'followUp should be called once')
  const followUpArgs = mockInteraction.stubs.followUp.firstCall.args[0]
  t.ok(followUpArgs.content.includes('Assigned User ID: coder3'), 'FollowUp message should include Assigned User ID: coder3')

  await teardown(t)
  t.end()
})

test('/add-repo - Fails when coder pool is exhausted', async (t) => {
  await setup(t)
  const testUrl = 'git@github.com:test/too-many-coders.git'
  const mockAttachment = { name: 'key_fail', url: 'http://mock-key-url.com/valid-key' }
  const mockInteraction = createMockInteraction({ isAdmin: true, repoUrl: testUrl, attachment: mockAttachment, channelId: 'channel-exhausted' })

  // Configure stubs
  distinctStub.withArgs('assignedUserId').resolves(CODER_USER_POOL) // All users assigned
  // updateOneStub should *not* be called

  await interactionCreateHandler.execute(mockInteraction)

  // Assertions
  t.ok(distinctStub.calledOnceWith('assignedUserId'), 'Repository.distinct("assignedUserId") should be called')
  t.notOk(updateOneStub.called, 'Repository.updateOne should NOT be called')

  t.ok(mockInteraction.stubs.followUp.calledOnce, 'followUp should be called once with error')
  const followUpArgs = mockInteraction.stubs.followUp.firstCall.args[0]
  t.equal(followUpArgs.content, 'Maximum repository limit reached. Cannot add more repositories.', 'FollowUp message should indicate pool exhaustion')
  t.equal(followUpArgs.ephemeral, true, 'Error reply should be ephemeral')

  await teardown(t)
  t.end()
})

test('/add-repo - Updates repo and confirms correct assigned user ID message', async (t) => {
  await setup(t)
  const testUrl = 'git@github.com:test/update-existing-coder.git'
  const mockAttachment = { name: 'key_upd', url: 'http://mock-key-url.com/valid-key' }
  const existingChannelId = 'channel-update-test'
  const mockInteraction = createMockInteraction({ isAdmin: true, repoUrl: testUrl, attachment: mockAttachment, channelId: existingChannelId })

  // Configure stubs
  distinctStub.withArgs('assignedUserId').resolves(['coder1']) // Only coder1 used initially
  updateOneStub.resolves({ acknowledged: true, modifiedCount: 1, upsertedId: null, matchedCount: 1 }) // Simulate update

  // Mock the findOne().select().lean() call used for update confirmation
  // Need to restore and re-stub the prototype method correctly for this specific call pattern
  sinon.restore() // Restore previous prototype stubs
  updateOneStub = sinon.stub(Repository, 'updateOne').resolves({ acknowledged: true, modifiedCount: 1, upsertedId: null, matchedCount: 1 })
  distinctStub = sinon.stub(Repository, 'distinct').withArgs('assignedUserId').resolves(['coder1'])

  // Stub the specific sequence Repository.findOne({ discordChannelId: existingChannelId }).select('assignedUserId').lean()
  const mockLean = sinon.stub().resolves({ assignedUserId: 'coder1' }) // Simulate existing doc had coder1
  const mockSelect = sinon.stub().returns({ lean: mockLean })
  sinon.stub(Repository, 'findOne').withArgs({ discordChannelId: existingChannelId }).returns({ select: mockSelect })

  await interactionCreateHandler.execute(mockInteraction)

  // Assertions
  t.ok(distinctStub.calledOnce, 'distinct called')
  t.ok(updateOneStub.calledOnce, 'updateOne called')

  const updateCallArgs = updateOneStub.firstCall.args
  t.equal(updateCallArgs[1].$set.assignedUserId, 'coder2', 'updateOne should assign the next available ID (coder2)')

  t.ok(mockInteraction.stubs.followUp.calledOnce, 'followUp called')
  const followUpArgs = mockInteraction.stubs.followUp.firstCall.args[0]
  // It found coder1 used, assigned coder2, updated the repo (modifiedCount=1), and the assignedUserId changed.
  const expectedMessage = `Repository configuration updated: ${testUrl}. New SSH key uploaded. Assigned User ID: coder2.`
  t.equal(followUpArgs.content, expectedMessage, 'FollowUp confirms update and new user assignment with exact message')

  await teardown(t)
  t.end()
})

// --- New Tests for Coder Assignment --- END ---

// --- Test Teardown ---
test('** Teardown Add-Repo Tests **', async (t) => {
  // Teardown is now done within each test block using teardown()
  t.pass('Deferring teardown to individual tests')
  t.end()
})
