# Tutorial 26: Task Queue MongoDB Schema and Model

This tutorial guides you through defining the MongoDB schema and Mongoose model for managing task queues per Discord channel. This queue will hold commands (like processing mentions or adding files) to be executed sequentially.

**Goal:** Create a robust Mongoose model for storing and managing tasks associated with specific Discord channels, preventing concurrent processing within a single channel.

## Prerequisites

*   MongoDB server running and accessible.
*   Mongoose installed (`npm install mongoose`).
*   Completion of Tutorial 2 (`02-mongodb-integration.md`) or a working Mongoose connection setup in `lib/db.js`.
*   Familiarity with Mongoose schemas and models.

## Steps

1.  **Verify Database Connection (`lib/db.js`):**
    Ensure your `lib/db.js` establishes a connection to MongoDB using Mongoose. If you followed Tutorial 2, you should already have this. It should look something like this:

    ```javascript
    // lib/db.js
    const mongoose = require('mongoose')
    const config = require('../config')

    async function connectDB () {
      try {
        await mongoose.connect(config.mongodbUri, {
          // Remove deprecated options if present
          // useNewUrlParser: true,
          // useUnifiedTopology: true,
          // useCreateIndex: true, // No longer needed in Mongoose 6+
          // useFindAndModify: false // No longer needed in Mongoose 6+
        })
        console.log('MongoDB Connected...')
      } catch (err) {
        console.error('MongoDB connection error:', err.message)
        // Exit process with failure
        process.exit(1)
      }
    }

    module.exports = connectDB
    ```
    *Self-Correction:* Removed deprecated Mongoose connection options commented out in the example, as they are default or removed in newer versions.

2.  **Create Task Schema Definition (`models/TaskQueue.js`):**
    First, define the schema for individual tasks that will go into the queue. Create a new file `models/TaskQueue.js`.

    ```javascript
    // models/TaskQueue.js
    const mongoose = require('mongoose')

    // Schema for individual tasks within a queue
    const taskSchema = new mongoose.Schema({
      userId: {
        type: String,
        required: true // The user who initiated the task
      },
      commandType: {
        type: String,
        required: true // e.g., 'mention', 'add_files', 'repo_command'
      },
      commandData: {
        type: mongoose.Schema.Types.Mixed, // Flexible storage for command-specific data
        required: false // Can be empty for simple commands
      },
      timestamp: {
        type: Date,
        default: Date.now // Record when the task was added
      }
    }, { _id: true }) // Ensure each task gets its own unique _id

    // NOTE: We are defining taskSchema here but exporting the main Queue model below.
    // This schema is embedded within the queueSchema.

    // ... (queueSchema definition follows in the next step) ...
    ```
    *Self-Correction:* Explicitly added `{ _id: true }` to `taskSchema` options to ensure subdocuments get unique IDs, which can be helpful for specific operations, although Mongoose adds them by default. Added comments explaining `userId`, `commandType`, and `commandData`. Made `commandData` not required.

3.  **Define Queue Schema (`models/TaskQueue.js`):**
    In the same file (`models/TaskQueue.js`), define the main schema for the task queue document, embedding the `taskSchema`.

    ```javascript
    // models/TaskQueue.js
    // ... (taskSchema definition from previous step) ...

    // Schema for the overall task queue associated with a channel
    const queueSchema = new mongoose.Schema({
      channelId: {
        type: String,
        required: true,
        unique: true, // Each channel should have only one queue document
        index: true // Index for faster lookups by channelId
      },
      queue: {
        type: [taskSchema], // Array of tasks using the schema defined above
        default: []
      },
      isProcessing: {
        type: Boolean,
        default: false // Flag to indicate if a task from this queue is currently being processed
      }
    }, { timestamps: true }) // Add createdAt and updatedAt timestamps to the queue document

    // ... (Model export follows in the next step) ...
    ```
    *Self-Correction:* Added `{ timestamps: true }` to `queueSchema` to automatically manage `createdAt` and `updatedAt` fields for the queue document itself. Ensured comments clearly explain the purpose of `channelId`, `queue`, and `isProcessing`.

4.  **Create and Export Model (`models/TaskQueue.js`):**
    Finally, create the Mongoose model from the `queueSchema` and export it.

    ```javascript
    // models/TaskQueue.js
    // ... (taskSchema definition) ...
    // ... (queueSchema definition) ...

    // Create and export the Mongoose model
    const TaskQueue = mongoose.model('TaskQueue', queueSchema)

    module.exports = TaskQueue
    ```

5.  **Run Code Formatter:**
    Apply standard.js style fixes to the new model file.
    ```bash
    npx standard --fix models/TaskQueue.js
    ```

## Testing (`test/taskQueue.model.test.js`)

Create a test file `test/taskQueue.model.test.js` to ensure the model works as expected. The prompt specified using `tape`, but following recent project changes (Tutorial 21a), we will use `ava`. We'll also use an in-memory MongoDB instance for testing.

1.  **Install Dev Dependencies:**
    If you haven't already, install `ava` and `@shelf/jest-mongodb` (which works well with `ava` too).
    ```bash
    npm install --save-dev ava @shelf/jest-mongodb
    ```

2.  **Configure In-Memory MongoDB for Tests:**
    Update your `package.json` or create an `ava.config.js` to use the preset provided by `@shelf/jest-mongodb`.

    *Option A: `package.json`*
    ```json
    // package.json
    {
      // ... other configurations
      "ava": {
        "preset": "@shelf/jest-mongodb"
      }
      // ...
    }
    ```

    *Option B: `ava.config.js`*
    ```javascript
    // ava.config.js
    export default {
      preset: '@shelf/jest-mongodb'
    }
    ```

3.  **Create Test File (`test/taskQueue.model.test.js`):**

    ```javascript
    // test/taskQueue.model.test.js
    const test = require('ava')
    const mongoose = require('mongoose')
    const TaskQueue = require('../models/TaskQueue') // Adjust path if needed

    // Connect before tests and disconnect after (managed by preset)
    test.before(async t => {
      // The preset handles the connection string via process.env.MONGO_URL
      await mongoose.connect(process.env.MONGO_URL)
    })

    test.after.always(async t => {
      await mongoose.connection.dropDatabase() // Clean up the DB
      await mongoose.connection.close() // Close the connection
    })

    // Clear collection before each test
    test.beforeEach(async t => {
      await TaskQueue.deleteMany({})
    })

    test('should create a new task queue document for a channel', async t => {
      const channelId = 'channel-123'
      const taskQueue = new TaskQueue({ channelId })
      await taskQueue.save()

      const foundQueue = await TaskQueue.findOne({ channelId })
      t.truthy(foundQueue)
      t.is(foundQueue.channelId, channelId)
      t.is(foundQueue.queue.length, 0)
      t.is(foundQueue.isProcessing, false)
    })

    test('should add tasks ($push) to the queue array', async t => {
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

    test('should find and update the isProcessing flag', async t => {
      const channelId = 'channel-789'
      const taskQueue = new TaskQueue({ channelId })
      await taskQueue.save()

      // Find and set isProcessing to true
      const updatedQueue = await TaskQueue.findOneAndUpdate(
        { channelId, isProcessing: false }, // Condition: find queue for channel only if not already processing
        { $set: { isProcessing: true } },
        { new: true } // Return the updated document
      )

      t.truthy(updatedQueue)
      t.is(updatedQueue.isProcessing, true)

      // Try to find and update again (should fail if condition is isProcessing: false)
      const shouldBeNull = await TaskQueue.findOneAndUpdate(
        { channelId, isProcessing: false },
        { $set: { isProcessing: true } },
        { new: true }
      )
      t.is(shouldBeNull, null)

      // Set it back to false
      await TaskQueue.updateOne({ channelId }, { $set: { isProcessing: false } })
      const resetQueue = await TaskQueue.findOne({ channelId })
      t.is(resetQueue.isProcessing, false)
    })

    test('should retrieve the oldest task and remove it ($pop)', async t => {
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

    test('should handle trying to pop from an empty queue gracefully', async t => {
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
    ```
    *Self-Correction:* Switched testing framework from `tape` to `ava` to align with previous tutorials. Used `@shelf/jest-mongodb` preset for handling in-memory MongoDB setup/teardown. Added `before`, `after.always`, and `beforeEach` hooks for proper test isolation. Implemented tests covering creation, adding tasks (`$push`), updating `isProcessing` atomically, and retrieving/removing the oldest task using `$pop: { queue: -1 }`. Added a test for popping from an empty queue. Ensured subdocument IDs are checked.

4.  **Run Tests:**
    Execute your test suite.
    ```bash
    npm test
    ```
    Ensure all tests for `taskQueue.model.test.js` pass.

## Conclusion

You have successfully created a Mongoose model (`TaskQueue`) to manage channel-specific task queues. This model includes:
*   A schema for individual tasks (`taskSchema`) storing user ID, command type, and data.
*   A main queue schema (`queueSchema`) linked to a `channelId`, holding an array of tasks, and an `isProcessing` flag.
*   Basic tests to verify creating queues, adding tasks, managing the processing flag, and retrieving/removing tasks.

This `TaskQueue` model provides the foundation for processing bot commands sequentially per channel, preventing race conditions and ensuring orderly execution. 