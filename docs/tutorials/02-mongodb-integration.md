# Tutorial: Integrating MongoDB with the Discord Bot

This tutorial builds upon the basic Discord bot from the previous tutorial and adds MongoDB integration. We will set up a database connection, manage configuration via environment variables, and prepare for storing and retrieving data.

## Prerequisites

*   Completion of the previous tutorial ([01-basic-discord-bot.md](./01-basic-discord-bot.md))
*   A MongoDB instance (either local, cloud-hosted like MongoDB Atlas, or using the in-memory server for testing)
*   Your MongoDB connection string (URI)

## Step 1: Install Dependencies

We need the official MongoDB Node.js driver. For testing, we'll use `mongodb-memory-server`.

1.  Install the `mongodb` package:
    ```bash
    npm install mongodb
    ```

2.  Install `mongodb-memory-server` as a dev dependency:
    ```bash
    npm install --save-dev mongodb-memory-server
    ```

## Step 2: Configure Environment Variables

We need to add the MongoDB connection details to our environment configuration.

1.  Update your `.env` file with your MongoDB URI and desired database name:
    ```
    # .env
    DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE
    DISCORD_CLIENT_ID=YOUR_APPLICATION_CLIENT_ID_HERE
    MONGODB_URI=YOUR_MONGODB_CONNECTION_STRING_HERE
    MONGODB_DB_NAME=your_database_name
    ```
    Replace `YOUR_MONGODB_CONNECTION_STRING_HERE` with your actual connection string (e.g., `mongodb://localhost:27017` or an Atlas URI) and `your_database_name` with the name you want to use for the bot's database.

    **Important:** Make sure `.env` is listed in your `.gitignore` file!

## Step 3: Create Configuration Module (`config.js`)

Let's create a module to load and export our configuration values, ensuring it behaves correctly in different environments (like development vs. testing).

**Important:** Tests should *not* depend on your real `.env` file. They need to be self-contained. We will ensure our configuration loader only tries to load the `.env` file and validate its contents when *not* running in a test environment.

Create a file named `config.js` in the project root:
```javascript
// config.js

// 1. Package Requires
// Only load .env file in non-test environments
if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config()
}

// 2. Local Requires (None)

// 3. Constants
const config = {
  // Provide default empty strings for test environment if needed,
  // although tests should ideally provide their own specific config (like the DB URI)
  discordToken: process.env.DISCORD_TOKEN || '',
  discordClientId: process.env.DISCORD_CLIENT_ID || '',
  mongoURI: process.env.MONGODB_URI || '',
  mongoDBName: process.env.MONGODB_DB_NAME || ''
}

// 4. Immediately Run Code (Validation - only in non-test environments)
if (process.env.NODE_ENV !== 'test') {
  const requiredEnvVars = ['discordToken', 'discordClientId', 'mongoURI', 'mongoDBName']
  const missingEnvVars = requiredEnvVars.filter(key => !config[key])

  if (missingEnvVars.length > 0) {
    console.error(`Error: Missing required environment variables: ${missingEnvVars.join(', ')}`)
    process.exit(1)
  }
}

// 5. Module Exports
module.exports = config

// 6. Functions (None)
```
This module now conditionally loads `dotenv`. It reads environment variables but only performs the strict validation (checking if required variables are present) when `NODE_ENV` is *not* set to `'test'`. This prevents tests from failing just because a developer `.env` file isn't present or complete.

## Step 4: Create Database Connection Module (`lib/mongo.js`)

This module will handle the connection logic to MongoDB.

1.  Create a `lib` directory:
    ```bash
    mkdir lib
    ```

2.  Create a file named `lib/mongo.js`:
    ```javascript
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
    ```
This module exports `connectDB` to establish the connection, `getDB` to retrieve the database instance, and `closeDB` to disconnect (useful for tests and graceful shutdown).

## Step 5: Update Bot Entry Point (`index.js`)

Now, we need to use the config and connect to the database when the bot starts.

Modify `index.js`:

```diff
 // index.js
 
 // 1. Package Requires
-require('dotenv').config() // Load environment variables from .env file
 const { Client, GatewayIntentBits, Events, REST, Routes } = require('discord.js')
 
 // 2. Local Requires
+const config = require('./config') // Use the config module
+const { connectDB } = require('./lib/mongo') // Import connectDB
 
 // 3. Constants
-const BOT_TOKEN = process.env.DISCORD_TOKEN
-const CLIENT_ID = process.env.DISCORD_CLIENT_ID // Add your Client ID to .env
+// Use constants from config
+const { discordToken, discordClientId } = config
 
 // Simple command definition
 const commands = [
@@ -22,16 +23,7 @@
 
 // 4. Immediately Run Code
 
-// Check if token is provided
-if (!BOT_TOKEN) {
-  console.error('Error: DISCORD_TOKEN is required in your .env file')
-  process.exit(1)
-}
-if (!CLIENT_ID) {
-  console.error('Error: DISCORD_CLIENT_ID is required in your .env file')
-  process.exit(1)
-}
+// Config module already handles validation
 
 // Discord Client Setup
 const client = new Client({
@@ -43,7 +35,7 @@
 }) 
 
 // REST API setup for command registration
-const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
+const rest = new REST({ version: '10' }).setToken(discordToken);
 
 // Function to register slash commands
 (async () => {
@@ -51,7 +43,7 @@
     console.log('Started refreshing application (/) commands.')
 
     await rest.put(
-      Routes.applicationCommands(CLIENT_ID), // Register globally - takes time to propagate
+      Routes.applicationCommands(discordClientId), // Register globally - takes time to propagate
       // Use Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) for faster testing in a specific server
       { body: commands }
     )
@@ -95,8 +87,15 @@
 }) 
 
 // Login to Discord and Connect to DB
-client.login(BOT_TOKEN)
-  .then(() => console.log('Login successful!'))
+async function startBot () {
+  try {
+    await connectDB() // Connect to DB first
+    await client.login(discordToken) // Then login to Discord
+    console.log('Login successful!')
+  } catch (error) {
+    console.error('Bot failed to start:', error)
+    process.exit(1)
+  }
+}
+
+startBot() // Call the async start function
   .catch(error => {
     console.error('Login failed:', error)
     process.exit(1) // Exit if login fails

```

**Summary of `index.js` changes:**
1.  Removed direct `require('dotenv').config()` (handled by `config.js`).
2.  Required `config.js` and `lib/mongo.js`.
3.  Used `discordToken` and `discordClientId` from the config object instead of `process.env` directly.
4.  Removed the manual checks for `BOT_TOKEN` and `CLIENT_ID` (handled by `config.js`).
5.  Wrapped the login logic in an `async` function `startBot`.
6.  Called `connectDB()` *before* `client.login()` within `startBot`.
7.  Called `startBot()` to initiate the process.

## Step 6: Run the Linter

Apply standard style to the new and modified files:
```bash
npm run lint
```

## Step 7: Testing with an In-Memory Database

Let's create a test for our database connection module using the in-memory server.

Create `test/db.test.js`:

```javascript
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
  const uri = mongoServer.getUri() // Use the in-memory URI
  const testDbName = 'test-db'
  let dbInstance

  try {
    // Explicitly pass the test URI and DB name from the test setup
    dbInstance = await connectDB(uri, testDbName)
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
  const uri = mongoServer.getUri() // Use the in-memory URI
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
    // Explicitly pass the test URI and DB name
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
```

**Explanation of `test/db.test.js` changes:**
1.  **`process.env.NODE_ENV = 'test'`**: We explicitly set the environment to `'test'` *before* requiring `lib/mongo`, which in turn requires `config.js`. This ensures `config.js` knows it's in a test environment and skips loading `.env` and validating variables.
2.  **Passing Test URI/DB Name**: The tests now explicitly pass the `uri` obtained from `MongoMemoryServer` and a specific `testDbName` to `connectDB`. This makes the test independent of any configuration in `config.js` or `.env`.
3.  The rest of the logic remains the same: start server, test connection, test retrieval, clean up connection, stop server.

## Step 8: Run Tests

Make sure the database connection logic works as expected and the tests exit cleanly.

```bash
npm test
```
This time, the tests should pass regardless of whether you have a complete `.env` file, because the test environment is properly isolated. You should see output from both `ping.test.js` and `db.test.js`, indicating all tests passed.

---

Congratulations! You have successfully integrated MongoDB connection handling into your Discord bot **with proper environment separation for testing**. The bot now connects to the database on startup using `.env` for development/production, while tests use their own configuration (the in-memory server) without relying on `.env`.
