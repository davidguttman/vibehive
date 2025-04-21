const test = require('ava')
const sinon = require('sinon')
const { EventEmitter } = require('events') // To mock client
const { MongoMemoryServer } = require('mongodb-memory-server')
const mongoose = require('mongoose')
const proxyquire = require('proxyquire') // Added proxyquire

// Modules to test/stub
const Repository = require('../models/Repository') // Real model
// We don't need to require pythonWrapper directly anymore for stubbing handleMessageCreate
// const { handleMessageCreate } = require('../index') // Removed direct require

// --- Mock Objects ---
const mockClient = new EventEmitter() // Simulate Discord client events
mockClient.user = { id: 'mock-bot-id', tag: 'MockBot#0000' }
mockClient.application = { id: 'mock-app-id' } // Often needed internally

// --- In-Memory DB Setup ---
let mongoServer
let mongoUri

test.before('Setup DB', async t => {
  mongoServer = await MongoMemoryServer.create()
  mongoUri = mongoServer.getUri()
  await mongoose.connect(mongoUri)
  await Repository.deleteMany({}) // Clear before seeding
  await Repository.create({
    discordChannelId: 'channel-with-repo',
    repoUrl: 'https://github.com/test/repo.git',
    contextFiles: ['README.md', 'lib/main.js'] // Seed context files
  })
  t.pass('In-memory DB started and seeded')
})

test.after.always('Teardown DB', async t => {
  await mongoose.disconnect()
  if (mongoServer) {
    await mongoServer.stop()
  }
  t.pass('DB disconnected and stopped')
})

// --- Stubs ---
// Stubs are now managed within each test's sandbox
// let invokeAiderStub;
// let replyStub;
// let sendStub; // For channel.send

// --- Test Cases ---

test.serial('Ignores Bot Messages', async (t) => {
  const sandbox = sinon.createSandbox()
  // Arrange
  const mockInvokeAiderWrapper = sandbox.stub().resolves({ status: 'success', data: {} }) // Mock stub
  // Load index.js with the stubbed dependency
  const { handleMessageCreate } = proxyquire('../index', {
    './lib/pythonWrapper': { invokeAiderWrapper: mockInvokeAiderWrapper }
    // Note: Path must exactly match the require path in index.js
  })
  const mockMessage = {
    author: { bot: true },
    mentions: { has: () => false },
    content: 'Regular message',
    channelId: 'any-channel',
    reply: sandbox.fake(),
    channel: { send: sandbox.fake(), id: 'mock-channel-id' }
  }

  // Act
  await handleMessageCreate(mockClient, mockMessage)
  await new Promise(resolve => setImmediate(resolve))

  // Assert
  t.falsy(mockInvokeAiderWrapper.called, 'invokeAiderWrapper should NOT be called for bot messages')
  sandbox.restore()
})

test.serial('No Mention', async (t) => {
  const sandbox = sinon.createSandbox()
  // Arrange
  const mockInvokeAiderWrapper = sandbox.stub().resolves({ status: 'success', data: {} })
  const { handleMessageCreate } = proxyquire('../index', {
    './lib/pythonWrapper': { invokeAiderWrapper: mockInvokeAiderWrapper }
  })
  const mockMessage = {
    author: { bot: false, id: 'user-id', tag: 'User#1234' },
    mentions: { has: () => false }, // Bot NOT mentioned
    content: 'Regular message without mention',
    channelId: 'any-channel',
    reply: sandbox.fake(),
    channel: { send: sandbox.fake(), id: 'mock-channel-id' }
  }

  // Act
  await handleMessageCreate(mockClient, mockMessage)
  await new Promise(resolve => setImmediate(resolve))

  // Assert
  t.falsy(mockInvokeAiderWrapper.called, 'invokeAiderWrapper should NOT be called if bot is not mentioned')
  sandbox.restore()
})

test.serial('Mention, No Repo Configured', async (t) => {
  const sandbox = sinon.createSandbox()
  // Arrange
  const mockInvokeAiderWrapper = sandbox.stub().resolves({ status: 'success', data: {} })
  const replyStub = sandbox.stub().resolves() // Stub returns a resolving promise
  const { handleMessageCreate } = proxyquire('../index', {
    './lib/pythonWrapper': { invokeAiderWrapper: mockInvokeAiderWrapper }
  })
  const mockMessage = {
    author: { bot: false, id: 'user-id', tag: 'User#1234' },
    mentions: { has: (user) => user.id === mockClient.user.id },
    content: `<@${mockClient.user.id}> what is this channel?`,
    channelId: 'channel-without-repo',
    reply: replyStub,
    channel: { send: sandbox.fake(), id: 'mock-channel-id' }
  }

  // Act
  await handleMessageCreate(mockClient, mockMessage)
  await new Promise(resolve => setImmediate(resolve))

  // Assert
  t.truthy(replyStub.calledOnce, 'reply should be called once for "not configured" message')
  t.falsy(mockInvokeAiderWrapper.called, 'invokeAiderWrapper should NOT be called when no repo is configured')
  sandbox.restore()
})

test.serial('Mention, Repo Found, Wrapper Called Successfully (Text Response)', async (t) => {
  const sandbox = sinon.createSandbox()
  // Arrange
  const mockSuccessResult = {
    status: 'success',
    data: {
      overall_status: 'success',
      events: [{ type: 'text_response', content: 'Mocked AI response' }]
    }
  }
  const mockInvokeAiderWrapper = sandbox.stub().resolves(mockSuccessResult)
  const { handleMessageCreate } = proxyquire('../index', {
    './lib/pythonWrapper': { invokeAiderWrapper: mockInvokeAiderWrapper }
  })
  const deleteStub = sandbox.stub().resolves()
  const replyStub = sandbox.stub().resolves({ delete: deleteStub })
  const mockMessage = {
    author: { bot: false, id: 'user-id', tag: 'User#1234', username: 'TestUser' },
    mentions: { has: (user) => user.id === mockClient.user.id },
    content: `<@${mockClient.user.id}> do the thing`,
    channelId: 'channel-with-repo',
    reply: replyStub,
    channel: { send: sandbox.fake(), id: 'channel-with-repo' }
  }

  // Act
  await handleMessageCreate(mockClient, mockMessage)
  await new Promise(resolve => setImmediate(resolve))

  // Assert
  t.truthy(replyStub.calledWith('Processing your request...'), 'Should send initial "Processing" reply')
  t.truthy(mockInvokeAiderWrapper.calledOnce, 'invokeAiderWrapper should be called once')
  const expectedArgs = { prompt: 'do the thing', contextFiles: ['README.md', 'lib/main.js'] } // Expect context files
  t.deepEqual(mockInvokeAiderWrapper.firstCall.args[0], expectedArgs, 'invokeAiderWrapper called with correct prompt and context files')
  t.truthy(replyStub.calledWithMatch(/\*\*Response for @TestUser:\*\*/), 'Should send final response reply')
  t.truthy(deleteStub.calledOnce, 'Processing message should be deleted')
  sandbox.restore()
})

test.serial('Mention, Repo Found, Wrapper Fails (Execution Error)', async (t) => {
  const sandbox = sinon.createSandbox()
  // Arrange
  const mockFailureResult = { status: 'failure', error: 'Simulated python execution error', stdout: 'stdout info' }
  const mockInvokeAiderWrapper = sandbox.stub().resolves(mockFailureResult)
  const { handleMessageCreate } = proxyquire('../index', {
    './lib/pythonWrapper': { invokeAiderWrapper: mockInvokeAiderWrapper }
  })
  const deleteStub = sandbox.stub().resolves()
  const replyStub = sandbox.stub().resolves({ delete: deleteStub })
  const mockMessage = {
    author: { bot: false, id: 'user-id', tag: 'User#1234', username: 'FailUser' },
    mentions: { has: (user) => user.id === mockClient.user.id },
    content: `<@${mockClient.user.id}> trigger failure`,
    channelId: 'channel-with-repo',
    reply: replyStub,
    channel: { send: sandbox.fake(), id: 'channel-with-repo' }
  }

  // Act
  await handleMessageCreate(mockClient, mockMessage)
  await new Promise(resolve => setImmediate(resolve))

  // Assert
  t.truthy(replyStub.calledWith('Processing your request...'), 'Should send initial "Processing" reply')
  t.truthy(mockInvokeAiderWrapper.calledOnce, 'invokeAiderWrapper should be called once')
  const expectedArgs = { prompt: 'trigger failure', contextFiles: ['README.md', 'lib/main.js'] } // Expect context files
  t.deepEqual(mockInvokeAiderWrapper.firstCall.args[0], expectedArgs, 'invokeAiderWrapper called with correct prompt and context files even on failure')
  t.truthy(replyStub.calledWithMatch(/❌ An error occurred while processing your request\. Details logged\./), 'Should reply with generic wrapper error message')
  t.truthy(deleteStub.calledOnce, 'Processing message should be deleted')
  sandbox.restore()
})

test.serial('Mention, Repo Found, Script Fails (overall_status: failure)', async (t) => {
  const sandbox = sinon.createSandbox()
  // Arrange
  const mockScriptFailureResult = {
    status: 'success',
    data: {
      overall_status: 'failure',
      error: 'Simulated script error within Python',
      events: []
    }
  }
  const mockInvokeAiderWrapper = sandbox.stub().resolves(mockScriptFailureResult)
  const { handleMessageCreate } = proxyquire('../index', {
    './lib/pythonWrapper': { invokeAiderWrapper: mockInvokeAiderWrapper }
  })
  const deleteStub = sandbox.stub().resolves()
  const replyStub = sandbox.stub().resolves({ delete: deleteStub })
  const mockMessage = {
    author: { bot: false, id: 'user-id', tag: 'User#1234', username: 'ScriptFailUser' },
    mentions: { has: (user) => user.id === mockClient.user.id },
    content: `<@${mockClient.user.id}> trigger script failure`,
    channelId: 'channel-with-repo',
    reply: replyStub,
    channel: { send: sandbox.fake(), id: 'channel-with-repo' }
  }

  // Act
  await handleMessageCreate(mockClient, mockMessage)
  await new Promise(resolve => setImmediate(resolve))

  // Assert
  t.truthy(replyStub.calledWith('Processing your request...'), 'Should send initial "Processing" reply')
  t.truthy(mockInvokeAiderWrapper.calledOnce, 'invokeAiderWrapper should be called once')
  const expectedArgs = { prompt: 'trigger script failure', contextFiles: ['README.md', 'lib/main.js'] } // Expect context files
  t.deepEqual(mockInvokeAiderWrapper.firstCall.args[0], expectedArgs, 'invokeAiderWrapper called with correct prompt and context files even on script failure')
  t.truthy(replyStub.calledWithMatch(/❌ An error occurred within the script execution\. Details logged\./), 'Should reply with generic script error message')
  t.truthy(deleteStub.calledOnce, 'Processing message should be deleted')
  sandbox.restore()
})

test.serial('Mention, Repo Found, Success but No Text Response', async (t) => {
  const sandbox = sinon.createSandbox()
  // Arrange
  const mockNoTextResult = {
    status: 'success',
    data: {
      overall_status: 'success',
      events: [{ type: 'other_event', detail: 'something happened' }]
    }
  }
  const mockInvokeAiderWrapper = sandbox.stub().resolves(mockNoTextResult)
  const { handleMessageCreate } = proxyquire('../index', {
    './lib/pythonWrapper': { invokeAiderWrapper: mockInvokeAiderWrapper }
  })
  const deleteStub = sandbox.stub().resolves()
  const replyStub = sandbox.stub().resolves({ delete: deleteStub })
  const mockMessage = {
    author: { bot: false, id: 'user-id', tag: 'User#1234', username: 'NoTextUser' },
    mentions: { has: (user) => user.id === mockClient.user.id },
    content: `<@${mockClient.user.id}> trigger no text output`,
    channelId: 'channel-with-repo',
    reply: replyStub,
    channel: { send: sandbox.fake(), id: 'channel-with-repo' }
  }

  // Act
  await handleMessageCreate(mockClient, mockMessage)
  await new Promise(resolve => setImmediate(resolve))

  // Assert
  t.truthy(replyStub.calledWith('Processing your request...'), 'Should send initial "Processing" reply')
  t.truthy(mockInvokeAiderWrapper.calledOnce, 'invokeAiderWrapper should be called once')
  t.truthy(replyStub.calledWithMatch(/✅ Process completed successfully, but no text output was generated\./), 'Should reply with "success, no text" message')
  t.truthy(deleteStub.calledOnce, 'Processing message should be deleted')
  sandbox.restore()
})

test.serial('Mention Only (No Prompt)', async (t) => {
  const sandbox = sinon.createSandbox()
  // Arrange
  const mockInvokeAiderWrapper = sandbox.stub().resolves({ status: 'success', data: {} })
  const { handleMessageCreate } = proxyquire('../index', {
    './lib/pythonWrapper': { invokeAiderWrapper: mockInvokeAiderWrapper }
  })
  const replyStub = sandbox.stub().resolves()
  const mockMessage = {
    author: { bot: false, id: 'user-id', tag: 'User#1234' },
    mentions: { has: (user) => user.id === mockClient.user.id },
    content: `<@${mockClient.user.id}>`, // Just the mention
    channelId: 'channel-with-repo',
    reply: replyStub,
    channel: { send: sandbox.fake(), id: 'channel-with-repo' }
  }

  // Act
  await handleMessageCreate(mockClient, mockMessage)
  await new Promise(resolve => setImmediate(resolve))

  // Assert
  t.falsy(mockInvokeAiderWrapper.called, 'invokeAiderWrapper should NOT be called for mention only')
  t.truthy(replyStub.calledOnceWithMatch(/didn't provide a prompt/i), 'Should reply with "no prompt" message')
  sandbox.restore()
})
