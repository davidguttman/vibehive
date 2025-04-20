const test = require('tape')
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

const setup = async () => {
  mongoServer = await MongoMemoryServer.create()
  mongoUri = mongoServer.getUri()
  await mongoose.connect(mongoUri)
  await Repository.deleteMany({}) // Clear before seeding
  await Repository.create({
    discordChannelId: 'channel-with-repo',
    repoUrl: 'https://github.com/test/repo.git'
  })
}

const teardown = async () => {
  await mongoose.disconnect()
  if (mongoServer) {
    await mongoServer.stop()
  }
}

// --- Stubs ---
// Stubs are now managed within each test's sandbox
// let invokeAiderStub;
// let replyStub;
// let sendStub; // For channel.send

// --- Test Cases ---

test.onFinish(async () => { // Ensure teardown runs even if tests fail
  await teardown()
})

// Use a sandbox for each test block to manage stubs
test('Mention Handler Tests', async (t) => {
  await setup() // Setup DB once for this block

  t.test('Setup Complete', async (st) => {
    st.pass('In-memory DB started and seeded')
    st.end()
  })

  t.test('Ignores Bot Messages', async (st) => {
    st.plan(1)
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
    st.ok(mockInvokeAiderWrapper.notCalled, 'invokeAiderWrapper should NOT be called for bot messages')
    sandbox.restore()
  })

  t.test('No Mention', async (st) => {
    st.plan(1)
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
    st.ok(mockInvokeAiderWrapper.notCalled, 'invokeAiderWrapper should NOT be called if bot is not mentioned')
    sandbox.restore()
  })

  t.test('Mention, No Repo Configured', async (st) => {
    st.plan(2)
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
    st.ok(replyStub.calledOnce, 'reply should be called once for "not configured" message') // Simplified check
    st.ok(mockInvokeAiderWrapper.notCalled, 'invokeAiderWrapper should NOT be called when no repo is configured')
    sandbox.restore()
  })

  t.test('Mention, Repo Found, Wrapper Called Successfully', async (st) => {
    st.plan(5)
    const sandbox = sinon.createSandbox()
    // Arrange
    const mockSuccessResult = { status: 'success', data: { events: [{ type: 'text_response', content: 'Mocked AI response' }] } }
    const mockInvokeAiderWrapper = sandbox.stub().resolves(mockSuccessResult)
    const { handleMessageCreate } = proxyquire('../index', {
      './lib/pythonWrapper': { invokeAiderWrapper: mockInvokeAiderWrapper }
    })
    const deleteStub = sandbox.stub().resolves()
    const replyStub = sandbox.stub().resolves({ delete: deleteStub })
    const sendStub = sandbox.stub().resolves()
    const mockMessage = {
      author: { bot: false, id: 'user-id', tag: 'User#1234', username: 'TestUser' },
      mentions: { has: (user) => user.id === mockClient.user.id },
      content: `<@${mockClient.user.id}> do the thing`,
      channelId: 'channel-with-repo',
      reply: replyStub,
      channel: { send: sendStub, id: 'channel-with-repo' }
    }

    // Act
    await handleMessageCreate(mockClient, mockMessage)
    await new Promise(resolve => setImmediate(resolve))

    // Assert
    st.ok(replyStub.calledOnceWith('Processing your request...'), 'Should send initial "Processing" reply')
    st.ok(mockInvokeAiderWrapper.calledOnce, 'invokeAiderWrapper should be called once')
    st.ok(mockInvokeAiderWrapper.calledWith({ prompt: 'do the thing' }), 'invokeAiderWrapper called with correct prompt')
    st.ok(sendStub.calledOnceWithMatch(/Mocked AI response/), 'channel.send should be called with wrapper result')
    st.ok(deleteStub.calledOnce, 'Processing message should be deleted')
    sandbox.restore()
  })

  t.test('Mention, Repo Found, Wrapper Fails', async (st) => {
    st.plan(4)
    const sandbox = sinon.createSandbox()
    // Arrange
    const mockFailureResult = { status: 'failure', error: 'Simulated python error' }
    const mockInvokeAiderWrapper = sandbox.stub().resolves(mockFailureResult)
    const { handleMessageCreate } = proxyquire('../index', {
      './lib/pythonWrapper': { invokeAiderWrapper: mockInvokeAiderWrapper }
    })
    const deleteStub = sandbox.stub().resolves()
    const replyStub = sandbox.stub().resolves({ delete: deleteStub })
    const sendStub = sandbox.stub().resolves()
    const mockMessage = {
      author: { bot: false, id: 'user-id', tag: 'User#1234', username: 'FailUser' },
      mentions: { has: (user) => user.id === mockClient.user.id },
      content: `<@${mockClient.user.id}> trigger failure`,
      channelId: 'channel-with-repo',
      reply: replyStub,
      channel: { send: sendStub, id: 'channel-with-repo' }
    }

    // Act
    await handleMessageCreate(mockClient, mockMessage)
    await new Promise(resolve => setImmediate(resolve))

    // Assert
    st.ok(replyStub.calledOnceWith('Processing your request...'), 'Should send initial "Processing" reply')
    st.ok(mockInvokeAiderWrapper.calledOnce, 'invokeAiderWrapper should be called once')
    st.ok(sendStub.calledOnceWithMatch(/error processing your request for @FailUser: Simulated python error/i), 'channel.send should be called with error message')
    st.ok(deleteStub.calledOnce, 'Processing message should be deleted')
    sandbox.restore()
  })

  t.test('Mention Only (No Prompt)', async (st) => {
    st.plan(2)
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
    st.ok(mockInvokeAiderWrapper.notCalled, 'invokeAiderWrapper should NOT be called for mention only')
    st.ok(replyStub.calledOnceWithMatch(/didn't provide a prompt/i), 'Should reply with "no prompt" message')
    sandbox.restore()
  })

  // Teardown is handled by test.onFinish for the outer block
  t.end() // End the wrapping test block
})
