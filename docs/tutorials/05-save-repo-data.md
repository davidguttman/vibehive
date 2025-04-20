# Tutorial: Saving Repository Data with `/add-repo`

This tutorial enhances the `/add-repo` command created previously. Now, instead of just acknowledging the command, we will use the `Repository` Mongoose model to save or update the repository URL associated with the specific Discord channel in our MongoDB database.

## Prerequisites

*   Completion of the previous tutorials ([01](./01-basic-discord-bot.md), [02](./02-mongodb-integration.md), [03](./03-mongoose-schema.md), [04](./04-add-repo-command.md)).
*   MongoDB connection configured and working (via `lib/mongo.js` and `.env`).

## Step 1: Update `/add-repo` Handler (`index.js`)

We need to modify the logic within the `/add-repo` command handler to interact with the database.

Modify `index.js`:

```diff
 // index.js

 // 1. Package Requires
 // ... (no changes here)

 // 2. Local Requires
 const config = require('./config')
 const { connectDB } = require('./lib/mongo')
+const Repository = require('./models/Repository') // Import the Repository model

 // 3. Constants
 // ... (no changes here)
@@ -118,11 +119,23 @@
       }

       await interaction.deferReply({ ephemeral: true })

-      // --- Placeholder for future logic (saving to DB) ---
-      console.log(`Admin ${interaction.user.tag} requested to add repo: ${repoUrl} in channel ${interaction.channelId}`);
-      // --- End Placeholder ---
+
+      // --- Database Logic --- 
+      const channelId = interaction.channelId
+      let replyMessage = ''
+
+      try {
+        // Upsert: Find a doc with the channelId, or create it if it doesn't exist.
+        // Update the repoUrl in either case.
+        const updatedRepo = await Repository.findOneAndUpdate(
+          { discordChannelId: channelId }, // Filter: find by channel ID
+          { repoUrl: repoUrl }, // Update: set the repo URL
+          { new: true, upsert: true, runValidators: true } // Options: return updated doc, create if not found, run schema validators
+        )
+
+        console.log(`Repository config updated/created for channel ${channelId}: ${updatedRepo.repoUrl}`);
+        replyMessage = `Repository configuration saved for this channel: <${repoUrl}>` // Use <> for no embed
+      } catch (dbError) {
+        console.error('Database error saving repository:', dbError);
+        // Check if it's a validation error (e.g., invalid URL format if added later)
+        if (dbError.name === 'ValidationError') {
+          replyMessage = `Error saving repository: Invalid data provided. ${Object.values(dbError.errors).map(e => e.message).join(' ')}`;
+        } else {
+          replyMessage = 'Error saving repository configuration to the database.';
+        }
+      }
+      // --- End Database Logic ---

       // Follow up after deferral
-      await interaction.followUp({ content: `Received request to add repository: ${repoUrl}`, ephemeral: true });
+      await interaction.followUp({ content: replyMessage, ephemeral: true });

     } catch (error) {
       console.error('Error handling /add-repo command:', error);

```

**Summary of `/add-repo` Handler changes:**
1.  Imported the `Repository` model at the top (`require('./models/Repository')`).
2.  Removed the placeholder `console.log`.
3.  Added a `try...catch` block specifically for the database operation.
4.  Used `Repository.findOneAndUpdate()` with the `upsert: true` option. This is ideal for this use case:
    *   It searches for a document where `discordChannelId` matches the current channel.
    *   If found, it updates the `repoUrl` field.
    *   If *not* found, it creates a *new* document with the `discordChannelId` and `repoUrl`.
    *   `new: true` ensures the updated (or newly created) document is returned.
    *   `runValidators: true` ensures schema validations are run even on updates.
5.  Based on the database operation result (success or caught error), set a `replyMessage`.
6.  Updated the `interaction.followUp` call to use the dynamic `replyMessage`.
7.  Improved the database error handling to distinguish potential validation errors from general DB errors.

## Step 2: Run the Linter

Apply standard style to the modified `index.js`:

```bash
npm run lint
```

## Step 3: Update Tests (`test/add-repo-command.test.js`)

We need to adapt the existing command test file to handle the database interaction. This involves setting up the in-memory database connection for these tests and asserting database state changes.

Modify `test/add-repo-command.test.js`:

```diff
 // test/add-repo-command.test.js
 const test = require('tape')
 const sinon = require('sinon')
 const { PermissionsBitField } = require('discord.js')
+const { MongoMemoryServer } = require('mongodb-memory-server')
+process.env.NODE_ENV = 'test' // Ensure test environment is set
+const mongoose = require('mongoose')
+const Repository = require('../models/Repository') // Load the model
+const { connectDB, closeDB } = require('../lib/mongo') // Use the refactored DB connection

 // We need to simulate the part of index.js that handles interactions
 // Normally, you might extract the handler logic into its own module,
 // but for this tutorial, we'll define a simplified mock handler.

+// --- Mocks and Helpers --- (Keep createMockInteraction as is)
+// ... createMockInteraction function ...
+
+// Simplified interaction handler logic (mirroring index.js - with DB calls)
 async function handleInteraction (interaction) {
   if (!interaction.isChatInputCommand()) return
   if (!interaction.inGuild()) {
@@ -97,9 +107,25 @@
       }

       await interaction.deferReply({ ephemeral: true })

-      // Placeholder logic would go here
-      await interaction.followUp({ content: `Received request to add repository: ${repoUrl}`, ephemeral: true })
+      // --- Database Logic (Copied from index.js for test simulation) --- 
+      const channelId = interaction.channelId
+      let replyMessage = ''
+
+      try {
+        const updatedRepo = await Repository.findOneAndUpdate(
+          { discordChannelId: channelId },
+          { repoUrl: repoUrl },
+          { new: true, upsert: true, runValidators: true }
+        )
+        console.log(`TEST: Repository config updated/created for channel ${channelId}: ${updatedRepo.repoUrl}`); // Add TEST prefix
+        replyMessage = `Repository configuration saved for this channel: <${repoUrl}>`
+      } catch (dbError) {
+        console.error('TEST: Database error saving repository:', dbError); // Add TEST prefix
+        if (dbError.name === 'ValidationError') {
+          replyMessage = `Error saving repository: Invalid data provided. ${Object.values(dbError.errors).map(e => e.message).join(' ')}`;
+        } else {
+          replyMessage = 'Error saving repository configuration to the database.';
+        }
+      }
+
+      // Follow up after deferral
+      await interaction.followUp({ content: replyMessage, ephemeral: true })
+
     } catch (error) {
       console.error('Mock handler error:', error)
       // Simplified error reply for testing
 // ... rest of handleInteraction ...
 
 // --- Test Setup and Teardown ---
+let mongoServer
+let mongoUri
+
+test('** Setup Add-Repo Tests **', async (t) => {
+  mongoServer = await MongoMemoryServer.create()
+  mongoUri = mongoServer.getUri()
+  await connectDB(mongoUri) // Connect DB for this test file
+  t.pass('Mongoose connected for Add-Repo command tests')
+  // Clean repo collection before tests
+  await Repository.deleteMany({})
+  t.pass('Repository collection cleaned')
+  t.end()
+})
+
 // --- Tests ---
 
 test('/add-repo Command - Non-Admin', async (t) => {
@@ -124,6 +150,7 @@
   t.ok(mockInteraction.stubs.deferReply.calledOnce, 'deferReply should be called once for admin')
   const deferArgs = mockInteraction.stubs.deferReply.firstCall.args[0]
   t.equal(deferArgs.ephemeral, true, 'Defer reply should be ephemeral')
+
 
   t.ok(mockInteraction.stubs.followUp.calledOnce, 'followUp should be called once after deferral')
   const followUpArgs = mockInteraction.stubs.followUp.firstCall.args[0]
-  t.equal(followUpArgs.content, `Received request to add repository: ${testUrl}`, 'Should followUp with acknowledgement and URL')
+  t.equal(followUpArgs.content, `Repository configuration saved for this channel: <${testUrl}>`, 'Should followUp with success message and URL')
   t.equal(followUpArgs.ephemeral, true, 'Acknowledgement followUp should be ephemeral')
   t.notOk(mockInteraction.stubs.reply.called, 'reply should not be called directly on success')
 
+  // Assert database state
+  const savedDoc = await Repository.findOne({ discordChannelId: mockInteraction.channelId })
+  t.ok(savedDoc, 'Document should exist in DB')
+  t.equal(savedDoc.repoUrl, testUrl, 'Saved document should have the correct repoUrl')
+
+  // Clean up this specific document
+  await Repository.deleteOne({ _id: savedDoc._id })
   t.end()
 })
 
@@ -173,3 +200,23 @@
 
   t.end()
 })
+
+// --- Database Error Test ---
+test('/add-repo Command - Database Save Error', async (t) => {
+  const testUrl = 'https://db-error-repo.com/test.git'
+  const mockInteraction = createMockInteraction({ isAdmin: true, repoUrl: testUrl })
+
+  // Stub the findOneAndUpdate method to throw an error
+  const findOneAndUpdateStub = sinon.stub(Repository, 'findOneAndUpdate').throws(new Error('Simulated DB Error'));
+
+  await handleInteraction(mockInteraction)
+
+  t.ok(mockInteraction.stubs.deferReply.calledOnce, 'deferReply should be called')
+  t.ok(mockInteraction.stubs.followUp.calledOnce, 'followUp should be called')
+  const followUpArgs = mockInteraction.stubs.followUp.firstCall.args[0]
+  t.equal(followUpArgs.content, 'Error saving repository configuration to the database.', 'Should reply with DB error message')
+
+  // Restore the original method
+  findOneAndUpdateStub.restore();
+  t.end()
+})
+
+// --- Test Teardown ---
+test('** Teardown Add-Repo Tests **', async (t) => {
+  await closeDB() // Disconnect Mongoose
+  await mongoServer.stop() // Stop the in-memory server
+  t.pass('Mongoose disconnected and server stopped for Add-Repo tests')
+  t.end()
+})
 
```

**Summary of `test/add-repo-command.test.js` changes:**
1.  Added requires for `MongoMemoryServer`, `mongoose`, `Repository` model, and `connectDB`/`closeDB`.
2.  Added test setup (`** Setup **`) to start the in-memory server, connect Mongoose, and clean the `Repository` collection before tests.
3.  Added test teardown (`** Teardown **`) to disconnect Mongoose and stop the server after tests.
4.  Updated the `handleInteraction` mock function to include the database saving logic copied from `index.js`.
5.  In the 'Admin Success' test:
    *   Updated the expected success message in `followUp`.
    *   Added assertions using `Repository.findOne` to check if the document was correctly saved/updated in the mock database.
    *   Added cleanup for the created document.
6.  Added a new test case ('Database Save Error') that uses `sinon.stub` to temporarily make `Repository.findOneAndUpdate` throw an error, then asserts that the correct error message is sent back to the user.

## Step 4: Run Tests

Verify that the updated command tests pass along with all other existing tests.

```bash
npm test
```

---

Excellent! The `/add-repo` command now successfully saves repository configurations to MongoDB using an upsert strategy. The tests verify both the successful save/update path and basic database error handling. 