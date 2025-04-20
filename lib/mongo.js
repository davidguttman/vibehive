// lib/mongo.js

// 1. Package Requires
const mongoose = require('mongoose')

// 2. Local Requires
const { mongoURI } = require('../config') // We only need the URI now

// 3. Constants (None)

// 4. Immediately Run Code
// Log Mongoose events (optional but helpful)
mongoose.connection.on('connecting', () => {
  console.log('Mongoose connecting...')
})
mongoose.connection.on('connected', () => {
  console.log('Mongoose connected successfully.')
})
mongoose.connection.on('disconnecting', () => {
  console.log('Mongoose disconnecting...')
})
mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected.')
})
mongoose.connection.on('error', (err) => {
  console.error('Mongoose connection error:', err)
  // Consider exiting if connection fails critically during startup
  if (err.name === 'MongoNetworkError') {
    process.exit(1)
  }
})

// 5. Module Exports
module.exports = {
  connectDB,
  getDB: () => mongoose.connection.db, // Return the underlying driver DB instance
  closeDB: () => mongoose.disconnect()
}

// 6. Functions
async function connectDB (uri = mongoURI) {
  // Mongoose handles connection pooling and ready state internally.
  // We just need to call connect once.
  if (mongoose.connection.readyState === 0) { // 0 = disconnected
    console.log(`Attempting to connect Mongoose to ${uri} ...`)
    try {
      await mongoose.connect(uri, {
        // Optional: Mongoose 6+ defaults are generally good
        // useNewUrlParser: true,
        // useUnifiedTopology: true,
        // serverSelectionTimeoutMS: 5000 // Example: Timeout after 5s
      })
      // Connection events defined above will handle success logging
      return mongoose.connection.db
    } catch (err) {
      console.error('Mongoose initial connection failed:', err)
      process.exit(1)
    }
  } else {
    // If already connected or connecting, return the existing connection's db
    console.log('Mongoose connection already established or connecting.')
    // Wait for connection to be fully established if it's in an intermediate state
    if (mongoose.connection.readyState !== 1) { // 1 = connected
      await new Promise(resolve => mongoose.connection.once('connected', resolve))
    }
    return mongoose.connection.db
  }
}

// Note: getDB now directly returns the database instance from the Mongoose connection.
// Note: closeDB now uses mongoose.disconnect().
