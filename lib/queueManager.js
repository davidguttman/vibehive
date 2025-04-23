// lib/queueManager.js
const TaskQueue = require('../models/TaskQueue') // Corrected filename case

const activeChannels = new Set()
let taskExecutor = null // Placeholder for the execution function

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
      { upsert: true, new: true } // Create if doesn't exist
    )
    console.log(`Task enqueued for channel ${channelId}. Triggering processing.`)
    // Attempt to process the queue immediately
    processQueue(channelId) // Don't await this, let it run in the background
  } catch (error) {
    console.error(`Error enqueuing task for channel ${channelId}:`, error)
  }
}

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
      let lockedQueue = null
      try {
        lockedQueue = await TaskQueue.findOneAndUpdate(
          { channelId, isProcessing: false }, // Find if not already processing
          { $set: { isProcessing: true } },
          { new: true } // Return the modified document
        )
      } catch (dbError) {
        console.error(`DB error trying to lock queue for channel ${channelId}:`, dbError)
        break // Exit loop on DB error during locking
      }

      // 4. Check Lock Result & Queue Status
      if (!lockedQueue) {
        // Either queue doesn't exist OR it's already locked (isProcessing: true)
        // Check if it's locked by *this* process - should not happen due to activeChannels check, but good practice
        const currentlyProcessing = await TaskQueue.findOne({ channelId, isProcessing: true })
        if (currentlyProcessing) {
          console.log(`Queue for channel ${channelId} is locked by another process or worker. Stopping loop.`)
        } else {
          console.log(`Queue for channel ${channelId} is empty or does not exist. Stopping loop.`)
        }
        break // Exit the while loop
      }

      if (lockedQueue.queue.length === 0) {
        // Queue is empty, release the lock and exit loop
        console.log(`Queue for channel ${channelId} is empty. Releasing lock and stopping.`)
        try {
          await TaskQueue.updateOne({ channelId }, { $set: { isProcessing: false } })
        } catch (dbError) {
          console.error(`DB error releasing empty queue lock for channel ${channelId}:`, dbError)
        }
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
          try {
            await TaskQueue.updateOne(
              { channelId }, // Use channelId from the locked queue doc
              { $pop: { queue: -1 } } // -1 removes the first element
            )
            console.log(`Task removed from queue for channel ${channelId}`)
          } catch (dbError) {
            console.error(`DB error removing task for channel ${channelId}:`, dbError)
            // If removing fails, we need to decide how to proceed.
            // For now, log error and break to avoid potential infinite loop on this task.
            // Releasing the lock happens in finally.
            break
          }
        } catch (executionError) {
          console.error(`Error executing task type ${nextTask.commandType} for channel ${channelId}:`, executionError)
          // Decide on error handling: retry? move to dead-letter queue? For now, we log and remove.
          // Ensure task is removed even on error to prevent infinite loops
          try {
            await TaskQueue.updateOne(
              { channelId },
              { $pop: { queue: -1 } } // Remove the failed task
            )
            console.error(`Failed task removed from queue for channel ${channelId}`)
          } catch (dbError) {
            console.error(`DB error removing *failed* task for channel ${channelId}:`, dbError)
            // If removing failed task fails, break to be safe.
            break
          }
          // Consider breaking the loop or continuing based on error strategy. Let's break for now.
          break
        }
      } else {
        console.error(`No task executor configured! Cannot process task for channel ${channelId}.`)
        // Release DB lock and break to prevent infinite loop without executor
        try {
          await TaskQueue.updateOne({ channelId }, { $set: { isProcessing: false } })
        } catch (dbError) {
          console.error(`DB error releasing lock due to missing executor for channel ${channelId}:`, dbError)
        }
        break
      }
      // Loop continues to check for more tasks only if the current task was processed successfully
    }
  } catch (error) {
    // Catch errors outside the DB lock acquisition/task execution loop (e.g., unexpected errors)
    console.error(`Unhandled error during queue processing loop for channel ${channelId}:`, error)
    // Attempt to release the DB lock just in case it was acquired before the unhandled error
    try {
      await TaskQueue.updateOne({ channelId, isProcessing: true }, { $set: { isProcessing: false } })
      console.log(`Released DB lock for channel ${channelId} after unhandled error.`)
    } catch (unlockError) {
      console.error(`Failed to release processing lock for channel ${channelId} after unhandled error:`, unlockError)
    }
  } finally {
    // 8. Release In-Memory Lock
    activeChannels.delete(channelId)
    console.log(`Finished processing cycle for channel ${channelId}. Released in-memory lock.`)
    // Note: The DB lock (isProcessing: false) should ideally be released within the loop
    // or just before breaking out of it, or in the catch block above.
    // Avoid releasing it here unconditionally as the loop might have exited correctly
    // after releasing the lock already, or another worker might have taken over.
  }
}

function init (executor) {
  if (typeof executor !== 'function') {
    throw new Error('Task executor must be a function.')
  }
  taskExecutor = executor
  console.log('QueueManager initialized with task executor.')
}

function resetForTesting () {
  activeChannels.clear()
  taskExecutor = null
}

module.exports = {
  init,
  enqueueTask,
  processQueue,
  resetForTesting
}
