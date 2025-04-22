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

// Create and export the Mongoose model
const TaskQueue = mongoose.model('TaskQueue', queueSchema)

module.exports = TaskQueue
