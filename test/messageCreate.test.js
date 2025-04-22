const test = require('ava')
const sinon = require('sinon')
// Remove proxyquire - no longer needed
// const proxyquire = require('proxyquire').noCallThru()

// Require the actual handler
const messageCreateHandler = require('../events/messageCreate.js')

const botUserId = 'BOT_USER_ID_123' // Example Bot User ID

// Remove global stubs reference
// let testStubs = {}

// Modified helper to accept necessary stubs
function createMockMessage (content, { stubs, hasGuildId = true, botIsMentioned = true }) {
  // Destructure needed stubs from the passed object
  const { mockReply, mockProcessingMessageDelete, mockProcessingMessageEdit } = stubs

  if (!mockReply || !mockProcessingMessageDelete || !mockProcessingMessageEdit) {
    throw new Error('Required reply stubs not provided to createMockMessage')
  }

  // Reset history for the provided stubs
  mockReply.resetHistory()
  mockProcessingMessageDelete.resetHistory()
  mockProcessingMessageEdit.resetHistory()

  // Simplified mentions stub
  const mentionsStub = sinon.stub()
  mentionsStub.withArgs(botUserId).returns(botIsMentioned)
  mentionsStub.returns(false)

  return {
    content,
    author: { id: 'user-id-123', bot: false },
    guild: hasGuildId ? { id: 'guild-id-456' } : null,
    guildId: hasGuildId ? 'guild-id-456' : undefined,
    channel: { id: 'channel-id-789', send: sinon.stub() },
    mentions: {
      users: { has: mentionsStub },
      roles: { has: sinon.stub().returns(false) },
      channels: { has: sinon.stub().returns(false) },
      everyone: false,
      has: mentionsStub
    },
    reply: mockReply // Use the passed-in stub
  }
}

// beforeEach to setup stubs
test.beforeEach(t => {
  process.env.ENCRYPTION_KEY = '12345678901234567890123456789012'

  // Create stubs locally for the test context
  const mockReply = sinon.stub()
  const mockProcessingMessageDelete = sinon.stub().resolves()
  const mockProcessingMessageEdit = sinon.stub().resolves()

  // Configure the mockReply stub
  mockReply.returns({
    edit: mockProcessingMessageEdit,
    delete: mockProcessingMessageDelete
  })

  // Store all stubs, including reply ones, on context
  t.context.stubs = {
    Repository: { findOne: sinon.stub() },
    crypto: { decrypt: sinon.stub() },
    secureKeys: { writeTempKey: sinon.stub(), deleteTempKey: sinon.stub() },
    gitHelper: { gitAddAll: sinon.stub(), gitCommit: sinon.stub(), gitPush: sinon.stub(), cleanupRepoDir: sinon.stub() },
    pythonWrapper: { invokeAiderWrapper: sinon.stub() },
    constants: { BOT_USER_ID: botUserId },
    config: { repoBaseDir: '/tmp/vibehive-repos' },
    // Include reply stubs within the main stubs object for convenience if desired
    mockReply,
    mockProcessingMessageDelete,
    mockProcessingMessageEdit
  }

  // Optionally, keep direct access on context if preferred for assertions
  t.context.mockReply = mockReply
  t.context.mockProcessingMessageDelete = mockProcessingMessageDelete
  t.context.mockProcessingMessageEdit = mockProcessingMessageEdit
})

// --- Test Cases (Modified to pass stubs to createMockMessage) ---

test.serial('execute: ignores message if not mentioned', async t => {
  // Pass the relevant stubs from context to the helper
  const message = createMockMessage('hello there', { stubs: t.context, botIsMentioned: false })
  await messageCreateHandler.execute(message, t.context.stubs)

  t.false(t.context.mockReply.called)
  t.false(t.context.stubs.Repository.findOne.called)
})

test.serial('execute: ignores message if bot author', async t => {
  const message = createMockMessage(`<@${botUserId}> do stuff`, { stubs: t.context, botIsMentioned: true })
  message.author.bot = true
  await messageCreateHandler.execute(message, t.context.stubs)

  t.false(t.context.mockReply.called)
  t.false(t.context.stubs.Repository.findOne.called)
})

test.serial('execute: replies if mention has no prompt', async t => {
  const message = createMockMessage(`<@${botUserId}>`, { stubs: t.context, botIsMentioned: true })
  await messageCreateHandler.execute(message, t.context.stubs)

  t.true(t.context.mockReply.calledOnce)
  t.true(t.context.mockReply.calledWithMatch({ content: sinon.match(/provide a prompt after the mention/) }))
  t.false(t.context.mockProcessingMessageDelete.called)
  t.false(t.context.mockProcessingMessageEdit.called)
})

test.serial('execute: replies if no repo config found', async t => {
  const message = createMockMessage(`<@${botUserId}> do thing`, { stubs: t.context, botIsMentioned: true })
  message.channel = { id: 'channel-id-789', send: sinon.stub() }
  t.context.stubs.Repository.findOne.resolves(null)
  await messageCreateHandler.execute(message, t.context.stubs)

  t.true(t.context.stubs.Repository.findOne.calledOnceWith({ discordChannelId: message.channel.id }))
  t.true(t.context.mockReply.calledOnce)
  t.true(t.context.mockReply.calledWithMatch({ content: sinon.match(/No repository configured/), ephemeral: true }))
  t.false(t.context.mockProcessingMessageDelete.called)
  t.false(t.context.mockProcessingMessageEdit.called)
})

test.serial('execute: Success with Changes - runs wrapper, detects changes, calls git ops, replies', async t => {
  // Pass context stubs to helper
  const message = createMockMessage(`<@${botUserId}> change the file`, { stubs: t.context, botIsMentioned: true })
  const mockRepo = {
    _id: 'repo-id-123',
    discordChannelId: message.channel.id,
    repoUrl: 'git@github.com:test/repo.git',
    encryptedSshKey: 'enc-key-data',
    assignedUserId: 'coder-success',
    contextFiles: ['file1.js'],
    repoName: `guild-id-456-${message.channel.id}`
  }
  const mockWrapperResult = {
    overall_status: 'success',
    events: [
      { type: 'file_change', file_path: 'file1.js' },
      { type: 'text_response', content: 'Made the change!' }
    ],
    stdout: 'Some output from script',
    stderr: ''
  }
  const tempKeyPath = '/tmp/coder-success/repo-key'
  const expectedBranch = `aider/channel-${message.channel.id}`
  const expectedCommitMsg = 'FEAT: Aider changes based on prompt: "change the file"'

  // Configure stubs on context
  t.context.stubs.Repository.findOne.resolves(mockRepo)
  t.context.stubs.pythonWrapper.invokeAiderWrapper.resolves(mockWrapperResult)
  t.context.stubs.crypto.decrypt.returns('decrypted-key')
  t.context.stubs.secureKeys.writeTempKey.resolves(tempKeyPath)
  t.context.stubs.gitHelper.gitAddAll.resolves()
  t.context.stubs.gitHelper.gitCommit.resolves()
  t.context.stubs.gitHelper.gitPush.resolves()
  t.context.stubs.secureKeys.deleteTempKey.resolves()
  t.context.stubs.gitHelper.cleanupRepoDir.resolves() // Stub cleanup

  await messageCreateHandler.execute(message, t.context.stubs)

  // Verify calls using context stubs
  t.true(t.context.stubs.Repository.findOne.calledOnce)
  t.true(t.context.stubs.pythonWrapper.invokeAiderWrapper.calledOnce)
  t.true(t.context.stubs.crypto.decrypt.calledOnce)
  t.true(t.context.stubs.secureKeys.writeTempKey.calledOnce)
  t.true(t.context.stubs.gitHelper.gitAddAll.calledOnce)
  t.true(t.context.stubs.gitHelper.gitCommit.calledOnce)
  t.true(t.context.stubs.gitHelper.gitPush.calledOnce)

  // Verify git calls in order using context stubs.gitHelper
  sinon.assert.callOrder(
    t.context.stubs.gitHelper.gitAddAll,
    t.context.stubs.gitHelper.gitCommit,
    t.context.stubs.gitHelper.gitPush
  )
  t.true(t.context.stubs.gitHelper.gitAddAll.calledOnceWith(sinon.match({ assignedUserId: 'coder-success' })))
  t.true(t.context.stubs.gitHelper.gitCommit.calledOnceWith(sinon.match({ message: expectedCommitMsg })))
  t.true(t.context.stubs.gitHelper.gitPush.calledOnceWith(sinon.match({ branchName: expectedBranch })))

  // Verify cleanup using context stubs
  t.true(t.context.stubs.secureKeys.deleteTempKey.calledOnceWith(sinon.match({ ownerUserId: 'coder-success' })))
  t.true(t.context.stubs.gitHelper.cleanupRepoDir.calledOnce)

  // --- Verify Reply ---
  t.true(t.context.mockReply.calledOnce, 'message.reply should be called only once for initial message')
  t.true(t.context.mockProcessingMessageEdit.calledOnce, 'processingMessage.edit should be called once with final result')
  t.true(t.context.mockProcessingMessageEdit.calledWithMatch({ content: sinon.match(/Made the change!/) }))
  t.true(t.context.mockProcessingMessageEdit.calledWithMatch({ content: sinon.match(/✅ _Changes also pushed to branch/) }))
  t.true(t.context.mockProcessingMessageEdit.calledWithMatch({ content: sinon.match(new RegExp(`\`${expectedBranch}\`\\._$`)) }))
  t.true(t.context.mockProcessingMessageDelete.calledOnce, 'processingMessage.delete should be called once')
})

test.serial('execute: Success without Changes - runs wrapper, skips git ops, replies', async t => {
  const message = createMockMessage(`<@${botUserId}> check the file`, { stubs: t.context, botIsMentioned: true })
  const mockRepo = {
    discordChannelId: message.channel.id,
    repoUrl: '...',
    encryptedSshKey: '...',
    assignedUserId: 'coder-nochange',
    contextFiles: [],
    repoName: `guild-id-456-${message.channel.id}`
  }
  const mockWrapperResult = {
    overall_status: 'success',
    events: [
      { type: 'text_response', content: 'File looks good!' }
    ],
    stdout: '',
    stderr: ''
  }

  t.context.stubs.Repository.findOne.resolves(mockRepo)
  t.context.stubs.pythonWrapper.invokeAiderWrapper.resolves(mockWrapperResult)
  t.context.stubs.gitHelper.cleanupRepoDir.resolves()

  await messageCreateHandler.execute(message, t.context.stubs)

  t.true(t.context.stubs.pythonWrapper.invokeAiderWrapper.calledOnce)
  t.false(t.context.stubs.gitHelper.gitAddAll.called)
  t.false(t.context.stubs.gitHelper.gitCommit.called)
  t.false(t.context.stubs.gitHelper.gitPush.called)
  t.false(t.context.stubs.crypto.decrypt.called)
  t.false(t.context.stubs.secureKeys.writeTempKey.called)
  t.false(t.context.stubs.secureKeys.deleteTempKey.called)
  t.true(t.context.stubs.gitHelper.cleanupRepoDir.calledOnce)

  // --- Verify Reply ---
  t.true(t.context.mockReply.calledOnce, 'Initial reply should be called once')
  t.true(t.context.mockProcessingMessageEdit.calledOnce, 'Final edit should be called once')
  const editCallArgs = t.context.mockProcessingMessageEdit.firstCall.args[0]
  t.is(editCallArgs.content, 'File looks good!')
  t.false(editCallArgs.content.includes('_Changes also pushed_'))
  t.true(t.context.mockProcessingMessageDelete.calledOnce, 'Processing message should be deleted')
})

test.serial('execute: Git Push Fails - runs wrapper, attempts git ops, replies with error, cleans up key', async t => {
  const message = createMockMessage(`<@${botUserId}> change the file`, { stubs: t.context, botIsMentioned: true })
  const mockRepo = {
    discordChannelId: message.channel.id,
    repoUrl: '...',
    encryptedSshKey: 'enc-key-data',
    assignedUserId: 'coder-fail',
    contextFiles: ['f.js'],
    repoName: `guild-id-456-${message.channel.id}`
  }
  const mockWrapperResult = {
    overall_status: 'success',
    events: [{ type: 'file_change', file_path: 'f.js' }],
    stdout: '',
    stderr: ''
  }
  const gitPushError = new Error('Permission denied')
  const tempKeyPath = '/tmp/coder-fail/key'

  t.context.stubs.Repository.findOne.resolves(mockRepo)
  t.context.stubs.pythonWrapper.invokeAiderWrapper.resolves(mockWrapperResult)
  t.context.stubs.crypto.decrypt.returns('decrypted-key')
  t.context.stubs.secureKeys.writeTempKey.resolves(tempKeyPath)
  t.context.stubs.gitHelper.gitAddAll.resolves()
  t.context.stubs.gitHelper.gitCommit.resolves()
  t.context.stubs.gitHelper.gitPush.rejects(gitPushError)
  t.context.stubs.secureKeys.deleteTempKey.resolves()
  t.context.stubs.gitHelper.cleanupRepoDir.resolves()

  await messageCreateHandler.execute(message, t.context.stubs)

  // Verify sequence up to push
  t.true(t.context.stubs.pythonWrapper.invokeAiderWrapper.calledOnce)
  t.true(t.context.stubs.crypto.decrypt.calledOnce)
  t.true(t.context.stubs.secureKeys.writeTempKey.calledOnce)
  t.true(t.context.stubs.gitHelper.gitAddAll.calledOnce)
  t.true(t.context.stubs.gitHelper.gitCommit.calledOnce)
  t.true(t.context.stubs.gitHelper.gitPush.calledOnce)

  // --- Verify Reply and Cleanup ---
  t.true(t.context.mockReply.calledOnce, 'message.reply should be called only once for initial processing message')
  t.true(t.context.mockProcessingMessageEdit.calledOnce, 'processingMessage.edit should be called once with the final error message')
  t.true(t.context.mockProcessingMessageEdit.calledWithMatch({ content: sinon.match(/❌ Changes applied by Aider locally/) }), 'Final edit content should contain git error prefix')
  t.true(t.context.mockProcessingMessageEdit.calledWithMatch({ content: sinon.match(gitPushError.message) }), 'Final edit content should contain the specific git error message')
  t.true(t.context.mockProcessingMessageDelete.calledOnce, 'processingMessage.delete should be called once')
  t.true(t.context.stubs.secureKeys.deleteTempKey.calledOnce)
  t.true(t.context.stubs.gitHelper.cleanupRepoDir.calledOnce)
})

test.serial('execute: Aider Wrapper Fails - skips git ops, replies with error', async t => {
  const message = createMockMessage(`<@${botUserId}> do something complex`, { stubs: t.context, botIsMentioned: true })
  const mockRepo = {
    discordChannelId: message.channel.id,
    repoUrl: '...',
    encryptedSshKey: '...',
    assignedUserId: 'coder-wrapper-fail',
    contextFiles: [],
    repoName: `guild-id-456-${message.channel.id}`
  }
  const mockWrapperResult = { overall_status: 'error', error: 'Aider crashed spectacularly' }

  t.context.stubs.Repository.findOne.resolves(mockRepo)
  t.context.stubs.pythonWrapper.invokeAiderWrapper.resolves(mockWrapperResult)
  t.context.stubs.gitHelper.cleanupRepoDir.resolves()

  await messageCreateHandler.execute(message, t.context.stubs)

  t.true(t.context.stubs.pythonWrapper.invokeAiderWrapper.calledOnce)
  t.false(t.context.stubs.gitHelper.gitAddAll.called)
  t.false(t.context.stubs.gitHelper.gitCommit.called)
  t.false(t.context.stubs.gitHelper.gitPush.called)
  t.false(t.context.stubs.crypto.decrypt.called)
  t.false(t.context.stubs.secureKeys.writeTempKey.called)
  t.false(t.context.stubs.secureKeys.deleteTempKey.called)
  t.true(t.context.stubs.gitHelper.cleanupRepoDir.calledOnce)

  // --- Verify Reply ---
  t.true(t.context.mockReply.calledOnce, 'Initial reply should be called once')
  t.true(t.context.mockProcessingMessageEdit.calledOnce, 'Final edit should be called once')
  const editCallArgs = t.context.mockProcessingMessageEdit.firstCall.args[0]
  t.true(editCallArgs.content.includes('Sorry, there was an error processing your request with the script:'), 'Final edit should contain the script error prefix')
  t.true(editCallArgs.content.includes(mockWrapperResult.error), 'Final edit should contain the specific wrapper error')
  t.true(t.context.mockProcessingMessageDelete.calledOnce, 'Processing message should be deleted')
})
