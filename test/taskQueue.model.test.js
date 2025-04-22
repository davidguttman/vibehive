const test = require('ava')
const { MongoMemoryServer } = require('mongodb-memory-server')
const TaskQueue = require('../models/TaskQueue') // Adjust path if needed
const { connectDB, closeDB } = require('../lib/mongo') // Import DB connection helpers

let mongoServer
let mongoUri

// Start server and connect before tests
test.before(async t => {
  mongoServer = await MongoMemoryServer.create()
  mongoUri = mongoServer.getUri()
  await connectDB(mongoUri) // Use the connectDB function
  t.pass('Mongoose connected for TaskQueue tests')
})

// Disconnect and stop server after tests
test.after.always(async t => {
  await closeDB() // Use the closeDB function
  if (mongoServer) {
    await mongoServer.stop()
  }
  t.pass('Mongoose disconnected and server stopped')
})

// Clear collection before each test
test.beforeEach(async t => {
  await TaskQueue.deleteMany({})
})

test.serial('should create a new task queue document for a channel', async t => {
  const channelId = 'channel-123'
  console.log(`[Test Create] Creating queue for channel: ${channelId}`)
  const taskQueue = new TaskQueue({ channelId })
  const saveResult = await taskQueue.save()
  console.log(`[Test Create] Save result: ${JSON.stringify(saveResult)}`)

  console.log(`[Test Create] Finding queue for channel: ${channelId}`)
  const foundQueue = await TaskQueue.findOne({ channelId })
  console.log(`[Test Create] Found queue result: ${JSON.stringify(foundQueue)}`)
  t.truthy(foundQueue)
  t.is(foundQueue.channelId, channelId)
  t.is(foundQueue.queue.length, 0)
  t.is(foundQueue.isProcessing, false)
})

test.serial('should add tasks ($push) to the queue array', async t => {
  const channelId = 'channel-456'
  const taskQueue = new TaskQueue({ channelId })
  await taskQueue.save()

  const task1 = { userId: 'user-abc', commandType: 'mention', commandData: { prompt: 'Hello' } }
  const task2 = { userId: 'user-def', commandType: 'add_files', commandData: { paths: ['/a/b'] } }

  // Use $push to add tasks
  await TaskQueue.updateOne({ channelId }, { $push: { queue: { $each: [task1, task2] } } })

  const foundQueue = await TaskQueue.findOne({ channelId })
  t.is(foundQueue.queue.length, 2)
  t.is(foundQueue.queue[0].userId, task1.userId)
  t.is(foundQueue.queue[0].commandType, task1.commandType)
  t.deepEqual(foundQueue.queue[0].commandData, task1.commandData)
  t.truthy(foundQueue.queue[0].timestamp)
  t.truthy(foundQueue.queue[0]._id) // Verify subdocument ID
  t.is(foundQueue.queue[1].userId, task2.userId)
})

test.serial('should find and update the isProcessing flag', async t => {
  const channelId = 'channel-789'
  console.log(`[Test Update Flag] Creating queue for channel: ${channelId}`)
  const taskQueue = new TaskQueue({ channelId })
  const initialSaveResult = await taskQueue.save()
  console.log(`[Test Update Flag] Initial save result: ${JSON.stringify(initialSaveResult)}`)

  // Find and set isProcessing to true
  const findAndUpdateCondition = { channelId, isProcessing: false }
  console.log(`[Test Update Flag] Finding and updating with condition: ${JSON.stringify(findAndUpdateCondition)}`)
  const updatedQueue = await TaskQueue.findOneAndUpdate(
    findAndUpdateCondition,
    { $set: { isProcessing: true } },
    { new: true } // Return the updated document
  )
  console.log(`[Test Update Flag] FindAndUpdate result: ${JSON.stringify(updatedQueue)}`)
  t.truthy(updatedQueue)
  t.is(updatedQueue.isProcessing, true)

  // Try to find and update again (should fail if condition is isProcessing: false)
  console.log(`[Test Update Flag] Finding and updating again (should be null) with condition: ${JSON.stringify(findAndUpdateCondition)}`)
  const shouldBeNull = await TaskQueue.findOneAndUpdate(
    findAndUpdateCondition, // Use same condition { channelId, isProcessing: false }
    { $set: { isProcessing: true } },
    { new: true }
  )
  console.log(`[Test Update Flag] Second FindAndUpdate result: ${JSON.stringify(shouldBeNull)}`)
  t.is(shouldBeNull, null)

  // Set it back to false
  console.log(`[Test Update Flag] Setting isProcessing back to false for channel: ${channelId}`)
  await TaskQueue.updateOne({ channelId }, { $set: { isProcessing: false } })
  const resetQueue = await TaskQueue.findOne({ channelId })
  console.log(`[Test Update Flag] Final find result: ${JSON.stringify(resetQueue)}`)
  t.is(resetQueue.isProcessing, false)
})

test.serial('should retrieve the oldest task and remove it ($pop)', async t => {
  const channelId = 'channel-abc'
  const task1 = { userId: 'user-1', commandType: 'task1' }
  const task2 = { userId: 'user-2', commandType: 'task2' } // Newest task
  const taskQueue = new TaskQueue({
    channelId,
    queue: [task1, task2]
  })
  await taskQueue.save()

  // Use findOneAndUpdate with $pop to atomically get and remove the oldest task
  // $pop: { queue: -1 } removes the first element (oldest)
  const updateResult = await TaskQueue.findOneAndUpdate(
    { channelId },
    { $pop: { queue: -1 } },
    { new: false } // Return the original document *before* the update
  )

  // The oldest task was in updateResult (before pop)
  t.truthy(updateResult)
  t.is(updateResult.queue.length, 2) // Before pop
  t.is(updateResult.queue[0].userId, task1.userId)

  // Verify the queue state after the pop
  const queueAfterPop = await TaskQueue.findOne({ channelId })
  t.is(queueAfterPop.queue.length, 1)
  t.is(queueAfterPop.queue[0].userId, task2.userId) // Only the newest task remains

  // Pop the last remaining task
  await TaskQueue.updateOne({ channelId }, { $pop: { queue: -1 } })
  const emptyQueue = await TaskQueue.findOne({ channelId })
  t.is(emptyQueue.queue.length, 0)
})

test.serial('should handle trying to pop from an empty queue gracefully', async t => {
  const channelId = 'channel-empty'
  const taskQueue = new TaskQueue({ channelId, queue: [] })
  await taskQueue.save()

  const updateResult = await TaskQueue.findOneAndUpdate(
    { channelId },
    { $pop: { queue: -1 } },
    { new: false } // Return the original document
  )

  t.truthy(updateResult) // Find operation succeeds
  t.is(updateResult.queue.length, 0) // Queue was empty

  const queueAfterPop = await TaskQueue.findOne({ channelId })
  t.is(queueAfterPop.queue.length, 0) // Queue remains empty
})
