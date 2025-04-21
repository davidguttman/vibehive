// models/Repository.js

// 1. Package Requires
const mongoose = require('mongoose')

// 2. Local Requires (None)

// 3. Constants
const repositorySchema = new mongoose.Schema({
  repoUrl: {
    type: String,
    required: [true, 'Repository URL is required.'], // Add custom error message
    trim: true // Automatically remove leading/trailing whitespace
  },
  discordChannelId: {
    type: String,
    required: [true, 'Discord Channel ID is required.'],
    unique: true, // Ensure only one repository per channel
    index: true // Index for faster lookups
  },
  contextFiles: {
    type: [String],
    default: []
  },
  encryptedSshKey: {
    type: String
  },
  assignedUserId: {
    type: String
  }
  // Add more fields as needed later (e.g., last commit checked, owner, etc.)
}, {
  timestamps: true // Automatically add createdAt and updatedAt fields
})

// 4. Immediately Run Code (None)

// 5. Module Exports
module.exports = mongoose.model('Repository', repositorySchema)

// 6. Functions (None)
