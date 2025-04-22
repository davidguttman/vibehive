const test = require('ava')
const sinon = require('sinon')
const proxyquire = require('proxyquire').noCallThru()

const botUserId = 'BOT_USER_ID_123' // Example Bot User ID

// Global stubs reference for the helper
let testStubs = {}

// Modified helper to use stubs from testStubs
// NOTE: Removed default values for hasGuildId and botIsMentioned in destructuring
//       to avoid potential test errors if options object is not passed.
//       Tests should explicitly pass options like { botIsMentioned: true }.
function createMockMessage (content, options = {}) {
  const { hasGuildId = true, botIsMentioned = true } = options
  if (!testStubs.mockReply || !testStubs.mockProcessingMessageDelete || !testStubs.mockProcessingMessageEdit) {
    throw new Error('Test stubs not initialized for createMockMessage')
  }
  // Use stubs passed via testStubs object
  const mockReply = testStubs.mockReply
  const mockProcessingMessageDelete = testStubs.mockProcessingMessageDelete
  const mockProcessingMessageEdit = testStubs.mockProcessingMessageEdit

  // Configure the first call to reply to return the object with delete/edit stubs
  mockReply.reset() // Reset history before configuring
  mockProcessingMessageDelete.reset() // Reset history
  mockProcessingMessageEdit.reset() // Reset history

  mockReply.onFirstCall().resolves({
    delete: mockProcessingMessageDelete,
    edit: mockProcessingMessageEdit
  })
  // DO NOT add a default resolves() for subsequent calls to catch unexpected calls

  // Simplified mentions stub for clarity
  const mentionsStub = sinon.stub()
  mentionsStub.withArgs(botUserId).returns(botIsMentioned)
  mentionsStub.returns(false) // Default to false for any other mention check

  return {
    content,
    author: { id: 'user-id-123', bot: false },
    guild: hasGuildId ? { id: 'guild-id-456' } : null,
    guildId: hasGuildId ? 'guild-id-456' : undefined,
    // Using the actual reply stub here is crucial
    channel: { id: 'channel-id-789', send: sinon.stub() }, // Keep separate channel.send if needed elsewhere? Seems unused by execute.
    // Ensure mentions structure matches discord.js v14+
    mentions: {
      users: {
        has: mentionsStub // Use the configured stub
      },
      roles: { // Add roles stub if needed, defaulting to false
        has: sinon.stub().returns(false)
      },
      channels: { // Add channels stub if needed
        has: sinon.stub().returns(false)
      },
      everyone: false, // Assuming not @everyone
      // A general 'has' might check users/roles, adjust stub if logic depends on this
      has: mentionsStub // Re-use user mention stub for simplicity if okay
    },
    reply: mockReply // Use the stub from testStubs
  }
}

// --- Global Stubs Setup ---
// Moved outside beforeEach for clarity, reset within beforeEach
// let stubs = {} // Replaced by testStubs pattern

// beforeEach to setup stubs and proxyquire
test.beforeEach(t => {
  // Reset global stubs object and create fresh stubs for this test
  testStubs = {
    mockReply: sinon.stub(),
    mockProcessingMessageDelete: sinon.stub().resolves(),
    mockProcessingMessageEdit: sinon.stub().resolves(),
    // Keep other stubs setup as before
    Repository: { findOne: sinon.stub() },
    crypto: { decrypt: sinon.stub() },
    secureKeys: { writeTempKey: sinon.stub(), deleteTempKey: sinon.stub() },
    gitHelper: { gitAddAll: sinon.stub(), gitCommit: sinon.stub(), gitPush: sinon.stub(), cleanupRepoDir: sinon.stub() },
    pythonWrapper: { invokeAiderWrapper: sinon.stub() },
    client: { // Mock client structure as needed by messageCreate
      channels: {
        cache: {
          get: sinon.stub().returns({ send: sinon.stub() }) // Default mock channel/send
        }
      }
    }
  }

  // Store stubs on context for easy access in assertions
  t.context.stubs = testStubs

  // Proxyquire the module with all stubs
  // Make sure the path to the module under test is correct
  t.context.execute = proxyquire('../events/messageCreate.js', {
    '../models/repository.js': testStubs.Repository,
    '../lib/crypto.js': testStubs.crypto,
    '../lib/secure-keys.js': testStubs.secureKeys,
    '../lib/git-helper.js': testStubs.gitHelper,
    '../lib/python-wrapper.js': testStubs.pythonWrapper,
    '../config/constants.js': { BOT_USER_ID: botUserId },
    // Assuming discord-client setup is correct and used internally if needed
    '../lib/discord-client.js': { getClient: () => testStubs.client }
    // No need to override createMockMessage here, it's a test helper
  })

  // Add stubs to context for direct use in tests if preferred, e.g., t.context.mockReply
  // This duplicates t.context.stubs but can make test assertions slightly shorter
  t.context.mockReply = testStubs.mockReply
  t.context.mockProcessingMessageDelete = testStubs.mockProcessingMessageDelete
  t.context.mockProcessingMessageEdit = testStubs.mockProcessingMessageEdit
})

// --- Test Cases ---

test.serial('execute: ignores message if not mentioned', async t => {
  // Use the global createMockMessage which now correctly uses testStubs
  const message = createMockMessage('hello there', { botIsMentioned: false })
  await t.context.execute(message)

  // Verify no reply happens
  t.false(t.context.mockReply.called)
  // Verify no DB lookup happens
  t.false(t.context.stubs.Repository.findOne.called)
})

test.serial('execute: ignores message if bot author', async t => {
  const message = createMockMessage(`<@${botUserId}> do stuff`, { botIsMentioned: true })
  message.author.bot = true // Set author as bot

  await t.context.execute(message)

  t.false(t.context.mockReply.called)
  t.false(t.context.stubs.Repository.findOne.called)
})

test.serial('execute: replies if mention has no prompt', async t => {
  const message = createMockMessage(`<@${botUserId}>`, { botIsMentioned: true })

  await t.context.execute(message)

  // Check the specific reply for no prompt
  t.true(t.context.mockReply.calledOnce)
  t.true(t.context.mockReply.calledWithMatch({ content: sinon.match(/provide a prompt after the mention/) }))
  // Ensure processing message wasn't interacted with (no delete/edit)
  t.false(t.context.mockProcessingMessageDelete.called)
  t.false(t.context.mockProcessingMessageEdit.called)
})

test.serial('execute: replies if no repo config found', async t => {
  const message = createMockMessage(`<@${botUserId}> do thing`, { botIsMentioned: true })
  // Setup DB stub *before* calling createMockMessage if it affects message creation (it doesn't here)
  t.context.stubs.Repository.findOne.resolves(null)

  await t.context.execute(message)

  t.true(t.context.stubs.Repository.findOne.calledOnceWith({ discordChannelId: message.channel.id }))
  // Check the specific reply for no repo config
  t.true(t.context.mockReply.calledOnce)
  t.true(t.context.mockReply.calledWithMatch({ content: sinon.match(/No repository configured/), ephemeral: true }))
  // Ensure processing message wasn't interacted with
  t.false(t.context.mockProcessingMessageDelete.called)
  t.false(t.context.mockProcessingMessageEdit.called)
})

test.serial('execute: Success with Changes - runs wrapper, detects changes, calls git ops, replies', async t => {
  const message = createMockMessage(`<@${botUserId}> change the file`, { botIsMentioned: true })
  const mockRepo = {
    _id: 'repo-id-123',
    discordChannelId: message.channel.id,
    repoUrl: 'git@github.com:test/repo.git',
    encryptedSshKey: 'enc-key-data',
    assignedUserId: 'coder-success',
    contextFiles: ['file1.js']
  }
  const mockWrapperResult = {
    overall_status: 'success',
    events: [
      { type: 'file_change', file_path: 'file1.js' },
      { type: 'text_response', content: 'Made the change!' }
    ],
    stdout: 'Some output from script', // Add stdout if messageCreate uses it
    stderr: '' // Add stderr if messageCreate uses it
  }
  const tempKeyPath = '/tmp/coder-success/repo-key'
  const expectedBranch = `aider/channel-${message.channel.id}`
  const expectedCommitMsg = 'FEAT: Aider changes based on prompt: "change the file"'

  // Configure stub behaviors using t.context.stubs
  t.context.stubs.Repository.findOne.resolves(mockRepo)
  t.context.stubs.pythonWrapper.invokeAiderWrapper.resolves(mockWrapperResult)
  t.context.stubs.crypto.decrypt.returns('decrypted-key')
  t.context.stubs.secureKeys.writeTempKey.resolves(tempKeyPath)
  t.context.stubs.gitHelper.gitAddAll.resolves()
  t.context.stubs.gitHelper.gitCommit.resolves()
  t.context.stubs.gitHelper.gitPush.resolves()
  t.context.stubs.secureKeys.deleteTempKey.resolves()
  t.context.stubs.gitHelper.cleanupRepoDir.resolves() // Stub cleanup

  await t.context.execute(message)

  // Verify calls using t.context.stubs
  t.true(t.context.stubs.Repository.findOne.calledOnceWith({ discordChannelId: message.channel.id }))
  // Ensure repoConfig is passed correctly
  t.true(t.context.stubs.pythonWrapper.invokeAiderWrapper.calledOnceWith(sinon.match({
    prompt: 'change the file',
    contextFiles: ['file1.js'],
    repoConfig: mockRepo // Check the whole object or specific properties
  })))
  t.true(t.context.stubs.crypto.decrypt.calledOnceWith('enc-key-data'))
  t.true(t.context.stubs.secureKeys.writeTempKey.calledOnceWith(sinon.match({ repoName: `${message.guildId}-${message.channel.id}`, keyContent: 'decrypted-key', ownerUserId: 'coder-success' })))

  // Verify git calls in order using t.context.stubs.gitHelper
  sinon.assert.callOrder(
    t.context.stubs.gitHelper.gitAddAll,
    t.context.stubs.gitHelper.gitCommit,
    t.context.stubs.gitHelper.gitPush
  )
  // Verify args using t.context.stubs.gitHelper
  t.true(t.context.stubs.gitHelper.gitAddAll.calledOnceWith(sinon.match({ assignedUserId: 'coder-success' })))
  t.true(t.context.stubs.gitHelper.gitCommit.calledOnceWith(sinon.match({ message: expectedCommitMsg })))
  t.true(t.context.stubs.gitHelper.gitPush.calledOnceWith(sinon.match({ branchName: expectedBranch })))

  // Verify cleanup using t.context.stubs
  t.true(t.context.stubs.secureKeys.deleteTempKey.calledOnceWith(sinon.match({ ownerUserId: 'coder-success' })))
  t.true(t.context.stubs.gitHelper.cleanupRepoDir.calledOnce) // Verify repo cleanup

  // --- Verify Reply ---
  // Initial reply ("Processing...") should be called once.
  t.true(t.context.mockReply.calledOnce, 'message.reply should be called only once for initial message')

  // The initial message should have been EDITED with the final success message.
  t.true(t.context.mockProcessingMessageEdit.calledOnce, 'processingMessage.edit should be called once with final result')
  // Check the final reply content (includes original response + git push confirmation).
  t.true(t.context.mockProcessingMessageEdit.calledWithMatch({ content: sinon.match(/Made the change!/) }), 'Final edit should contain the wrapper response')
  t.true(t.context.mockProcessingMessageEdit.calledWithMatch({ content: sinon.match(/✅ _Changes also pushed to branch/) }), 'Final edit should contain the git push confirmation')
  t.true(t.context.mockProcessingMessageEdit.calledWithMatch({ content: sinon.match(new RegExp(`\`${expectedBranch}\`\\._$`)) }), 'Final edit should mention the correct branch name') // Regex check for branch name

  // The initial message should have been DELETED after the edit.
  t.true(t.context.mockProcessingMessageDelete.calledOnce, 'processingMessage.delete should be called once')
})

test.serial('execute: Success without Changes - runs wrapper, skips git ops, replies', async t => {
  const message = createMockMessage(`<@${botUserId}> check the file`, { botIsMentioned: true })
  const mockRepo = { discordChannelId: message.channel.id, repoUrl: '...', encryptedSshKey: '...', assignedUserId: 'coder-nochange', contextFiles: [] }
  const mockWrapperResult = {
    overall_status: 'success',
    events: [ // No file_change event
      { type: 'text_response', content: 'File looks good!' }
    ],
    stdout: '',
stderr: ''
  }

  t.context.stubs.Repository.findOne.resolves(mockRepo)
  t.context.stubs.pythonWrapper.invokeAiderWrapper.resolves(mockWrapperResult)
  t.context.stubs.gitHelper.cleanupRepoDir.resolves() // Stub cleanup

  await t.context.execute(message)

  t.true(t.context.stubs.pythonWrapper.invokeAiderWrapper.calledOnce)
  // Verify git helpers were NOT called
  t.false(t.context.stubs.gitHelper.gitAddAll.called)
  t.false(t.context.stubs.gitHelper.gitCommit.called)
  t.false(t.context.stubs.gitHelper.gitPush.called)
  // Verify SSH key functions were NOT called (as no git ops needed)
  t.false(t.context.stubs.crypto.decrypt.called)
  t.false(t.context.stubs.secureKeys.writeTempKey.called)
  t.false(t.context.stubs.secureKeys.deleteTempKey.called)
  t.true(t.context.stubs.gitHelper.cleanupRepoDir.calledOnce) // Cleanup still happens

  // --- Verify Reply ---
  t.true(t.context.mockReply.calledOnce, 'Initial reply should be called once')
  t.true(t.context.mockProcessingMessageEdit.calledOnce, 'Final edit should be called once')
  // Check the content of the *edit* call
  const editCallArgs = t.context.mockProcessingMessageEdit.firstCall.args[0]
  t.is(editCallArgs.content, 'File looks good!', 'Final edit content should be exactly the wrapper response')
  t.false(editCallArgs.content.includes('_Changes also pushed_'), 'Final edit content should not include push confirmation')

  t.true(t.context.mockProcessingMessageDelete.calledOnce, 'Processing message should be deleted')
})

test.serial('execute: Git Push Fails - runs wrapper, attempts git ops, replies with error, cleans up key', async t => {
  const message = createMockMessage(`<@${botUserId}> change the file`, { botIsMentioned: true })
  const mockRepo = { discordChannelId: message.channel.id, repoUrl: '...', encryptedSshKey: 'enc-key-data', assignedUserId: 'coder-fail', contextFiles: ['f.js'] }
  const mockWrapperResult = {
    overall_status: 'success',
    events: [{ type: 'file_change', file_path: 'f.js' }], // Ensure change is detected
    stdout: '',
stderr: ''
  }
  const gitPushError = new Error('Permission denied') // Define error locally
  const tempKeyPath = '/tmp/coder-fail/key'

  // Setup stubs via t.context.stubs
  t.context.stubs.Repository.findOne.resolves(mockRepo)
  t.context.stubs.pythonWrapper.invokeAiderWrapper.resolves(mockWrapperResult)
  t.context.stubs.crypto.decrypt.returns('decrypted-key')
  t.context.stubs.secureKeys.writeTempKey.resolves(tempKeyPath)
  t.context.stubs.gitHelper.gitAddAll.resolves()
  t.context.stubs.gitHelper.gitCommit.resolves()
  t.context.stubs.gitHelper.gitPush.rejects(gitPushError) // <--- Push fails
  t.context.stubs.secureKeys.deleteTempKey.resolves()
  t.context.stubs.gitHelper.cleanupRepoDir.resolves() // Stub cleanup

  await t.context.execute(message)

  // Verify sequence up to push
  t.true(t.context.stubs.pythonWrapper.invokeAiderWrapper.calledOnce)
  t.true(t.context.stubs.crypto.decrypt.calledOnce)
  t.true(t.context.stubs.secureKeys.writeTempKey.calledOnce)
  t.true(t.context.stubs.gitHelper.gitAddAll.calledOnce)
  t.true(t.context.stubs.gitHelper.gitCommit.calledOnce)
  t.true(t.context.stubs.gitHelper.gitPush.calledOnce) // Push was attempted

  // --- Verify Reply and Cleanup ---
  // Verify initial reply called once
  t.true(t.context.mockReply.calledOnce, 'message.reply should be called only once for initial processing message')

  // Verify the processing message was EDITED with the final error
  t.true(t.context.mockProcessingMessageEdit.calledOnce, 'processingMessage.edit should be called once with the final error message')
  // Check the content of the edit
  t.true(t.context.mockProcessingMessageEdit.calledWithMatch({ content: sinon.match(/Error during Git operations/) }), 'Final edit content should contain git error prefix')
  // Use the specific error message from the locally defined error
  t.true(t.context.mockProcessingMessageEdit.calledWithMatch({ content: sinon.match(gitPushError.message) }), 'Final edit content should contain the specific git error message')

  // Verify the processing message itself was deleted AFTER the edit
  t.true(t.context.mockProcessingMessageDelete.calledOnce, 'processingMessage.delete should be called once')
  // Ensure delete was called *after* edit if order matters (it likely does for user experience)
  // sinon.assert.callOrder(t.context.mockProcessingMessageEdit, t.context.mockProcessingMessageDelete) // Optional: Enforce order

  // IMPORTANT: Verify the FINALLY block ran and cleaned up the key and repo dir
  t.true(t.context.stubs.secureKeys.deleteTempKey.calledOnce)
  t.true(t.context.stubs.gitHelper.cleanupRepoDir.calledOnce) // Verify repo cleanup happened even on error
})

test.serial('execute: Aider Wrapper Fails - skips git ops, replies with error', async t => {
  const message = createMockMessage(`<@${botUserId}> do something complex`, { botIsMentioned: true })
  const mockRepo = { discordChannelId: message.channel.id, repoUrl: '...', encryptedSshKey: '...', assignedUserId: 'coder-wrapper-fail', contextFiles: [] }
  const mockWrapperResult = { // Simulate wrapper result indicating an error
    overall_status: 'error',
    error: 'Aider crashed spectacularly', // Specific error message
    stdout: '...',
stderr: 'Traceback...' // Include potential output
  }

  t.context.stubs.Repository.findOne.resolves(mockRepo)
  t.context.stubs.pythonWrapper.invokeAiderWrapper.resolves(mockWrapperResult) // Resolves, but with error status
  t.context.stubs.gitHelper.cleanupRepoDir.resolves() // Stub cleanup

  await t.context.execute(message)

  t.true(t.context.stubs.pythonWrapper.invokeAiderWrapper.calledOnce)
  // Verify git helpers were NOT called because wrapper failed before git stage
  t.false(t.context.stubs.gitHelper.gitAddAll.called)
  t.false(t.context.stubs.gitHelper.gitCommit.called)
  t.false(t.context.stubs.gitHelper.gitPush.called)
  // Key ops also shouldn't happen
  t.false(t.context.stubs.crypto.decrypt.called)
  t.false(t.context.stubs.secureKeys.writeTempKey.called)
  t.false(t.context.stubs.secureKeys.deleteTempKey.called) // Key cleanup might not happen if write didn't
  t.true(t.context.stubs.gitHelper.cleanupRepoDir.calledOnce) // Repo cleanup should still happen

  // --- Verify Reply ---
  t.true(t.context.mockReply.calledOnce, 'Initial reply should be called once')
  t.true(t.context.mockProcessingMessageEdit.calledOnce, 'Final edit should be called once')

  // Check the content of the *edit* call for the wrapper error message
  const editCallArgs = t.context.mockProcessingMessageEdit.firstCall.args[0]
  t.true(editCallArgs.content.includes('Error processing your request with the script:'), 'Final edit should contain the script error prefix')
  t.true(editCallArgs.content.includes(mockWrapperResult.error), 'Final edit should contain the specific wrapper error')
  // Check if it should be ephemeral (original test had this, but edit can't be ephemeral)
  // The original reply might have been ephemeral, but the edit updates it.
  // Let's assume the final message shouldn't be ephemeral unless explicitly stated.

  t.true(t.context.mockProcessingMessageDelete.calledOnce, 'Processing message should be deleted')
})
