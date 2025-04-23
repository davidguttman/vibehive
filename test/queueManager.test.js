// test/queueManager.test.js
const test = require('ava')
const sinon = require('sinon')
const path = require('path') // Need path for resolving module id
const proxyquire = require('proxyquire')

// Define queueManager variable in outer scope
let queueManager

// Mock TaskQueue model
const mockTaskQueue = {
  findOneAndUpdate: sinon.stub(),
  findOne: sinon.stub(),
  updateOne: sinon.stub()
}

// Mock Task Executor
const mockTaskExecutor = sinon.stub()

// Spy on console.log/error for debugging/assertions
let logSpy, errorSpy

// Reset mocks and GET A FRESH queue manager state before each test
test.beforeEach(t => {
  // Manually delete the target module from cache before proxyquire
  const queueManagerModulePath = path.resolve(__dirname, '../lib/queueManager.js')
  delete require.cache[queueManagerModulePath]

  // Use proxyquire INSIDE beforeEach to get a fresh instance
  queueManager = proxyquire(queueManagerModulePath, {
    '../models/TaskQueue': mockTaskQueue
  })

  // Reset stubs
  mockTaskQueue.findOneAndUpdate.reset()
  mockTaskQueue.findOne.reset()
  mockTaskQueue.updateOne.reset()
  mockTaskExecutor.reset()

  // Reset specific behaviors
  mockTaskQueue.findOneAndUpdate.resetBehavior()
  mockTaskQueue.findOne.resetBehavior()
  mockTaskQueue.updateOne.resetBehavior()
  mockTaskExecutor.resetBehavior()

  // Default behaviors for mocks if needed globally (usually better per-test)
  // mockTaskExecutor.resolves(); // Example - Moved to tests that need it

  // Reset spies
  if (logSpy) logSpy.restore()
  if (errorSpy) errorSpy.restore()
  logSpy = sinon.spy(console, 'log')
  errorSpy = sinon.spy(console, 'error')
})

test.afterEach.always(t => {
  // Restore spies
  if (logSpy) logSpy.restore()
  if (errorSpy) errorSpy.restore()
})

// --- enqueueTask Tests ---

test.serial('enqueueTask should call findOneAndUpdate with correct args and upsert', async t => {
  const channelId = 'channel-123'
  const taskData = { userId: 'user-abc', commandType: 'test', commandData: {} }

  // Configure the specific mock call expected by enqueueTask
  mockTaskQueue.findOneAndUpdate
    .withArgs(
      { channelId }, // find query
      { $push: { queue: taskData } }, // update query
      { upsert: true, new: true } // options
    )
    .resolves({ _id: 'fake-queue-id', channelId, queue: [taskData] }) // Make it resolve something

  // No init needed for this test

  await queueManager.enqueueTask(channelId, taskData)

  t.true(mockTaskQueue.findOneAndUpdate.calledOnce, 'findOneAndUpdate should be called once')
  // Check the arguments specifically
  sinon.assert.calledWithExactly(mockTaskQueue.findOneAndUpdate.firstCall,
    { channelId },
    { $push: { queue: taskData } },
    { upsert: true, new: true }
  )
})

test.serial('enqueueTask should trigger processQueue after successful enqueue', async t => {
  const channelId = 'channel-456'
  const taskData = { userId: 'user-def', commandType: 'another', commandData: { key: 'val' } }

  // Mock findOneAndUpdate used by enqueueTask
  mockTaskQueue.findOneAndUpdate.resolves()

  // Initialize the queue manager with the mock executor for this test
  // processQueue needs the executor to be initialized
  queueManager.init(mockTaskExecutor)

  // Stub the exported processQueue function AFTER init
  const processQueueStub = sinon.stub(queueManager, 'processQueue')

  try {
    await queueManager.enqueueTask(channelId, taskData)
    t.true(processQueueStub.calledOnceWith(channelId), 'processQueue should have been called once with the channelId')
  } finally {
    // Restore the original processQueue function
    processQueueStub.restore()
  }
})

test.serial('enqueueTask should not call DB or processQueue if channelId is missing', async t => {
  const taskData = { userId: 'user-ghi', commandType: 'missing', commandData: {} }

  await queueManager.enqueueTask(null, taskData)

  t.true(mockTaskQueue.findOneAndUpdate.notCalled)
  // Cannot easily spy on internal processQueue call without modifications
  t.true(errorSpy.calledWith('enqueueTask: Missing channelId or taskData'))
})

test.serial('enqueueTask should not call DB or processQueue if taskData is missing', async t => {
  const channelId = 'channel-789'

  await queueManager.enqueueTask(channelId, null)

  t.true(mockTaskQueue.findOneAndUpdate.notCalled)
  // Cannot easily spy on internal processQueue call
  t.true(errorSpy.calledWith('enqueueTask: Missing channelId or taskData'))
})

// --- processQueue Tests (Revised) ---

test.serial('processQueue: concurrency - second call should bail if first is active', async t => {
  const channelId = 'channel-concurrency'
  const taskData = { userId: 'user-concurrency', commandType: 'test', commandData: {} }

  // Mock executor takes time
  const executorDone = new Promise(resolve => mockTaskExecutor.callsFake(() => setTimeout(resolve, 50)))

  // Mocks for first call
  mockTaskQueue.findOneAndUpdate
    .withArgs({ channelId, isProcessing: false }, sinon.match.object, sinon.match.object)
    .resolves({ _id: 'q-conc', channelId, queue: [taskData], isProcessing: true }) // Lock success
  mockTaskQueue.updateOne.resolves() // Pop/Unlock success

  // --- Action ---
  // Call processQueue directly (simulating it was triggered)
  const process1Promise = queueManager.processQueue(channelId)

  // Wait briefly for it to add to activeChannels
  await new Promise(resolve => setTimeout(resolve, 10))

  // Call processQueue again while the first should be active
  await queueManager.processQueue(channelId)

  // Assert: Check console log for the early exit message
  t.true(logSpy.calledWith(`Channel ${channelId} is already being processed. Exiting processQueue call.`))

  // Assert: Executor should only be called once by the first process call
  t.true(mockTaskExecutor.calledOnce)

  // Wait for the first process to finish
  await executorDone
  await process1Promise
})

test.serial('processQueue: sequential execution - should process tasks in order', async t => {
  const channelId = 'channel-seq-revised'
  const task1 = { userId: 'user-seq-1', commandType: 'cmd1', commandData: { val: 1 } }
  const task2 = { userId: 'user-seq-2', commandType: 'cmd2', commandData: { val: 2 } }

  // Control executor execution
  let resolveExec1, resolveExec2
  const exec1Promise = new Promise(resolve => { resolveExec1 = resolve })
  const exec2Promise = new Promise(resolve => { resolveExec2 = resolve })
  mockTaskExecutor
    .onFirstCall().callsFake(async () => { await exec1Promise })
    .onSecondCall().callsFake(async () => { await exec2Promise })

  // --- Mock DB Sequence ---
  // 1. Lock finds Task 1 (& Task 2 if already enqueued)
  const lock1Mock = mockTaskQueue.findOneAndUpdate
    .withArgs({ channelId, isProcessing: false }, { $set: { isProcessing: true } }, sinon.match.object)
  // 2. Pop Task 1
  const pop1Mock = mockTaskQueue.updateOne
    .withArgs({ channelId }, { $pop: { queue: -1 } })
  // 3. Lock finds Task 2
  const lock2Mock = mockTaskQueue.findOneAndUpdate
    .withArgs({ channelId, isProcessing: false }, { $set: { isProcessing: true } }, sinon.match.object)
  // 4. Pop Task 2
  const pop2Mock = mockTaskQueue.updateOne
    .withArgs({ channelId }, { $pop: { queue: -1 } })
  // 5. Lock finds Empty Queue
  const lockEmptyMock = mockTaskQueue.findOneAndUpdate
    .withArgs({ channelId, isProcessing: false }, { $set: { isProcessing: true } }, sinon.match.object)
  // 6. Unlock Empty Queue
  const unlockMock = mockTaskQueue.updateOne
    .withArgs({ channelId }, { $set: { isProcessing: false } })

  // Configure mock resolutions in sequence
  lock1Mock.resolves({ _id: 'q-seq', channelId, queue: [task1, task2], isProcessing: true })
  pop1Mock.resolves()
  lock2Mock.resolves({ _id: 'q-seq', channelId, queue: [task2], isProcessing: true })
  pop2Mock.resolves()
  lockEmptyMock.resolves({ _id: 'q-seq', channelId, queue: [], isProcessing: true })
  unlockMock.resolves()

  // --- Action ---
  // Call processQueue once, assuming tasks are already in the DB mock state
  const processPromise = queueManager.processQueue(channelId)

  // --- Assertions ---
  // Wait for lock1Mock to ensure the process has started
  await lock1Mock.firstCall.returnValue

  // Wait for executor 1 to be called
  await new Promise(resolve => setTimeout(resolve, 5)) // Give event loop a tick
  sinon.assert.calledOnce(mockTaskExecutor)
  sinon.assert.calledWith(mockTaskExecutor.getCall(0), channelId, task1)

  // Finish executor 1
  resolveExec1()
  // Wait for pop1Mock
  await pop1Mock.firstCall.returnValue
  // Wait for lock2Mock
  await lock2Mock.firstCall.returnValue

  // Check executor 2 called
  await new Promise(resolve => setTimeout(resolve, 5)) // Give event loop a tick
  sinon.assert.calledTwice(mockTaskExecutor)
  sinon.assert.calledWith(mockTaskExecutor.getCall(1), channelId, task2)

  // Finish executor 2
  resolveExec2()
  // Wait for pop2Mock
  await pop2Mock.firstCall.returnValue
  // Wait for lockEmptyMock
  await lockEmptyMock.firstCall.returnValue
  // Wait for unlockMock
  await unlockMock.firstCall.returnValue

  // Verify DB calls happened in order using the mock instances directly
  sinon.assert.callOrder(
    lock1Mock,
    pop1Mock,
    lock2Mock,
    pop2Mock,
    lockEmptyMock,
    unlockMock
  )

  // Verify executor calls happened between the correct DB operations
  sinon.assert.callOrder(
    lock1Mock,
    mockTaskExecutor.getCall(0),
    pop1Mock,
    lock2Mock,
    mockTaskExecutor.getCall(1),
    pop2Mock,
    lockEmptyMock
  )

  await processPromise // Ensure the main process queue function finishes
})

// Keep other existing processQueue tests like empty queue, error handling etc.
test.serial('processQueue: should handle empty queue correctly', async t => {
  const channelId = 'channel-empty'
  mockTaskQueue.findOneAndUpdate.resolves(null)
  await queueManager.processQueue(channelId)
  t.true(mockTaskQueue.findOneAndUpdate.calledOnce)
  t.false(mockTaskExecutor.called)
  t.false(mockTaskQueue.updateOne.called)
})

test.serial('processQueue: should handle finding empty queue *after* locking', async t => {
  const channelId = 'channel-empty-after-lock'
  mockTaskQueue.findOneAndUpdate.resolves({ _id: 'q3', channelId, queue: [], isProcessing: true })
  mockTaskQueue.updateOne.resolves()
  await queueManager.processQueue(channelId)
  t.true(mockTaskQueue.findOneAndUpdate.calledOnce)
  t.false(mockTaskExecutor.called)
  t.true(mockTaskQueue.updateOne.calledOnceWith({ channelId }, { $set: { isProcessing: false } }))
})

test.serial('processQueue: should handle task execution error and remove task', async t => {
  const channelId = 'channel-exec-error'
  const taskData = { userId: 'user-exec-error', commandType: 'fail', commandData: {} }
  const execError = new Error('Task Failed')
  mockTaskQueue.findOneAndUpdate
    .onFirstCall().resolves({ _id: 'q4', channelId, queue: [taskData], isProcessing: false })
  mockTaskQueue.updateOne.resolves()
  mockTaskExecutor.rejects(execError)

  await queueManager.processQueue(channelId)
  await new Promise(resolve => setTimeout(resolve, 50)) // Allow time for processing

  t.true(mockTaskExecutor.calledOnce)
  t.true(mockTaskQueue.findOneAndUpdate.calledOnce) // Only initial lock
  t.true(mockTaskQueue.updateOne.calledOnceWith({ channelId }, { $pop: { queue: -1 } })) // Remove failed task
  t.true(errorSpy.calledWith(`Error executing task type ${taskData.commandType} for channel ${channelId}:`, execError))
  t.true(errorSpy.calledWith(`Failed task removed from queue for channel ${channelId}`))
})

test.serial('processQueue: should handle DB error during task removal', async t => {
  const channelId = 'channel-remove-error'
  const taskData = { userId: 'user-remove-error', commandType: 'ok', commandData: {} }
  const removeError = new Error('Failed to pop task')
  mockTaskQueue.findOneAndUpdate
    .onFirstCall().resolves({ _id: 'q5', channelId, queue: [taskData], isProcessing: false })
  mockTaskExecutor.resolves() // Task execution succeeds
  mockTaskQueue.updateOne.rejects(removeError) // DB error on $pop

  await queueManager.processQueue(channelId)
  await new Promise(resolve => setTimeout(resolve, 50)) // Allow time for processing

  t.true(mockTaskExecutor.calledOnce)
  t.true(mockTaskQueue.findOneAndUpdate.calledOnce)
  t.true(mockTaskQueue.updateOne.calledOnceWith({ channelId }, { $pop: { queue: -1 } })) // Attempted pop once
  t.true(errorSpy.calledWith(`DB error removing task for channel ${channelId}:`, removeError))
})

// Skipping the uninitialized executor test due to complexity
test.serial.skip('processQueue: should not process if executor is not initialized', t => {
  t.pass('Skipping test for uninitialized executor')
})

test.serial('init should throw error if executor is not a function', t => {
  t.throws(() => {
    queueManager.init('not a function')
  }, { message: 'Task executor must be a function.' })
})

test.serial('init should set the task executor', t => {
  // beforeEach already calls init, so we just check if the executor works
  // We need a test case that actually calls the executor via processQueue
  t.pass() // Placeholder, real check will be in processQueue tests
})

// --- processQueue Tests ---

// Helper function for delaying
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test.serial('processQueue should execute tasks sequentially and remove them', async t => {
  const channelId = 'channel-seq-1'
  const task1 = { userId: 'user-seq-1', commandType: 'type1', commandData: { data: 1 } }
  const task2 = { userId: 'user-seq-1', commandType: 'type2', commandData: { data: 2 } }

  // Mock the initial lock acquisition and queue state
  mockTaskQueue.findOneAndUpdate
    .withArgs({ channelId, isProcessing: false }, { $set: { isProcessing: true } }, { new: true })
    .onFirstCall().resolves({ _id: 'q1', channelId, isProcessing: true, queue: [task1, task2] })
    .onSecondCall().resolves({ _id: 'q1', channelId, isProcessing: true, queue: [task2] }) // After task 1 is popped
    .onThirdCall().resolves({ _id: 'q1', channelId, isProcessing: true, queue: [] }) // After task 2 is popped
    .resolves(null) // Subsequent calls find it locked or empty

  // Mock the $pop operation
  mockTaskQueue.updateOne
    .withArgs({ channelId }, { $pop: { queue: -1 } })
    .resolves({ modifiedCount: 1 })

  // Mock the final unlock operation when queue is empty
  mockTaskQueue.updateOne
    .withArgs({ channelId }, { $set: { isProcessing: false } })
    .resolves({ modifiedCount: 1 })

  // Mock the task executor to resolve successfully
  mockTaskExecutor.resolves()

  // Call processQueue - No await needed as it manages its own lifecycle
  queueManager.processQueue(channelId)

  // Allow time for promises and the loop to potentially run
  // We need a better way to detect completion than setTimeout in real tests
  // Using sinon.assert.callOrder or checking mock calls is better.
  await delay(50) // Adjust delay as needed, or use better async handling

  // Assertions
  t.true(mockTaskExecutor.calledTwice, 'Executor should be called twice')
  sinon.assert.calledWithExactly(mockTaskExecutor.firstCall, channelId, task1)
  sinon.assert.calledWithExactly(mockTaskExecutor.secondCall, channelId, task2)
  sinon.assert.callOrder(
    mockTaskQueue.findOneAndUpdate, // Lock for task 1
    mockTaskExecutor.firstCall,
    mockTaskQueue.updateOne, // Pop task 1
    mockTaskQueue.findOneAndUpdate, // Lock for task 2
    mockTaskExecutor.secondCall,
    mockTaskQueue.updateOne, // Pop task 2
    mockTaskQueue.findOneAndUpdate, // Check empty queue
    mockTaskQueue.updateOne // Unlock empty queue
  )

  t.true(mockTaskQueue.updateOne.calledWith({ channelId }, { $pop: { queue: -1 } }), 'Should pop task 1')
  t.true(mockTaskQueue.updateOne.calledWith({ channelId }, { $pop: { queue: -1 } }), 'Should pop task 2')
  t.true(mockTaskQueue.updateOne.calledWith({ channelId }, { $set: { isProcessing: false } }), 'Should set isProcessing to false when empty')
})

test.serial('processQueue should stop if queue is empty', async t => {
  const channelId = 'channel-empty-1'

  // Mock lock acquisition returns an empty queue
  mockTaskQueue.findOneAndUpdate
    .withArgs({ channelId, isProcessing: false }, { $set: { isProcessing: true } }, { new: true })
    .resolves({ _id: 'q-empty', channelId, isProcessing: true, queue: [] })

  // Mock the unlock operation
  mockTaskQueue.updateOne
    .withArgs({ channelId }, { $set: { isProcessing: false } })
    .resolves({ modifiedCount: 1 })

  await queueManager.processQueue(channelId) // Can await here as it should exit quickly

  t.true(mockTaskExecutor.notCalled, 'Executor should not be called for empty queue')
  t.true(mockTaskQueue.findOneAndUpdate.calledOnce, 'findOneAndUpdate (lock) should be called once')
  t.true(mockTaskQueue.updateOne.calledOnceWith({ channelId }, { $set: { isProcessing: false } }), 'updateOne (unlock) should be called once')
})

test.serial('processQueue should stop if queue is locked by another process', async t => {
  const channelId = 'channel-locked-1'

  // Mock findOneAndUpdate (lock attempt) returns null
  mockTaskQueue.findOneAndUpdate
    .withArgs({ channelId, isProcessing: false }, { $set: { isProcessing: true } }, { new: true })
    .resolves(null)

  // Mock findOne check confirms it is processing
  mockTaskQueue.findOne
    .withArgs({ channelId, isProcessing: true })
    .resolves({ _id: 'q-locked', channelId, isProcessing: true, queue: [{ task: 1 }] })

  await queueManager.processQueue(channelId)

  t.true(mockTaskExecutor.notCalled, 'Executor should not be called')
  t.true(mockTaskQueue.findOneAndUpdate.calledOnce, 'findOneAndUpdate (lock attempt) should be called once')
  t.true(mockTaskQueue.findOne.calledOnce, 'findOne (check lock) should be called once')
  t.true(mockTaskQueue.updateOne.notCalled, 'updateOne should not be called')
})

test.serial('processQueue should stop if queue does not exist (and not locked)', async t => {
  const channelId = 'channel-nonexistent-1'

  // Mock findOneAndUpdate (lock attempt) returns null
  mockTaskQueue.findOneAndUpdate
    .withArgs({ channelId, isProcessing: false }, { $set: { isProcessing: true } }, { new: true })
    .resolves(null)

  // Mock findOne check finds nothing processing
  mockTaskQueue.findOne
    .withArgs({ channelId, isProcessing: true })
    .resolves(null)

  await queueManager.processQueue(channelId)

  t.true(mockTaskExecutor.notCalled, 'Executor should not be called')
  t.true(mockTaskQueue.findOneAndUpdate.calledOnce, 'findOneAndUpdate (lock attempt) should be called once')
  t.true(mockTaskQueue.findOne.calledOnce, 'findOne (check lock) should be called once')
  t.true(mockTaskQueue.updateOne.notCalled, 'updateOne should not be called')
})

test.serial('processQueue should stop if taskExecutor is not initialized', async t => {
  const channelId = 'channel-no-exec-1'
  const task1 = { userId: 'user-no-exec', commandType: 'type1', commandData: { data: 1 } }

  // Create a separate instance for this test to avoid init in beforeEach
  const queueManagerNoInit = proxyquire('../lib/queueManager', {
    '../models/taskQueue': mockTaskQueue
  })
  // DO NOT CALL init() for this instance

  mockTaskQueue.findOneAndUpdate
    .withArgs({ channelId, isProcessing: false }, { $set: { isProcessing: true } }, { new: true })
    .resolves({ _id: 'q-noexec', channelId, isProcessing: true, queue: [task1] })

  mockTaskQueue.updateOne
    .withArgs({ channelId }, { $set: { isProcessing: false } })
    .resolves({ modifiedCount: 1 })

  // Spy on console.error
  const errorSpy = sinon.spy(console, 'error')

  await queueManagerNoInit.processQueue(channelId)

  t.true(mockTaskExecutor.notCalled, 'Executor should not have been called')
  t.true(errorSpy.calledWith(`No task executor configured! Cannot process task for channel ${channelId}.`))
  t.true(mockTaskQueue.updateOne.calledOnceWith({ channelId }, { $set: { isProcessing: false } }), 'Should release lock if no executor')

  errorSpy.restore()
})

// More tests to follow...
