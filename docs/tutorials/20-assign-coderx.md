# Tutorial 20: Assign CoderX User on Repository Addition

This tutorial implements a mechanism to assign a specific `coderX` user ID (from a predefined pool) to each new repository added via the `/add-repo` command. This simulates assigning resources or specific environments to different repositories. It involves modifying the `Repository` model, updating the command handler logic to find and assign the next available user ID, and adding tests to verify this assignment logic.

**Goal:** Update the `/add-repo` command to automatically assign an available `coderX` ID (e.g., 'coder1', 'coder2', etc.) to new repositories, preventing additions if all IDs are in use, and test this functionality.

## Steps:

1.  **Modify `models/Repository.js` - Add `assignedUserId` Field:**
    -   Open `models/Repository.js`.
    -   Add a new field `assignedUserId` of type `String` to the `repositorySchema`.
    -   Consider adding an index if frequent lookups based on this field are expected, although for a small pool, it might not be critical initially.

    ```javascript
    // models/Repository.js
    const mongoose = require('mongoose')

    const repositorySchema = new mongoose.Schema({
      guildId: { type: String, required: true },
      name: { type: String, required: true },
      url: { type: String, required: true }, // SSH URL
      // ... other fields like sshKeyName ...
      sshKeyName: { type: String, required: true }, // Added in Prompt 14
      assignedUserId: { type: String } // <-- New field
    }, { timestamps: true })

    // Add a compound index for guildId and name for efficient lookup
    repositorySchema.index({ guildId: 1, name: 1 }, { unique: true })
    // Optional: Index for assignedUserId if needed for lookups
    // repositorySchema.index({ assignedUserId: 1 });

    module.exports = mongoose.model('Repository', repositorySchema)
    ```

2.  **Modify `/add-repo` Command Handler - Implement Assignment Logic:**
    -   Locate the handler file for the `/add-repo` command (likely in `commands/` or a similar directory, based on Prompt 15).
    -   **Define User Pool:** Define the list of available `coderX` user IDs. This can be hardcoded for simplicity or loaded from environment variables/config later.
    -   **Query Used IDs:** Before creating the new `Repository` instance, query the database to get all distinct `assignedUserId` values currently present in the `repositories` collection.
    -   **Find Available ID:** Iterate through the defined user pool. The first ID *not* found in the list of used IDs is the one to assign.
    -   **Handle Pool Exhaustion:** If all IDs from the pool are already in use, reply to the interaction with an error message (e.g., "Maximum repository limit reached. Cannot add more repositories.") and *do not* proceed with saving the repository.
    -   **Assign ID:** If an available ID is found, store it in the `assignedUserId` property of the new repository document before saving.
    -   **Update Confirmation:** Modify the success reply message to include the assigned user ID for confirmation/debugging.

    ```javascript
    // Example structure in the /add-repo command handler execute function
    const Repository = require('../models/Repository')
    // ... other requires ...

    // Define the pool of available coder users
    const CODER_USER_POOL = ['coder1', 'coder2', 'coder3', 'coder4', 'coder5']

    module.exports = {
      // ... command definition ...
      async execute (interaction) {
        await interaction.deferReply({ ephemeral: true })

        const repoName = interaction.options.getString('name')
        const repoUrl = interaction.options.getString('url') // SSH URL
        const guildId = interaction.guildId

        try {
          // 1. Check if repo with the same name already exists (existing logic)
          const existingRepo = await Repository.findOne({ guildId, name: repoName })
          if (existingRepo) {
            return interaction.editReply(`Repository '${repoName}' already exists.`)
          }

          // --- Coder User Assignment Logic ---
          // 2. Find currently used assignedUserIds
          const usedIdsResult = await Repository.distinct('assignedUserId')
          const usedIds = new Set(usedIdsResult.filter(id => id != null)) // Filter out null/undefined if necessary

          // 3. Find the first available ID from the pool
          let assignedUserId = null
          for (const userId of CODER_USER_POOL) {
            if (!usedIds.has(userId)) {
              assignedUserId = userId
              break
            }
          }

          // 4. Handle pool exhaustion
          if (!assignedUserId) {
            return interaction.editReply('Maximum repository limit reached. Cannot add more repositories.')
          }
          // --- End Coder User Assignment Logic ---

          // 5. Generate SSH key (existing logic from Prompt 14/15)
          const keyName = `repo_${guildId}_${repoName}`
          // ... logic to generate key, save it securely (e.g., Vault/disk) ...
          // const publicKey = await generateAndStoreSshKey(keyName); // Placeholder

          // 6. Create and save the new repository document WITH the assignedUserId
          const newRepo = new Repository({
            guildId,
            name: repoName,
            url: repoUrl,
            sshKeyName: keyName,
            assignedUserId // <-- Assign the found ID
          })
          await newRepo.save()

          // 7. Update confirmation message
          // Include publicKey and assignedUserId in the reply
          await interaction.editReply(
            `Repository '${repoName}' added successfully! Assigned User ID: ${assignedUserId}.\\n\\n` +
            `Public SSH Key (${keyName}):\\n\`\`\`\\n${/* publicKey */ 'ssh-rsa AAA...'}\\n\`\`\`\\n` +
            `Please add this public key as a deploy key with write access in your repository settings.`
          )
        } catch (error) {
          console.error('Error adding repository:', error)
          // Ensure reply is sent even on error
          if (!interaction.replied && !interaction.deferred) {
             await interaction.reply({ content: 'An error occurred while adding the repository.', ephemeral: true })
          } else {
             await interaction.editReply('An error occurred while adding the repository.')
          }
        }
      }
    }

    // Helper function placeholder (implement actual SSH key generation/storage)
    // async function generateAndStoreSshKey(keyName) {
    //   // ... returns publicKey ...
    //   return 'ssh-rsa AAA...'
    // }
    ```
    *Self-correction: Added check for pool exhaustion (`!assignedUserId`) and ensured the reply includes the assigned ID.*

3.  **Run `standard --fix`:**
    -   Ensure code style consistency.

    ```bash
    npx standard --fix models/Repository.js path/to/add-repo-command.js
    ```

4.  **Modify `test/add-repo-command.test.js` - Add Test Cases:**
    -   Open the test file for the `/add-repo` command.
    -   Ensure tests use an in-memory MongoDB setup (`mongodb-memory-server`).
    -   **Test Case 1: First Repo:**
        -   Start with an empty database.
        -   Execute the `/add-repo` command.
        -   Assert that the reply message contains "Assigned User ID: coder1".
        -   Query the database and assert that the created repository document has `assignedUserId: 'coder1'`.
    -   **Test Case 2: Next Available Repo:**
        -   Seed the database with two repositories having `assignedUserId: 'coder1'` and `assignedUserId: 'coder2'`.
        -   Execute the `/add-repo` command for a *new* repository.
        -   Assert that the reply message contains "Assigned User ID: coder3".
        -   Query the database and assert that the newly created repository document has `assignedUserId: 'coder3'`.
    -   **Test Case 3: Pool Exhausted:**
        -   Seed the database with repositories assigned to all users in the pool (`coder1` through `coder5`).
        -   Execute the `/add-repo` command.
        -   Assert that the reply message is exactly "Maximum repository limit reached. Cannot add more repositories.".
        -   Query the database and assert that *no* new repository document was created (the count remains the same as the seeded count).

    ```javascript
    // test/add-repo-command.test.js
    const test = require('ava')
    const mongoose = require('mongoose')
    const { MongoMemoryServer } = require('mongodb-memory-server')
    const Repository = require('../models/Repository') // Adjust path
    const addRepoCommand = require('../commands/add-repo') // Adjust path

    // Define the same pool as in the command
    const CODER_USER_POOL = ['coder1', 'coder2', 'coder3', 'coder4', 'coder5']

    let mongod

    // Start MongoDB server before tests
    test.before(async t => {
      // IMPORTANT: Specify a compatible MongoDB version if needed (like in previous steps)
      mongod = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger', dbPath: './.test-db', port: 27018 }, binary: { version: '4.4.6' } })
      const uri = mongod.getUri()
      await mongoose.connect(uri)
    })

    // Clear database before each test
    test.beforeEach(async t => {
      await Repository.deleteMany({})
    })

    // Stop MongoDB server after tests
    test.after.always(async t => {
      await mongoose.disconnect()
      await mongod.stop()
    })

    // Mock Interaction object
    const createMockInteraction = (options = {}) => ({
      guildId: 'test-guild',
      options: {
        getString: (key) => options[key] || null
      },
      deferred: false,
      replied: false,
      deferReply: async function () { this.deferred = true; return Promise.resolve() },
      editReply: async function (message) { this.replied = true; this.replyMessage = message; return Promise.resolve() },
      reply: async function (message) { this.replied = true; this.replyMessage = message.content || message; return Promise.resolve() } // Handle simple string or object replies
    })

    test('adds first repo and assigns coder1', async t => {
      const interaction = createMockInteraction({ name: 'repo1', url: 'git@github.com:test/repo1.git' })
      await addRepoCommand.execute(interaction)

      // Assert reply includes assigned user ID
      t.true(interaction.replyMessage.includes('Assigned User ID: coder1'))

      // Assert database state
      const repo = await Repository.findOne({ guildId: 'test-guild', name: 'repo1' })
      t.truthy(repo)
      t.is(repo.assignedUserId, 'coder1')
      t.is(repo.url, 'git@github.com:test/repo1.git')
    })

    test('adds subsequent repo and assigns next available ID (coder3)', async t => {
      // Seed DB
      await Repository.create([
        { guildId: 'test-guild', name: 'repo-a', url: '...', sshKeyName: 'key-a', assignedUserId: 'coder1' },
        { guildId: 'test-guild', name: 'repo-b', url: '...', sshKeyName: 'key-b', assignedUserId: 'coder2' }
      ])

      const interaction = createMockInteraction({ name: 'repo-c', url: 'git@github.com:test/repo-c.git' })
      await addRepoCommand.execute(interaction)

      // Assert reply includes assigned user ID
      t.true(interaction.replyMessage.includes('Assigned User ID: coder3'))

      // Assert database state
      const repo = await Repository.findOne({ guildId: 'test-guild', name: 'repo-c' })
      t.truthy(repo)
      t.is(repo.assignedUserId, 'coder3')
    })

    test('fails to add repo when user pool is exhausted', async t => {
      // Seed DB with all users assigned
      const seedData = CODER_USER_POOL.map((userId, index) => ({
        guildId: 'test-guild',
        name: `repo-${index}`,
        url: `git@github.com:test/repo-${index}.git`,
        sshKeyName: `key-${index}`,
        assignedUserId: userId
      }))
      await Repository.insertMany(seedData)

      const initialCount = await Repository.countDocuments()
      t.is(initialCount, CODER_USER_POOL.length)

      const interaction = createMockInteraction({ name: 'repo-new', url: 'git@github.com:test/repo-new.git' })
      await addRepoCommand.execute(interaction)

      // Assert error reply
      t.is(interaction.replyMessage, 'Maximum repository limit reached. Cannot add more repositories.')

      // Assert no new repo was created
      const finalCount = await Repository.countDocuments()
      t.is(finalCount, initialCount) // Count should not have changed
    })
    ```
    *Self-correction: Ensured the mock interaction handles `reply` for the error case. Added specific MongoDB version to `MongoMemoryServer.create` matching previous fixes.*

5.  **Run Tests:**
    -   Execute the test suite to ensure all new and existing tests pass.

    ```bash
    npm test
    ```

This completes the implementation of assigning `coderX` users to repositories, including handling limits and verifying the logic with tests. 