// lib/mongo.js

// 1. Package Requires
const { MongoClient } = require('mongodb')

// 2. Local Requires
const { mongoURI, mongoDBName } = require('../config') // Adjust path as needed

// 3. Constants (None)

// 4. Immediately Run Code (State variables)
let client
let db

// 5. Module Exports
module.exports = {
  connectDB,
  getDB,
  closeDB // Good practice to add a close function, especially for tests
}

// 6. Functions
async function connectDB (uri = mongoURI, dbName = mongoDBName) {
  if (db) {
    console.log('MongoDB already connected.')
    return db
  }

  try {
    console.log(`Attempting to connect to MongoDB at ${uri} ...`)
    client = new MongoClient(uri)
    await client.connect()
    db = client.db(dbName)
    console.log(`Successfully connected to MongoDB database: ${dbName}`)
    return db
  } catch (err) {
    console.error('Failed to connect to MongoDB', err)
    // Consider more robust error handling or retries in production
    process.exit(1) // Exit application if DB connection fails on startup
  }
}

function getDB () {
  if (!db) {
    throw new Error('DB not connected. Call connectDB first.')
  }
  return db
}

async function closeDB () {
  if (client) {
    await client.close()
    console.log('MongoDB connection closed.')
    client = null
    db = null
  } else {
    console.log('MongoDB connection already closed or never opened.')
  }
}
