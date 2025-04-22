const test = require('ava')
const sinon = require('sinon')
const proxyquire = require('proxyquire').noCallThru()
const path = require('node:path') // Mock or use real path? Let's use real for now.

// --- Stubs ---
let interactionCreateEvent
let mockGitHelper
let mockAider
let mockRepository
let mockCrypto
let mockSecureKeys
let mockConfig

// Mock interaction/message objects
const createMockInteraction = ({ channelId = 'channel123', guildId = 'guild456', userPrompt = 'test prompt', isChatInputCommand = true } = {}) => ({
  channelId,
  guildId,
  isChatInputCommand: () => isChatInputCommand, // Make it a function to match Discord.js v14+
  options: {
    getString: sinon.stub().withArgs('prompt').returns(userPrompt)
  },
  deferReply: sinon.stub().resolves(),
  followUp: sinon.stub().resolves({ // Mock the message object returned by followUp/reply
    edit: sinon.stub().resolves()
  })
  // Add other interaction methods if needed by the handler
})

const createMockMessage = ({ channelId = 'channel123', guildId = 'guild456', content = '<@BOT_ID> test prompt', author = { bot: false, tag: 'user#1234' }, client = { user: { id: 'BOT_ID' } } } = {}) => ({
  channelId,
  guildId,
  content,
  author,
  client, // Needed for mention check
  mentions: { // Mock mentions object
    has: sinon.stub().callsFake(user => user === client.user) // Simple check if mentioned user is the client's user
  },
  reply: sinon.stub().resolves({ // Mock the message object returned by followUp/reply
    edit: sinon.stub().resolves()
  })
  // Add other message properties if needed by the handler
})

test.beforeEach(t => {
  // Reset stubs before each test
  mockGitHelper = {
    gitAddAll: sinon.stub().resolves(),
    gitCommit: sinon.stub().resolves(),
    gitPush: sinon.stub().resolves()
  }
  mockAider = {
    invokeAiderWrapper: sinon.stub().resolves({ // Default success with no changes
      stdout: 'Aider output',
      stderr: '',
      error: null,
      data: {
        overall_status: 'success',
        events: []
      }
    })
  }
  mockRepository = {
    findOne: sinon.stub().resolves({ // Default valid repo config
      discordChannelId: 'channel123',
      repoUrl: 'git@github.com:test/repo.git',
      encryptedSshKey: 'encrypted-key',
      assignedUserId: 'coder1',
      contextFiles: ['file1.txt']
    }),
    distinct: sinon.stub().resolves(['coder2']), // For add-repo user assignment if needed elsewhere
    updateOne: sinon.stub().resolves({ acknowledged: true, modifiedCount: 1, upsertedId: null }) // General purpose mock
  }
  mockCrypto = {
    decrypt: sinon.stub().withArgs('encrypted-key').returns('decrypted-key'),
    encrypt: sinon.stub().returns('encrypted-key') // For add-repo if needed elsewhere
  }
  mockSecureKeys = {
    writeTempKey: sinon.stub().resolves('/tmp/mock-key-path'),
    deleteTempKey: sinon.stub().resolves()
  }
  // Simple mock config - adjust if specific values are needed
  mockConfig = {
    repoBaseDir: '/app/repos',
    coderUserPool: ['coder1', 'coder2', 'coder3', 'coder4', 'coder5']
  }

  // Load the module under test using proxyquire
  interactionCreateEvent = proxyquire(require.resolve('../events/interactionCreate'), {
    '../lib/gitHelper': mockGitHelper,
    '../lib/aider': mockAider,
    '../models/Repository': mockRepository,
    '../lib/crypto': mockCrypto,
    '../lib/secureKeys': mockSecureKeys,
    '../config': mockConfig,
    'node:path': path, // Use real path module
    'node:fs/promises': { // Mock fs if needed, e.g., by handleAddRepoCommand
      mkdir: sinon.stub().resolves(),
      rm: sinon.stub().resolves()
    },
    'node:child_process': { // Mock child_process if needed, e.g., by handleAddRepoCommand
      execFileSync: sinon.stub(),
      spawn: sinon.stub().returns({ // Mock spawn for handleAddRepoCommand
        stdout: { on: sinon.stub() },
        stderr: { on: sinon.stub() },
        on: sinon.stub().callsFake((event, cb) => {
          if (event === 'close') {
            // Simulate successful clone by default for add-repo tests
            process.nextTick(() => cb(null))
          }
        })
      })
    },
    'discord.js': { // Mock discord.js if necessary (e.g., for permissions) - keep minimal
      Events: { InteractionCreate: 'interactionCreate' } // Just need the name
    },
    // Mock fetch if needed by handleAddRepoCommand
    fetch: sinon.stub().resolves({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: sinon.stub().resolves('ssh-key-content')
    })
  })

  // Add global fetch mock
  global.fetch = sinon.stub().resolves({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: sinon.stub().resolves('ssh-key-content')
  })
})

test.afterEach.always(t => {
  sinon.restore()
})

// --- Test Stubs ---

test.serial('handleMentionInteraction - Success with file changes - Git ops called', async t => {
  // Arrange: Setup mocks for this specific scenario
  // Mock invokeAiderWrapper to return success with file changes
  // Mock interaction/message

  // Act: Call handleMentionInteraction (either via execute or directly if exported)

  // Assert: Check mocks were called correctly
  // t.true(mockGitHelper.gitAddAll.calledOnce)
  // t.true(mockGitHelper.gitCommit.calledOnce)
  // t.true(mockGitHelper.gitPush.calledOnce)
  // Assert correct arguments (repoPath, userId, env, message, branchName)
  // Assert deleteTempKey called
  // Assert final reply message is correct
  t.pass('Implement test')
})

test.serial('handleMentionInteraction - Success without file changes - Git ops skipped', async t => {
  // Arrange: Setup mocks (default aider result is no changes)
  // Mock interaction/message

  // Act: Call handleMentionInteraction

  // Assert: Check Git helpers were NOT called
  // t.false(mockGitHelper.gitAddAll.called)
  // t.false(mockGitHelper.gitCommit.called)
  // t.false(mockGitHelper.gitPush.called)
  // Assert deleteTempKey NOT called
  // Assert final reply message is correct
  t.pass('Implement test')
})

test.serial('handleMentionInteraction - Git Push Fails - Error message contains branch, cleanup runs', async t => {
  // Arrange: Setup mocks for success with changes, but gitPush rejects
  // Mock invokeAiderWrapper for success with changes
  // Mock gitPush to reject
  // Mock interaction/message

  // Act: Call handleMentionInteraction

  // Assert: Check gitAddAll/gitCommit called
  // t.true(mockGitHelper.gitAddAll.calledOnce)
  // t.true(mockGitHelper.gitCommit.calledOnce)
  // t.true(mockGitHelper.gitPush.calledOnce)
  // Assert deleteTempKey WAS called (finally block)
  // Assert final reply message shows push failure and branch name
  t.pass('Implement test')
})

test.serial('handleMentionInteraction - Aider Wrapper Fails - Git ops skipped', async t => {
  // Arrange: Mock invokeAiderWrapper to return error status
  // Mock interaction/message

  // Act: Call handleMentionInteraction

  // Assert: Check Git helpers were NOT called
  // t.false(mockGitHelper.gitAddAll.called)
  // Assert deleteTempKey NOT called
  // Assert final reply message indicates Aider failure
  t.pass('Implement test')
})

test.serial('handleMentionInteraction - Missing repo config - Returns error', async t => {
  // Arrange: Mock Repository.findOne to return null
  // Mock interaction/message

  // Act: Call handleMentionInteraction

  // Assert: Check final reply indicates missing config
  // Assert Git helpers NOT called
  t.pass('Implement test')
})

test.serial('handleMentionInteraction - Decrypt Fails - Error message shown, cleanup runs', async t => {
  // Arrange: Mock invokeAiderWrapper for success with changes
  // Mock crypto.decrypt to return null or throw
  // Mock interaction/message

  // Act: Call handleMentionInteraction

  // Assert: Check gitAddAll NOT called
  // Assert deleteTempKey WAS called (finally block)
  // Assert final reply message indicates decrypt failure
  t.pass('Implement test')
})

test.serial('handleMentionInteraction - writeTempKey Fails - Error message shown, cleanup skipped', async t => {
  // Arrange: Mock invokeAiderWrapper for success with changes
  // Mock secureKeys.writeTempKey to reject
  // Mock interaction/message

  // Act: Call handleMentionInteraction

  // Assert: Check gitAddAll NOT called
  // Assert deleteTempKey NOT called (keyFilePath is null)
  // Assert final reply message indicates key writing failure
  t.pass('Implement test')
})

// --- Tests for other commands (if adding here) ---

test.serial('Execute - routes /ping command', async t => {
  const mockInteraction = {
    inGuild: () => true,
    isChatInputCommand: () => true,
    commandName: 'ping',
    reply: sinon.stub().resolves()
    // Minimal required fields for this path
  }
  await interactionCreateEvent.execute(mockInteraction)
  t.true(mockInteraction.reply.calledOnceWith('Pong!'))
})

// Add more tests for add-repo, files, add, drop if needed, focusing on mocking dependencies
// and asserting calls/replies. Example for add-repo:

test.serial('Execute - routes /add-repo command and calls handler', async t => {
  const mockInteraction = createMockInteraction() // Use helper
  mockInteraction.commandName = 'add-repo'
  mockInteraction.member = { permissions: { has: sinon.stub().withArgs('Administrator').returns(true) } } // Mock permissions
  mockInteraction.options.getAttachment = sinon.stub().withArgs('ssh_key').returns({ url: 'http://fake.url/key.txt' })
  mockInteraction.options.getString = sinon.stub().withArgs('repository').returns('git@github.com:test/new-repo.git')
  // Ensure required methods for handler
  mockInteraction.inGuild = () => true
  mockInteraction.isChatInputCommand = () => true

  await interactionCreateEvent.execute(mockInteraction)

  // Basic check: Was Repository.updateOne called? (Indicates handler logic likely ran)
  t.true(mockRepository.updateOne.called)
  // Could add more specific assertions about clone command spawn, key writing etc.
})

test.serial('handleMessage - Ignores messages from bots', async t => {
  const mockMsg = createMockMessage({ author: { bot: true, tag: 'bot#0000' } })
  // Spy on the internal handleMentionInteraction if possible, or check mocks aren't called
  await interactionCreateEvent.handleMessage(mockMsg)

  // Best we can do is check that dependencies weren't called
  t.false(mockRepository.findOne.called)
  t.false(mockAider.invokeAiderWrapper.called)
})

test.serial('handleMessage - Ignores messages without mention', async t => {
  const mockMsg = createMockMessage({ content: 'hello world' })
  mockMsg.mentions.has = sinon.stub().returns(false) // Ensure mention check fails

  await interactionCreateEvent.handleMessage(mockMsg)

  t.false(mockRepository.findOne.called)
  t.false(mockAider.invokeAiderWrapper.called)
})

test.serial('handleMessage - Calls handleMentionInteraction for valid mention', async t => {
  const mockMsg = createMockMessage() // Uses default valid mention setup

  // Can't directly spy on handleMentionInteraction easily with proxyquire.
  // Instead, check that the first step inside handleMentionInteraction was called.
  await interactionCreateEvent.handleMessage(mockMsg)

  t.true(mockRepository.findOne.called) // Check if findOne was called as indicator
})
