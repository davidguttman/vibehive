# Tutorial 14: Add Encrypted SSH Key Field to Repository Schema

This tutorial guides you through adding a new field, `encryptedSshKey`, to the `Repository` Mongoose schema and updating the corresponding tests.

## Goal

Enhance the `Repository` model to store an encrypted SSH key, enabling future features that might require repository access via SSH.

## Prerequisites

-   Completion of previous tutorials, particularly Tutorial 10 (`10-add-context-files.md`) where the `Repository` model was introduced.
-   A working development environment with Node.js, npm, and MongoDB set up.

## Steps

### 1. Modify `models/Repository.js`

**Why?** We need to update the Mongoose schema definition to include the new field.

**How?**

*   **Open the file:** Navigate to and open `models/Repository.js`.
*   **Locate the Schema:** Find the `repositorySchema` constant.
*   **Add the Field:** Add the `encryptedSshKey` field definition within the schema object. It should be of type `String` and initially not required.

    ```javascript
    // models/Repository.js
    const mongoose = require('mongoose')

    const repositorySchema = new mongoose.Schema({
      guildId: { type: String, required: true },
      name: { type: String, required: true },
      url: { type: String, required: true },
      contextFiles: [{ type: String }], // Keep existing fields
      // Add the new field here:
      encryptedSshKey: { type: String } // Not required initially
    }, { timestamps: true })

    // Ensure unique combination of guildId and name
    repositorySchema.index({ guildId: 1, name: 1 }, { unique: true })

    module.exports = mongoose.model('Repository', repositorySchema)
    ```

*   **Check Style:** Ensure the code adheres to standard.js style. You might need to run `standard --fix` later.

### 2. Modify `test/repository.model.test.js`

**Why?** We need to update the tests to verify that the new `encryptedSshKey` field can be correctly stored and retrieved.

**How?**

*   **Open the test file:** Navigate to and open `test/repository.model.test.js`.
*   **Update Existing Tests or Add New Ones:** Modify the existing tests (or add new test cases) to include scenarios where `encryptedSshKey` is set during creation or update.
*   **Assert the Value:** Add assertions to confirm that the `encryptedSshKey` value is saved and can be retrieved accurately.

    ```javascript
    // test/repository.model.test.js
    const test = require('tape')
    const mongoose = require('mongoose')
    const Repository = require('../models/Repository') // Adjust path if needed
    const { MongoMemoryServer } = require('mongodb-memory-server')

    let mongod

    // Helper function to connect to in-memory DB
    async function connectDB (t) {
      mongod = await MongoMemoryServer.create()
      const uri = mongod.getUri()
      await mongoose.connect(uri)
      t.pass('Connected to in-memory MongoDB')
    }

    // Helper function to disconnect from DB
    async function disconnectDB (t) {
      await mongoose.disconnect()
      await mongod.stop()
      t.pass('Disconnected from in-memory MongoDB')
    }

    test('Setup MongoDB Connection', async (t) => {
      await connectDB(t)
      t.end()
    })

    test('Repository Model - Create and Save with SSH Key', async (t) => {
      const repoData = {
        guildId: 'guild-123',
        name: 'test-repo-ssh',
        url: 'git@github.com:user/test-repo-ssh.git',
        contextFiles: ['README.md'],
        encryptedSshKey: 'dummy-encrypted-key-data' // Add the new field
      }
      const repository = new Repository(repoData)
      const savedRepo = await repository.save()

      t.ok(savedRepo._id, 'Repository should be saved with an ID')
      t.equal(savedRepo.guildId, repoData.guildId, 'guildId should match')
      t.equal(savedRepo.name, repoData.name, 'name should match')
      t.equal(savedRepo.url, repoData.url, 'url should match')
      t.deepEqual(savedRepo.contextFiles.toObject(), repoData.contextFiles, 'contextFiles should match')
      t.equal(savedRepo.encryptedSshKey, repoData.encryptedSshKey, 'encryptedSshKey should match') // Assert the new field

      t.end()
    })

    test('Repository Model - Find and Update with SSH Key', async (t) => {
      const repoName = 'test-repo-ssh' // Use the repo created in the previous test
      const foundRepo = await Repository.findOne({ guildId: 'guild-123', name: repoName })
      t.ok(foundRepo, `Repository "${repoName}" should be found`)

      const updatedKey = 'updated-encrypted-key-data'
      foundRepo.encryptedSshKey = updatedKey
      const updatedRepo = await foundRepo.save()

      t.equal(updatedRepo.encryptedSshKey, updatedKey, 'encryptedSshKey should be updated')

      t.end()
    })

    // Add other existing tests back if they were removed for brevity
    // (e.g., tests for uniqueness constraint, missing required fields)

    test('Cleanup MongoDB Connection', async (t) => {
      // Optional: Clean up the test data if necessary
      await Repository.deleteMany({})
      await disconnectDB(t)
      t.end()
    })
    ```
    *(Note: The test assumes you have `mongodb-memory-server` installed and configured as shown in previous tutorials for isolated testing.)*

### 3. Run Style Check and Tests

**Why?** To ensure the code is correctly formatted and the changes haven't broken anything.

**How?**

*   **Run Standard Fix:**
    ```bash
    npx standard --fix models/Repository.js test/repository.model.test.js
    ```
*   **Run Tests:**
    ```bash
    npm test
    ```
*   **Verify Output:** Ensure all tests pass, including the ones verifying the `encryptedSshKey` field.

## Conclusion

You have successfully added the `encryptedSshKey` field to the `Repository` model and updated the tests to cover this new functionality. This prepares the application for future features requiring SSH key storage. 