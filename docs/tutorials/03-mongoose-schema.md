# Tutorial: Defining a Mongoose Schema for Repositories

This tutorial introduces Mongoose, an Object Data Modeling (ODM) library for MongoDB and Node.js. We'll use it to define a structured schema for storing repository information in our database, replacing the direct driver usage for connection handling.

## Prerequisites

*   Completion of the previous tutorials ([01](./01-basic-discord-bot.md), [02](./02-mongodb-integration.md)).
*   MongoDB instance available (real or in-memory server for testing).

## Step 1: Install Mongoose

Add Mongoose to the project dependencies.

```bash
npm install mongoose
```

## Step 2: Update Database Connection Logic (`lib/mongo.js`)

We'll refactor `lib/mongo.js` to use Mongoose for managing the database connection. This simplifies connection handling and provides a central point for Mongoose configuration.

Replace the contents of `lib/mongo.js` with the following:

```javascript
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
```

**Summary of `lib/mongo.js` changes:**
1.  Replaced the `mongodb` driver requirement with `mongoose`.
2.  Removed the need for `mongoDBName` from config (Mongoose gets it from the URI or options).
3.  Removed manual client/db state variables; Mongoose manages the connection state.
4.  Updated `connectDB` to use `mongoose.connect()`. It handles reconnect logic and pooling automatically. We only call it if the connection is not already established.
5.  Added event listeners for Mongoose connection events for better logging and debugging.
6.  Updated `getDB` to return `mongoose.connection.db`, which gives access to the underlying native MongoDB driver's database object if needed.
7.  Updated `closeDB` to use `mongoose.disconnect()`.

## Step 3: Update `index.js` (Optional Check)

Our previous changes in `index.js` already call `connectDB` on startup. Since we kept the exported function names the same (`connectDB`) and `getDB` still provides a compatible interface (the underlying DB object), no changes are strictly *required* in `index.js` for the connection logic to work with Mongoose.

## Step 4: Create Repository Model (`models/Repository.js`)

Now, let's define the structure for our repository data.

1.  Create a `models` directory:
    ```bash
    mkdir models
    ```
2.  Create the model file `models/Repository.js`:
    ```javascript
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
      }
      // Add more fields as needed later (e.g., last commit checked, owner, etc.)
    }, {
      timestamps: true // Automatically add createdAt and updatedAt fields
    })

    // 4. Immediately Run Code (None)

    // 5. Module Exports
    module.exports = mongoose.model('Repository', repositorySchema)

    // 6. Functions (None)
    ```

**Explanation:**
*   We require `mongoose`.
*   We define a `repositorySchema` using `new mongoose.Schema()`.
*   `repoUrl`: A required String.
*   `discordChannelId`: A required String, must be unique across all documents in the collection, and is indexed for efficiency.
*   `{ timestamps: true }`: An option to automatically manage `createdAt` and `updatedAt` fields for each document.
*   `mongoose.model('Repository', repositorySchema)`: Creates the Mongoose model. Mongoose will automatically look for the plural, lowercased version of your model name for the collection (i.e., `repositories`).

## Step 5: Run the Linter

Apply standard style to the new and modified files:

```bash
npm run lint
```

## Step 6: Testing the Repository Model

We need a new test file to verify our Mongoose model works correctly.

Create `test/repository.model.test.js`:

```javascript
// test/repository.model.test.js
const test = require('tape')
const { MongoMemoryServer } = require('mongodb-memory-server')
process.env.NODE_ENV = 'test' // Ensure test environment is set
const mongoose = require('mongoose')
const Repository = require('../models/Repository') // Load the model
const { connectDB, closeDB } = require('../lib/mongo') // Use the refactored DB connection

let mongoServer
let mongoUri

test('** Setup Mongoose Connection **', async (t) => {
  mongoServer = await MongoMemoryServer.create()
  mongoUri = mongoServer.getUri()
  await connectDB(mongoUri) // Connect using our DB module
  t.pass('Mongoose connected for Repository tests')
  t.end()
})

test('Repository Model - Save Success', async (t) => {
  const validRepoData = {
    repoUrl: 'https://github.com/user/repo.git',
    discordChannelId: 'channel123'
  }
  const repository = new Repository(validRepoData)

  try {
    const savedRepo = await repository.save()
    t.ok(savedRepo._id, 'Should save successfully and return an _id')
    t.equal(savedRepo.repoUrl, validRepoData.repoUrl, 'Saved repoUrl should match')
    t.equal(savedRepo.discordChannelId, validRepoData.discordChannelId, 'Saved discordChannelId should match')
    t.ok(savedRepo.createdAt, 'Should have createdAt timestamp')
    t.ok(savedRepo.updatedAt, 'Should have updatedAt timestamp')
  } catch (err) {
    t.fail('Should not throw validation error for valid data')
    console.error(err)
  } finally {
    // Clean up the created document
    await Repository.deleteMany({ discordChannelId: validRepoData.discordChannelId })
    t.end()
  }
})

test('Repository Model - Validation Error (Missing repoUrl)', async (t) => {
  const invalidRepoData = {
    // repoUrl is missing
    discordChannelId: 'channel456'
  }
  const repository = new Repository(invalidRepoData)

  try {
    await repository.save()
    t.fail('Should have thrown a validation error for missing repoUrl')
  } catch (err) {
    t.ok(err instanceof mongoose.Error.ValidationError, 'Error should be a Mongoose ValidationError')
    t.ok(err.errors.repoUrl, 'Error details should mention repoUrl')
    t.equal(err.errors.repoUrl.kind, 'required', 'Error kind should be required')
  } finally {
    t.end()
  }
})

test('Repository Model - Validation Error (Missing discordChannelId)', async (t) => {
  const invalidRepoData = {
    repoUrl: 'https://github.com/user/another.git'
    // discordChannelId is missing
  }
  const repository = new Repository(invalidRepoData)

  try {
    await repository.save()
    t.fail('Should have thrown a validation error for missing discordChannelId')
  } catch (err) {
    t.ok(err instanceof mongoose.Error.ValidationError, 'Error should be a Mongoose ValidationError')
    t.ok(err.errors.discordChannelId, 'Error details should mention discordChannelId')
  } finally {
    t.end()
  }
})

test('Repository Model - Uniqueness Error (discordChannelId)', async (t) => {
  const repoData1 = { repoUrl: 'url1', discordChannelId: 'uniqueChannel789' }
  const repoData2 = { repoUrl: 'url2', discordChannelId: 'uniqueChannel789' } // Same channel ID

  try {
    await new Repository(repoData1).save()
    t.pass('First repository saved successfully')
    await new Repository(repoData2).save()
    t.fail('Should have thrown a uniqueness error on discordChannelId')
  } catch (err) {
    // Mongoose uniqueness error code is 11000
    t.ok(err.code === 11000 || err.message.includes('duplicate key'), 'Error should indicate a duplicate key violation')
  } finally {
    // Clean up
    await Repository.deleteMany({ discordChannelId: 'uniqueChannel789' })
    t.end()
  }
})

test('** Teardown Mongoose Connection **', async (t) => {
  await closeDB() // Disconnect Mongoose
  await mongoServer.stop() // Stop the in-memory server
  t.pass('Mongoose disconnected and server stopped')
  t.end()
})
```

**Explanation of `test/repository.model.test.js`:**
1.  Sets `NODE_ENV = 'test'`.
2.  Requires `tape`, `MongoMemoryServer`, `mongoose`, the `Repository` model, and our `connectDB`/`closeDB` functions.
3.  Uses a setup test (`** Setup **`) to start the memory server and connect Mongoose *once* before all model tests.
4.  Tests successful saving of valid data.
5.  Tests validation failures for missing required fields (`repoUrl`, `discordChannelId`).
6.  Tests the `unique` constraint on `discordChannelId`.
7.  Includes cleanup (`Repository.deleteMany`) within relevant tests where data is created.
8.  Uses a teardown test (`** Teardown **`) to disconnect Mongoose and stop the memory server *once* after all tests.

## Step 7: Run Tests

Verify that the new model tests pass along with the existing tests.

```bash
npm test
```

You should see output including the new `repository.model.test.js` tests passing.

---

Well done! You've switched the project's database interaction layer to use Mongoose, defined a schema and model for repositories, and added tests to verify its behavior, including validation and uniqueness constraints. 