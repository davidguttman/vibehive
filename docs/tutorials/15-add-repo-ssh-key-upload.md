# Tutorial 15: Upload and Encrypt SSH Key via /add-repo

This tutorial extends the `/add-repo` command to allow users to upload their SSH private key as an attachment, which will then be encrypted and stored alongside the repository configuration.

## Goal

Securely associate an SSH private key with a repository configuration by:
1.  Adding an attachment option to the `/add-repo` command.
2.  Fetching the uploaded key content.
3.  Encrypting the key using the `crypto` library.
4.  Storing the encrypted key in the `Repository` model.
5.  Updating tests to cover this new functionality.

## Prerequisites

-   Completion of Tutorial 14 (`14-add-ssh-key-field.md`) which added the `encryptedSshKey` field.
-   Completion of Tutorial 13 (`13-aes-encryption.md`) which introduced the `encrypt` function.
-   A defined `ENCRYPTION_KEY` in your `.env` file (must be 32 characters).
-   Node.js v18+ (for built-in `fetch`) or `node-fetch` installed (`npm install node-fetch`).

## Steps

### 1. Update `/add-repo` Command Registration

**Why?** We need to tell Discord that the `/add-repo` command now accepts a file attachment.

**How?**

*   **Open `deploy-commands.js`:** Locate the file responsible for registering slash commands.
*   **Modify `add-repo` definition:** Find the `SlashCommandBuilder` for `/add-repo`.
*   **Add Attachment Option:** Use the `addAttachmentOption` method to add a *required* option named `ssh_key`.

    ```javascript
    // deploy-commands.js (partial)
    const { SlashCommandBuilder } = require('discord.js');

    // ... other commands ...

    new SlashCommandBuilder()
      .setName('add-repo')
      .setDescription('Configure a Git repository for this channel.')
      .addStringOption(option =>
        option.setName('url')
          .setDescription('The SSH or HTTPS URL of the Git repository.')
          .setRequired(true))
      // Add this new option:
      .addAttachmentOption(option =>
        option.setName('ssh_key')
          .setDescription('Your SSH private key file (will be encrypted).')
          .setRequired(true)) // Make it required
      .setDefaultMemberPermissions(0) // Optional: Restrict to admins by default
      .setDMPermission(false), // Ensure command is guild-only

    // ... rest of the file ...
    ```

*   **Re-run Deployment Script:** Execute `node deploy-commands.js` to update Discord with the new command structure.

### 2. Modify `/add-repo` Command Handler (`interactionCreate.js` or dedicated handler)

**Why?** The code that runs when `/add-repo` is used needs to handle the new attachment, fetch its content, encrypt it, and save it.

**How?**

*   **Open Handler File:** Find the `interactionCreate` event handler or the specific file handling the `/add-repo` command logic (likely within an `if (commandName === 'add-repo')` block).
*   **Import `encrypt`:** Ensure the `encrypt` function from `lib/crypto.js` is imported.
*   **Fetch Dependency:** If using Node < 18, import `node-fetch` (`const fetch = require('node-fetch');`). For Node 18+, `fetch` is globally available.
*   **Retrieve Attachment:** Get the attachment object provided by the user.
*   **Fetch Key Content:** Use the attachment's URL to download the key file content.
*   **Encrypt Key:** Pass the key content to the `encrypt` function.
*   **Save to DB:** Include the `encryptedSshKey` field when creating or updating the `Repository` document.
*   **Update Confirmation:** Modify the success message to confirm the key was stored.

    ```javascript
    // interactionCreate.js (or handler file - partial)
    const Repository = require('../models/Repository');
    const { encrypt } = require('../lib/crypto'); // Import encrypt
    // const fetch = require('node-fetch'); // Uncomment if using Node < 18

    // ... inside the interactionCreate handler ...

    if (interaction.commandName === 'add-repo') {
      // ... [Existing permission checks] ...

      const repoUrl = interaction.options.getString('url');
      // --- New Attachment Handling --- START ---
      const attachment = interaction.options.getAttachment('ssh_key');

      if (!attachment) {
        return interaction.reply({ content: 'Error: SSH key attachment is missing.', ephemeral: true });
      }

      // Optional: Add checks for attachment.contentType or size if desired
      // e.g., if (!attachment.contentType?.startsWith('text/plain') && !attachment.name.endsWith('.key')) ...

      let sshKeyContent;
      try {
        const response = await fetch(attachment.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch key: ${response.statusText}`);
        }
        sshKeyContent = await response.text();
        if (!sshKeyContent) {
            throw new Error('Fetched key content is empty.');
        }
      } catch (error) {
        console.error('Error fetching SSH key attachment:', error);
        return interaction.reply({ content: 'Error fetching the SSH key file. Please try again.', ephemeral: true });
      }

      let encryptedKey;
      try {
        encryptedKey = encrypt(sshKeyContent);
      } catch (error) {
         console.error('Error encrypting SSH key:', error);
         // Provide a less specific error to the user for security
         return interaction.reply({ content: 'Error processing the SSH key. Ensure it is a valid key file.', ephemeral: true });
      }
      // --- New Attachment Handling --- END ---

      const channelId = interaction.channelId;

      try {
        // Use updateOne with upsert:true to handle both create and update
        const result = await Repository.updateOne(
          { discordChannelId: channelId },
          {
            $set: {
              repoUrl: repoUrl,
              encryptedSshKey: encryptedKey // Store the encrypted key
            },
            $setOnInsert: { discordChannelId: channelId } // Set channelId only on insert
          },
          { upsert: true, runValidators: true } // Create if not exists, validate
        );

        let confirmationMessage = '';
        if (result.upsertedId) {
          confirmationMessage = `Repository configured: ${repoUrl}. SSH key uploaded and secured.`;
        } else if (result.modifiedCount > 0) {
          confirmationMessage = `Repository configuration updated: ${repoUrl}. New SSH key uploaded and secured.`;
        } else {
          confirmationMessage = `Repository configuration unchanged (already set to ${repoUrl}). New SSH key uploaded and secured.`; // Or handle as error if needed
        }

        await interaction.followUp({ content: confirmationMessage, ephemeral: true });

      } catch (error) {
        console.error('Database error saving repository:', error);
        let userErrorMessage = 'An error occurred while saving the repository configuration.';
        if (error.code === 11000) { // Handle potential duplicate key errors if schema changes
          userErrorMessage = 'A repository is already configured for this channel.';
        } else if (error instanceof mongoose.Error.ValidationError) {
          userErrorMessage = `Validation Error: ${Object.values(error.errors).map(e => e.message).join(', ')}`;
        }
        await interaction.followUp({ content: userErrorMessage, ephemeral: true });
      }
      return; // Ensure function exits here
    }
    ```

*   **Adjust Logic:** Modify the database saving logic (`updateOne` with `upsert`) and confirmation messages as needed to fit your existing structure.

### 3. Install `node-fetch` (if needed)

**Why?** Node.js versions before 18 do not have a built-in `fetch` API.

**How?**

*   **Check Node Version:** Run `node -v`.
*   **Install (if < 18):** If your Node version is less than 18, run:
    ```bash
    npm install node-fetch@2 # Use v2 for CommonJS compatibility
    ```
*   **Require (if installed):** Remember to uncomment `const fetch = require('node-fetch');` in your handler file.

### 4. Update Tests (`test/add-repo-command.test.js`)

**Why?** Tests must be updated to simulate the attachment upload and verify the encryption and storage process.

**How?**

*   **Open Test File:** Navigate to `test/add-repo-command.test.js`.
*   **Import `encrypt` and `decrypt`:** Add `const { encrypt, decrypt } = require('../lib/crypto');`.
*   **Set Dummy Key:** Ensure `process.env.ENCRYPTION_KEY` is set to a valid 32-character key for testing.
*   **Mock `fetch`:** Use a mocking library (like `sinon` if already used, or a simple manual mock) to intercept `fetch` calls.
*   **Mock Interaction:** Modify mock interactions to include a `getAttachment` method that returns a mock attachment object with a `url` and potentially `contentType`.
*   **Add Test Cases:**
    *   Test the success path: Mock `fetch` to return a dummy SSH key string. Assert that `Repository.updateOne` (or your save method) is called with the correct `repoUrl` and an `encryptedSshKey` field containing the *encrypted* version of the dummy key.
    *   Test fetch failure: Mock `fetch` to throw an error or return a non-ok response. Assert that an appropriate error message is replied.
    *   Test encryption failure (optional but good): Provide invalid input to `encrypt` if possible, or mock `encrypt` to throw an error. Assert the correct error reply.
    *   Test missing attachment: Call the handler without mocking `getAttachment` to return anything. Assert the "missing attachment" error.

    ```javascript
    // test/add-repo-command.test.js (Example using manual mocks/stubs)
    const test = require('tape');
    const Repository = require('../models/Repository');
    const { encrypt, decrypt } = require('../lib/crypto'); // Import crypto
    const handleInteraction = require('../events/interactionCreate'); // Assuming handler is exported
    const { connectDB, closeDB } = require('../lib/mongo');
    const { MongoMemoryServer } = require('mongodb-memory-server');

    // --- Mocking Setup --- START ---
    let originalFetch;
    const mockFetch = async (url) => {
      if (url === 'http://mock-key-url.com/key') {
        return {
          ok: true,
          text: async () => '-----BEGIN RSA PRIVATE KEY-----\nMOCK KEY CONTENT\n-----END RSA PRIVATE KEY-----'
        };
      } else if (url === 'http://mock-key-url.com/fetch-error') {
          return { ok: false, statusText: 'Not Found' };
      } else if (url === 'http://mock-key-url.com/empty-key') {
          return { ok: true, text: async () => '' };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const setup = async (t) => {
      // Set a dummy encryption key for testing
      process.env.ENCRYPTION_KEY = 'a'.repeat(32);
      // Mock fetch
      originalFetch = global.fetch;
      global.fetch = mockFetch;
      // DB setup...
      const mongoServer = await MongoMemoryServer.create();
      const mongoUri = mongoServer.getUri();
      await connectDB(mongoUri);
      await Repository.deleteMany({}); // Clean slate
      t.pass('Setup complete with fetch mock and DB connection');
      return { mongoServer }; // Return server for teardown
    };

    const teardown = async (t, mongoServer) => {
        global.fetch = originalFetch; // Restore fetch
        await closeDB();
        await mongoServer.stop();
        delete process.env.ENCRYPTION_KEY;
        t.pass('Teardown complete, fetch restored, DB closed');
    };
    // --- Mocking Setup --- END ---

    test('/add-repo - Success with SSH Key Attachment', async (t) => {
      const { mongoServer } = await setup(t);
      const mockInteraction = {
        commandName: 'add-repo',
        channelId: 'test-channel-ssh',
        guildId: 'test-guild',
        member: { permissions: { has: () => true } }, // Mock admin
        options: {
          getString: (name) => name === 'url' ? 'git@github.com:test/ssh-repo.git' : null,
          getAttachment: (name) => name === 'ssh_key' ? {
            name: 'id_rsa',
            url: 'http://mock-key-url.com/key',
            contentType: 'application/octet-stream' // Example type
          } : null
        },
        deferReply: async () => t.pass('deferReply called'),
        followUp: async (options) => {
            t.ok(options.content.includes('SSH key uploaded and secured'), 'FollowUp confirms key upload');
            t.ok(options.ephemeral, 'FollowUp is ephemeral');
        }
        // reply: async () => t.fail('reply should not be called on success') // Add if using followUp
      };

      // Mock Repository.updateOne or spy on it
      let updateCallArgs;
      const originalUpdateOne = Repository.updateOne;
      Repository.updateOne = async (filter, update, options) => {
          updateCallArgs = { filter, update, options };
          // Simulate successful upsert
          return { acknowledged: true, modifiedCount: 0, upsertedId: new mongoose.Types.ObjectId(), matchedCount: 0 };
      };

      await handleInteraction(mockInteraction);

      // Assertions
      t.ok(updateCallArgs, 'Repository.updateOne should be called');
      t.equal(updateCallArgs.filter.discordChannelId, 'test-channel-ssh', 'updateOne filter uses correct channelId');
      t.equal(updateCallArgs.update.$set.repoUrl, 'git@github.com:test/ssh-repo.git', 'updateOne update sets correct repoUrl');
      t.ok(updateCallArgs.update.$set.encryptedSshKey, 'updateOne update includes encryptedSshKey');

      try {
        const decryptedKey = decrypt(updateCallArgs.update.$set.encryptedSshKey);
        t.equal(decryptedKey, '-----BEGIN RSA PRIVATE KEY-----\nMOCK KEY CONTENT\n-----END RSA PRIVATE KEY-----', 'Stored key should decrypt correctly');
      } catch (e) {
        t.fail(`Failed to decrypt stored key: ${e.message}`);
      }

      t.ok(updateCallArgs.options.upsert, 'updateOne uses upsert option');

      Repository.updateOne = originalUpdateOne; // Restore mock
      await teardown(t, mongoServer);
      t.end();
    });

    test('/add-repo - Fetch Key Failure', async (t) => {
        const { mongoServer } = await setup(t);
        const mockInteraction = {
          commandName: 'add-repo',
          channelId: 'test-channel-fetch-fail',
          guildId: 'test-guild',
          member: { permissions: { has: () => true } },
          options: {
            getString: (name) => 'git@github.com:test/fail.git',
            getAttachment: (name) => ({ url: 'http://mock-key-url.com/fetch-error' })
          },
          reply: async (options) => {
              t.ok(options.content.includes('Error fetching the SSH key file'), 'Reply indicates fetch error');
              t.ok(options.ephemeral, 'Error reply is ephemeral');
          },
          // deferReply and followUp shouldn't be called in this error path
          deferReply: async () => t.fail('deferReply should not be called'),
          followUp: async () => t.fail('followUp should not be called')
        };

        await handleInteraction(mockInteraction);

        await teardown(t, mongoServer);
        t.end();
    });

    // Add more tests for: missing attachment, empty key content, encryption error...
    ```

### 5. Run Style Check and Tests

**Why?** Ensure code formatting is correct and all functionality, including the new attachment handling and error cases, works as expected.

**How?**

*   **Run Standard Fix:**
    ```bash
    npx standard --fix deploy-commands.js events/interactionCreate.js test/add-repo-command.test.js # Adjust paths as needed
    ```
*   **Run Tests:**
    ```bash
    npm test
    ```
*   **Verify Output:** Confirm all tests pass, especially the new ones for `/add-repo` attachment handling.

## Conclusion

The `/add-repo` command can now securely accept an SSH private key as an attachment. The key is fetched, encrypted using the application's `ENCRYPTION_KEY`, and stored in the database, ready for potential future use cases like cloning private repositories directly. 