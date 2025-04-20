// test/db.test.js
const test = require('tape')
const { MongoMemoryServer } = require('mongodb-memory-server')
// Set NODE_ENV to 'test' before requiring modules that check it
process.env.NODE_ENV = 'test'
const { connectDB, getDB, closeDB } = require('../lib/mongo') // Adjust path

let mongoServer

test('MongoDB Connection Setup', async (t) => {
  // Start in-memory MongoDB server before tests
  mongoServer = await MongoMemoryServer.create()
  const uri = mongoServer.getUri()
  t.ok(uri, 'In-memory server should provide a URI')
  console.log(`In-memory MongoDB started at ${uri}`)
  t.end()
})

test('connectDB Function', async (t) => {
  const uri = mongoServer.getUri()
  const testDbName = 'test-db'
  let dbInstance

  try {
    dbInstance = await connectDB(uri, testDbName) // Pass test URI and DB name
    t.ok(dbInstance, 'connectDB should return a DB instance')
    t.equal(dbInstance.databaseName, testDbName, 'DB instance should have the correct name')

    // Test connecting again (should be idempotent)
    const dbInstanceAgain = await connectDB(uri, testDbName)
    t.equal(dbInstanceAgain, dbInstance, 'Calling connectDB again should return the same instance')
  } catch (err) {
    t.fail('connectDB should not throw an error here')
    console.error(err)
  } finally {
    // Close the connection after the test
    await closeDB()
    t.end()
  }
})

test('getDB Function', async (t) => {
  const uri = mongoServer.getUri()
  const testDbName = 'test-getdb'

  // Test getDB before connection
  try {
    getDB()
    t.fail('getDB should throw an error if called before connectDB')
  } catch (err) {
    t.ok(err instanceof Error, 'getDB should throw an Error instance')
    t.match(err.message, /DB not connected/, 'Error message should indicate DB not connected')
  }

  // Test getDB after connection
  let dbInstance
  try {
    await connectDB(uri, testDbName) // Connect first
    dbInstance = getDB()
    t.ok(dbInstance, 'getDB should return a DB instance after connection')
    t.equal(dbInstance.databaseName, testDbName, 'DB instance from getDB should have the correct name')
  } catch (err) {
    t.fail('Connection or getDB failed unexpectedly')
    console.error(err)
  } finally {
    await closeDB()
    t.end()
  }
})

test('MongoDB Connection Teardown', async (t) => {
  // Ensure closeDB works even if called again
  await closeDB()
  console.log('Attempted closeDB again (should be safe).')

  // Stop the in-memory server after all tests
  if (mongoServer) {
    await mongoServer.stop()
    console.log('In-memory MongoDB stopped.')
  }
  t.end()
})
