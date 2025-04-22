# Tutorial 27: Implement Queue Logic

This tutorial guides you through implementing a task queue manager (`lib/queueManager.js`) to handle sequential task processing for different channels, based on the requirements outlined in `docs/prompts/27.md`. This ensures that tasks for a specific channel (e.g., Discord channel, user DM) are executed one after another, preventing conflicts and maintaining order.

## Goal

Create a robust queue system that accepts tasks, stores them persistently per channel, and processes them sequentially, ensuring only one task per channel runs at a time.

## Steps

### 1. Create the Queue Manager File

First, create the file where our queue logic will reside:

```bash
touch lib/queueManager.js
```

Inside `lib/queueManager.js`, start by requiring the `TaskQueue` model we created in Tutorial 26. We also need a way to track which channels are currently being processed to prevent concurrent execution for the same channel. A `Set` is suitable for this.

```javascript
// lib/queueManager.js
const TaskQueue = require('../models/taskQueue') // Adjust path if needed

const activeChannels = new Set()
let taskExecutor = null // Placeholder for the execution function

// ... rest of the code ...

module.exports = {
  // ... exported functions ...
}
```

### 2. Implement `enqueueTask` Function

This function adds a new task to a channel's queue. It uses `findOneAndUpdate` with `upsert: true` to either create a new queue document for the channel or add the task to an existing one. After adding the task, it triggers `processQueue` to potentially start processing if the queue wasn't already active.

```javascript
// lib/queueManager.js
// ... requires and activeChannels ...

async function enqueueTask (channelId, taskData) {
  if (!channelId || !taskData) {
    console.error('enqueueTask: Missing channelId or taskData')
    return
  }
  console.log(`Enqueuing task for channel ${channelId}`)
  try {
    // Add the task to the persistent queue
    await TaskQueue.findOneAndUpdate(
      { channelId },
      { $push: { queue: taskData } },
      { upsert: true, new: true } // Create if doesn't exist, return new doc (though we don't use it here)
    )
    console.log(`Task enqueued for channel ${channelId}. Triggering processing.`)
    // Attempt to process the queue immediately
    processQueue(channelId) // Don't await this, let it run in the background
  } catch (error) {
    console.error(`Error enqueuing task for channel ${channelId}:`, error)
  }
}

// ... processQueue function ...

module.exports = {
  enqueueTask,
  // ... other exports ...
}

// ... function definitions ...
```

**Explanation:**

*   `taskData`: Should conform to the schema (`userId`, `commandType`, `commandData`).
*   `findOneAndUpdate`: Atomically adds the task. `upsert: true` is crucial.
*   `processQueue(channelId)`: Called without `await` to avoid blocking the enqueue operation. It will handle its own locking.

### 3. Implement `processQueue` Function

This is the core processing logic. It ensures only one process runs per channel using the `activeChannels` set and handles task execution sequentially.

```javascript
// lib/queueManager.js
// ... requires, activeChannels, enqueueTask ...

async function processQueue (channelId) {
  // 1. Concurrency Check: If already processing this channel, exit.
  if (activeChannels.has(channelId)) {
    console.log(`Channel ${channelId} is already being processed. Exiting processQueue call.`)
    return
  }

  // 2. Mark as Active (In-Memory Lock)
  activeChannels.add(channelId)
  console.log(`Starting processing for channel ${channelId}`)

  try {
    while (true) { // Loop to process all tasks in the queue
      // 3. Attempt to Lock the Queue Document in DB
      const lockedQueue = await TaskQueue.findOneAndUpdate(
        { channelId, isProcessing: false }, // Find if not already processing
        { $set: { isProcessing: true } },
        { new: true } // Return the modified document
      )

      // 4. Check Lock Result & Queue Status
      if (!lockedQueue) {
        // Either queue doesn't exist (unlikely if enqueue worked) OR it's already locked (isProcessing: true)
        console.log(`Queue for channel ${channelId} is empty, does not exist, or is locked by another process. Stopping loop.`)
        break // Exit the while loop
      }

      if (lockedQueue.queue.length === 0) {
        // Queue is empty, release the lock and exit loop
        console.log(`Queue for channel ${channelId} is empty. Releasing lock and stopping.`)
        await TaskQueue.updateOne({ channelId }, { $set: { isProcessing: false } })
        break // Exit the while loop
      }

      // 5. Get the Next Task
      const nextTask = lockedQueue.queue[0] // Get the oldest task
      console.log(`Processing task type ${nextTask.commandType} for channel ${channelId}`)

      // 6. Execute the Task
      if (taskExecutor) {
        try {
          // *** Critical: Call the actual task execution logic ***
          await taskExecutor(channelId, nextTask)
          console.log(`Task completed for channel ${channelId}`)
          // 7. Remove Processed Task from DB Queue
          await TaskQueue.updateOne(
            { channelId },
            { $pop: { queue: -1 } } // -1 removes the first element
          )
          console.log(`Task removed from queue for channel ${channelId}`)
        } catch (executionError) {
          console.error(`Error executing task for channel ${channelId}:`, executionError)
          // Decide on error handling: retry? move to dead-letter queue? For now, we log and remove.
          // Ensure task is removed even on error to prevent infinite loops
          await TaskQueue.updateOne(
            { channelId },
            { $pop: { queue: -1 } } // Remove the failed task
          )
          console.error(`Failed task removed from queue for channel ${channelId}`)
          // Consider breaking the loop or continuing based on error strategy
        }
      } else {
        console.error(`No task executor configured! Cannot process task for channel ${channelId}.`)
        // Release lock and break to prevent infinite loop without executor
        await TaskQueue.updateOne({ channelId }, { $set: { isProcessing: false } })
        break
      }
      // Loop continues to check for more tasks
    }
  } catch (error) {
    console.error(`Error during queue processing for channel ${channelId}:`, error)
    // Attempt to release the DB lock in case of unexpected errors during the loop setup/locking
    try {
      await TaskQueue.updateOne({ channelId, isProcessing: true }, { $set: { isProcessing: false } })
    } catch (unlockError) {
      console.error(`Failed to release processing lock for channel ${channelId} after error:`, unlockError)
    }
  } finally {
    // 8. Release In-Memory Lock
    activeChannels.delete(channelId)
    console.log(`Finished processing cycle for channel ${channelId}. Released in-memory lock.`)
    // Note: DB lock (isProcessing: false) should be released within the loop when queue is empty or before breaking on error.
  }
}

// ... module.exports ...
```

**Explanation:**

*   **`activeChannels`:** Prevents multiple `processQueue` calls for the same channel from running concurrently in *this specific node process*.
*   **`isProcessing` Flag (DB):** Prevents multiple *different* node processes (if scaled) or concurrent loops within the same process from trying to process the *same database queue* simultaneously. We try to acquire this "lock" (`findOneAndUpdate`) at the start of each iteration.
*   **`while(true)` loop:** Continuously processes tasks as long as the lock is acquired and tasks exist.
*   **Lock Release:** The `isProcessing: false` flag is set when the queue is found to be empty or before breaking out due to errors.
*   **Task Removal (`$pop: { queue: -1 }`):** Removes the task from the *beginning* of the array after successful execution (or failure, depending on strategy).
*   **`finally` Block:** Ensures the in-memory `activeChannels` lock is always released for this channel, allowing future `enqueueTask` calls to trigger processing again if needed.

### 4. Initialization Function

We need a way to provide the `taskExecutor` function, which contains the actual logic to run the task (e.g., call the AI wrapper, run git commands, reply to the user).

```javascript
// lib/queueManager.js
// ... requires, activeChannels, enqueueTask, processQueue ...

function init (executor) {
  if (typeof executor !== 'function') {
    throw new Error('Task executor must be a function.')
  }
  taskExecutor = executor
  console.log('QueueManager initialized with task executor.')
}

module.exports = {
  init,
  enqueueTask,
  processQueue // Exporting processQueue might be useful for retries or manual triggers
}

// ... function definitions ...
```

You would call `queueManager.init(yourTaskExecutorFunction)` somewhere during your application startup, passing the function that knows how to handle tasks based on `commandType` and `commandData`.

### 5. Testing Strategy

As outlined in the prompt, testing is crucial:

*   **File:** Create `test/queueManager.test.js` using Ava (as per custom instructions).
*   **Mocks:**
    *   Mock the `TaskQueue` model methods (`findOneAndUpdate`, `findOne`, `updateOne`) to simulate database interactions without needing a real DB connection. Use libraries like `sinon` for spying on calls.
    *   Create a mock `taskExecutorFunction` that records its calls and arguments, and perhaps simulates success or failure.
*   **Test Cases:**
    *   `enqueueTask`: Verify it calls `TaskQueue.findOneAndUpdate` correctly and subsequently calls `processQueue`.
    *   `processQueue` - Concurrency: Call `processQueue` multiple times rapidly for the same `channelId`. Assert the mock `taskExecutor` is called only once initially (or sequentially if tasks are added between calls). Use `Promise.all` to trigger concurrently.
    *   `processQueue` - Task Execution: Seed the mock `TaskQueue` with multiple tasks. Call `processQueue`. Assert the mock executor is called sequentially for each task with the correct data. Verify `$pop` is called after each execution. Check that `isProcessing` is set to `true` during processing and `false` afterwards.
    *   `processQueue` - Empty Queue: Call `processQueue` when the mock `TaskQueue` returns an empty queue. Assert the executor is *not* called and `isProcessing` remains `false` (or is set to `false` if it was somehow `true`).
    *   Error Handling: Test how `processQueue` behaves if the `taskExecutor` throws an error. Does it remove the task? Does it continue processing others?

### 6. Code Style

Remember to run `standard --fix` on `lib/queueManager.js` to ensure code style consistency.

```bash
npx standard --fix lib/queueManager.js
```

## Conclusion

You now have a `lib/queueManager.js` module capable of enqueuing tasks per channel and processing them sequentially. The key parts are the in-memory lock (`activeChannels`) for preventing concurrent runs within the *same* process and the database flag (`isProcessing`) combined with atomic operations for broader concurrency control and persistent state management. Remember to implement the `taskExecutorFunction` and integrate the `init` and `enqueueTask` calls into your application logic (e.g., in your Discord bot's command handler). 