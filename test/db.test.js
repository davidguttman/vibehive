// test/db.test.js
const test = require('ava')
const { MongoMemoryServer } = require('mongodb-memory-server')
// Set NODE_ENV to 'test' before requiring modules that check it
process.env.NODE_ENV = 'test'
const mongoose = require('mongoose') // Require mongoose to check connection state
const { connectDB, getDB, closeDB } = require('../lib/mongo') // Adjust path

let mongoServer
let baseUri // Store base URI without db name

test.before('Mongoose Connection Setup', async (t) => {
  // Start in-memory MongoDB server before tests
  mongoServer = await MongoMemoryServer.create()
  baseUri = mongoServer.getUri() // Gets URI like mongodb://127.0.0.1:PORT/
  t.truthy(baseUri, 'In-memory server should provide a base URI')
  t.log(`In-memory MongoDB started at ${baseUri}`)
})

test.after.always('Mongoose Connection Teardown', async (t) => {
  // Ensure closeDB works even if called again
  await closeDB()
  t.is(mongoose.connection.readyState, 0, 'Mongoose readyState should remain 0 after second close')
  t.log('Attempted closeDB again (should be safe).')

  // Stop the in-memory server after all tests
  if (mongoServer) {
    await mongoServer.stop()
    t.log('In-memory MongoDB stopped.')
  }
  t.pass('Teardown complete')
})

test.serial('connectDB Function with Mongoose', async (t) => {
  // Mongoose derives the DB name from the URI path
  const testDbName = 'mongoose-test-db'
  const fullUri = `${baseUri}${testDbName}` // Append db name to base URI
  let dbInstance

  try {
    // Ensure any previous connection is closed before testing connectDB
    await mongoose.disconnect()
    t.log('Disconnected existing mongoose connection before connectDB test')

    // Connect using the full URI
    dbInstance = await connectDB(fullUri)
    t.truthy(dbInstance, 'connectDB should return a DB instance')
    // Check the name on the underlying connection
    t.is(mongoose.connection.name, testDbName, 'Mongoose connection name should match testDbName')
    t.is(dbInstance.databaseName, testDbName, 'Returned DB instance name should match testDbName')

    // Test connecting again (should use existing connection)
    const dbInstanceAgain = await connectDB(fullUri)
    // Note: Mongoose reuses the connection, getDB returns the same db object reference
    t.is(dbInstanceAgain, dbInstance, 'Calling connectDB again should return the same instance')
    t.is(mongoose.connection.readyState, 1, 'Mongoose readyState should be 1 (connected)')
  } catch (err) {
    t.fail('connectDB should not throw an error here')
    console.error(err)
  } finally {
    // Disconnect Mongoose after the test
    await closeDB()
    t.is(mongoose.connection.readyState, 0, 'Mongoose readyState should be 0 (disconnected) after closeDB')
  }
})

test.serial('getDB Function with Mongoose', async (t) => {
  const testDbName = 'mongoose-getdb-test'
  const fullUri = `${baseUri}${testDbName}`

  // Ensure clean state before this test
  await mongoose.disconnect()
  t.log('Disconnected existing mongoose connection before getDB test')

  // Test getDB before connection (Mongoose connection state is 0)
  // Mongoose doesn't typically throw here, getDB might return null or an inactive db object initially
  // depending on Mongoose version/exact state. Let's verify readyState instead.
  t.is(mongoose.connection.readyState, 0, 'Mongoose readyState should be 0 before connection')
  // If getDB relies on readyState > 0, it might throw, otherwise maybe not.
  // The current implementation of getDB doesn't check readyState, just returns mongoose.connection.db
  // let initialDb = getDB() // This might be null or an object
  // t.comment(`getDB before connect returned: ${initialDb}`) // Optional logging

  // Test getDB after connection
  let dbInstance
  try {
    await connectDB(fullUri) // Connect first
    t.is(mongoose.connection.readyState, 1, 'Mongoose readyState should be 1 after connection')
    dbInstance = getDB()
    t.truthy(dbInstance, 'getDB should return a DB instance after connection')
    t.is(dbInstance.databaseName, testDbName, 'DB instance from getDB should have the correct name')
  } catch (err) {
    t.fail('Connection or getDB failed unexpectedly')
    console.error(err)
  } finally {
    await closeDB()
    t.is(mongoose.connection.readyState, 0, 'Mongoose readyState should be 0 after closing')
  }
})
