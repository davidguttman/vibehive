# Tutorial 22: Git Clone on Repository Addition

This tutorial modifies the `/add-repo` command to automatically clone the specified Git repository using the provided SSH key after the repository configuration is successfully created or updated. It leverages the secure key handling and user assignment mechanisms implemented in previous tutorials. Special attention is paid to robust error handling, resource cleanup, and preventing hanging processes, especially during testing.

**Goal:** Enhance the `/add-repo` command to securely clone the repository using `git clone`, handling potential errors and ensuring proper cleanup of temporary resources. **All tests must be run within the project's Docker container environment.**

## Prerequisites

*   Completion of all previous tutorials, especially:
    *   Tutorial 13: AES Encryption/Decryption
    *   Tutorial 16: Secure SSH Key Handling (`lib/secureKeys.js`, `REPO_BASE_DIR`)
    *   Tutorial 17: Injecting SSH Key via `GIT_SSH_COMMAND`
    *   Tutorial 20: Assign CoderX User
    *   Tutorial 21: Sudo Wrapper for Secure Keys
*   Necessary environment variables are set (`ENCRYPTION_KEY`, `REPO_BASE_DIR`, etc.) and accessible *within* the Docker container.
*   A working Docker environment (`docker` or `docker compose`) configured to run the application and its associated services (like MongoDB).
*   The Docker container environment must have `git`, `sudo`, `chown`, `mkdir`, `rm`, and the necessary coder users (`coder1`, etc.) configured.
*   **Crucially: All development, linting, and testing commands (`npm test`, `standard --fix`, etc.) MUST be executed *inside* the running Docker container** (e.g., via `docker exec` or `docker compose run`).

## Step 1: Prepare the `/add-repo` Command Handler

Open the event handler file `events/interactionCreate.js`. Locate the `handleAddRepoCommand` function (or the part of the `execute` function that handles `interaction.commandName === 'add-repo'`). We need to add necessary imports and integrate the cloning logic within this function.

First, add the required imports at the top of `events/interactionCreate.js`:

```javascript
// events/interactionCreate.js
const path = require('node:path')
const fs = require('node:fs/promises')
const { execFileSync, spawn } = require('node:child_process') // Use execFileSync for chown, spawn for git clone
const { decrypt } = require('../lib/crypto') // Already imported? Verify.
const { writeTempKey, deleteTempKey } = require('../lib/secureKeys')
const config = require('../config') // Assuming config holds REPO_BASE_DIR
const Repository = require('../models/Repository') // Already imported? Verify.
// ... other imports ...
```

Next, modify the existing `handleAddRepoCommand` function (or the relevant section in `execute`) to include the directory creation, ownership change, key decryption, clone execution, and error handling logic.

```javascript
// events/interactionCreate.js

// ... other helper functions like handleFilesCommand, etc. ...

async function handleAddRepoCommand (interaction) {
  // Permission Check (Existing) ...

  // --- Note: Existing deferReply, get options (repoUrl, attachment), key fetch/encrypt ---
  // The existing logic fetches the repoUrl and the encryptedSshKey. We will use these.
  // The coder user assignment logic also already exists and assigns `assignedUserId`.

  // Assign these early for use in potential cleanup blocks
  let repoPath = null
  let keyFilePath = null
  let repoSaved = false // Track if the DB save happened (or rather, if the record was updated/upserted)

  try {
    // === INSERT / MODIFY CORE LOGIC HERE ===
    // Existing logic already gets repoUrl, fetches/decrypts key into `encryptedKey`, assigns `assignedUserId`.

    // --- Get existing repo data (needed for repo name) or create new one ---
    // The existing logic uses updateOne with upsert. We need the repo 'name'
    // for directory creation. Let's assume the channel name or ID can be used,
    // or derive it from the repoUrl if necessary.
    // ** IMPORTANT: This tutorial assumes a `name` field exists or can be derived. **
    // ** The current `events/interactionCreate.js` doesn't explicitly store a repo `name`. **
    // ** Let's use `interaction.channelId` as a unique identifier for the directory **
    const repoName = interaction.channelId // Simplification for unique dir name
    const repoUrl = interaction.options.getString('repository') // Already fetched
    const encryptedSshKey = interaction.options.getString('ssh_key_encrypted'); // Assume this is available after fetch/encrypt steps
    const assignedUserId = interaction.options.getString('assigned_user_id'); // Assume this is available after assignment step

    if (!assignedUserId) {
      // This check should ideally happen earlier during the assignment phase
       return interaction.followUp('Internal Error: Could not assign a Coder User ID.')
    }
    if (!encryptedSshKey) {
        // This should be caught during the key fetch/encrypt phase
        return interaction.followUp('Internal Error: Encrypted SSH Key is missing.')
    }

    // --- Create Repo Directory ---
    // Using channelId ensures uniqueness within the base directory
    const repoDirName = `${interaction.guildId}-${repoName}` // e.g., guildId-channelId
    repoPath = path.join(config.repoBaseDir, repoDirName)
    await fs.mkdir(repoPath, { recursive: true })
    console.log(`Created directory: ${repoPath}`)

    // --- Set Directory Ownership ---
    console.log(`Changing ownership of ${repoPath} to ${assignedUserId}`)
    // Ensure sudo and chown are available in the Docker container
    execFileSync('sudo', ['chown', `${assignedUserId}:${assignedUserId}`, repoPath])
    console.log(`Ownership changed successfully.`)

    // --- Prepare SSH Key and Environment ---
    const decryptedKey = decrypt(encryptedSshKey) // Use the fetched/encrypted key
    if (!decryptedKey) {
      // Decryption error should be handled earlier, but double-check
      throw new Error('Failed to decrypt SSH key.')
    }
    // Use assignedUserId and repoDirName for temp key scoping
    keyFilePath = await writeTempKey({ repoName: repoDirName, keyContent: decryptedKey, ownerUserId: assignedUserId })
    console.log(`Temporary SSH key written to: ${keyFilePath}`)
    const gitSshCommand = `ssh -i ${keyFilePath} -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no`
    const spawnEnv = {
      ...process.env,
      GIT_SSH_COMMAND: gitSshCommand
    }

    // --- Save/Update Repository Document in DB ---
    // The existing logic uses updateOne upsert. This should happen *before* cloning.
    // We need to ensure the assignedUserId and encryptedSshKey are part of the $set operation.
    // Let's assume the existing logic correctly saves these fields.
    const dbResult = await Repository.updateOne(
      { discordChannelId: interaction.channelId },
      {
        $set: {
          repoUrl,
          encryptedSshKey: encryptedSshKey,
          assignedUserId
        },
        $setOnInsert: { discordChannelId: interaction.channelId }
      },
      { upsert: true, runValidators: true }
    )
    // Mark DB operation as completed (or at least attempted)
    repoSaved = dbResult.acknowledged // Or check modifiedCount/upsertedId

    console.log(`Repository document saved/updated for channel ${interaction.channelId}`)

    // --- Execute Git Clone ---
    console.log(`Attempting to clone ${repoUrl} into ${repoPath} as user ${assignedUserId}`)
    const cloneProcess = spawn('sudo', ['-u', assignedUserId, 'git', 'clone', repoUrl, '.'], {
      cwd: repoPath, // Set the working directory for the clone command
      env: spawnEnv, // Pass the environment with GIT_SSH_COMMAND
      stdio: ['ignore', 'pipe', 'pipe'] // Ignore stdin, pipe stdout/stderr
    })

    let cloneStdout = ''
    let cloneStderr = ''
    cloneProcess.stdout.on('data', (data) => { cloneStdout += data.toString(); console.log(`Clone stdout: ${data}`) })
    cloneProcess.stderr.on('data', (data) => { cloneStderr += data.toString(); console.error(`Clone stderr: ${data}`) })

    const cloneExitCode = await new Promise((resolve, reject) => {
      cloneProcess.on('close', resolve)
      cloneProcess.on('error', (err) => {
        // Ensure spawn errors are also caught
        console.error('Spawn error during git clone:', err);
        reject(err);
       });
    })

    console.log(`Git clone process exited with code ${cloneExitCode}`)

    if (cloneExitCode !== 0) {
      // --- Clone Failed ---
      console.error(`Git clone failed with code ${cloneExitCode}. Stderr: ${cloneStderr}`)
      // Throw an error to trigger the catch block for cleanup
      throw new Error(`Failed to clone repository. Exit code: ${cloneExitCode}. Details logged. Stderr: ${cloneStderr.substring(0, 200)}...`)
    } else {
      // --- Clone Succeeded ---
      console.log(`Repository cloned successfully into ${repoPath}. Stdout: ${cloneStdout}`)
      // Update reply on success
      await interaction.followUp( // Use followUp since we deferred
        `✅ Repository '${repoUrl}' configured, cloned successfully, and assigned User ID: ${assignedUserId}.`
      )
    }
    // === END OF INSERTED/MODIFIED CORE LOGIC ===

  } catch (error) {
    console.error(`Error in /add-repo for channel ${interaction.channelId}:`, error)

    // --- Error Handling and Cleanup ---
    // Reply with error before cleanup attempts
    const errorMessage = error.message.includes('Failed to clone')
      ? `❌ ${error.message}`
      : `❌ An unexpected error occurred: ${error.message}`

    try {
         await interaction.followUp({ content: errorMessage.substring(0, 1900), ephemeral: true }) // Limit length for Discord
    } catch (replyError) {
         console.error('Failed to send error reply:', replyError)
    }

    // Cleanup: Remove directory if created
    if (repoPath) {
      console.log(`Cleaning up potentially failed repo directory: ${repoPath}`)
      try {
        // Use simple rm since the base directory should be writable by the bot process
        // If permissions are strict, might need: execFileSync('sudo', ['rm', '-rf', repoPath])
        await fs.rm(repoPath, { recursive: true, force: true })
        console.log(`Cleaned up directory: ${repoPath}`)
      } catch (cleanupErr) {
        console.error(`Failed to clean up directory ${repoPath}:`, cleanupErr)
        // Log failure, but don't block further cleanup
      }
    }

    // Cleanup: Potentially revert DB changes?
    // Reverting DB changes on clone failure is complex, especially with upsert.
    // Option 1: Delete the document if it was newly created by this operation (check dbResult.upsertedId).
    // Option 2: Log the inconsistency but leave the DB record (simpler).
    // Current tutorial structure suggests deleting the document if `repoSaved` was true.
    // Adapting this for upsert is tricky. Let's stick to logging for now.
    if (repoSaved) {
       console.warn(`Clone failed for channel ${interaction.channelId} after DB record was potentially saved/updated. Manual review might be needed if cleanup fails.`)
       // If you need to delete on failure:
       // if (dbResult && dbResult.upsertedId) {
       //   try {
       //      await Repository.deleteOne({ _id: dbResult.upsertedId });
       //      console.log(`Deleted newly inserted Repository document for channel ${interaction.channelId} due to clone error.`);
       //   } catch (dbDeleteError) { // ... }
       // }
    }
    // --- End Error Handling ---

  } finally {
    // --- Final Cleanup ---
    // Always try to delete the temporary SSH key if its path was set
    if (keyFilePath && assignedUserId) {
      console.log(`Finally block: Cleaning up temporary SSH key for user ${assignedUserId}...`)
      try {
        // Need repoDirName from try block for consistency
        const repoDirName = path.basename(repoPath || `dummy-${Date.now()}`) // Get dir name if repoPath exists
        await deleteTempKey({ repoName: repoDirName, ownerUserId: assignedUserId })
        console.log(`Successfully deleted temporary key file: ${keyFilePath}`)
      } catch (cleanupError) {
        console.error(`Error cleaning up temporary SSH key ${keyFilePath}:`, cleanupError)
      }
    }
    // --- End Final Cleanup ---
  }
}

// ... existing module.exports with execute function ...
// Ensure the execute function calls handleAddRepoCommand for the correct command name:
module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
    // ... existing handlers for message mentions ...

		if (!interaction.isChatInputCommand()) return;

    console.log(`Received command: ${interaction.commandName}`); // Log received command

    // Route commands to specific handlers
    if (interaction.commandName === 'add-repo') {
      await handleAddRepoCommand(interaction); // <<< Ensure this call exists
    } else if (interaction.commandName === 'files') {
      await handleFilesCommand(interaction);
    } else if (interaction.commandName === 'add') {
      await handleAddCommand(interaction);
    } else if (interaction.commandName === 'drop') {
      await handleDropCommand(interaction);
    } else {
      // Handle other commands or provide a default response
      console.log(`Command ${interaction.commandName} not explicitly handled by interactionCreate.`);
      // Find command in client.commands collection (if using separate files)
      const command = interaction.client.commands.get(interaction.commandName);
      if (command) {
        try {
          await command.execute(interaction);
        } catch (error) {
          console.error(`Error executing command ${interaction.commandName}:`, error);
          // Generic error reply
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error executing this command!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error executing this command!', ephemeral: true });
          }
        }
      } else {
         console.error(`No command matching ${interaction.commandName} was found.`);
         await interaction.reply({ content: 'Command not found.', ephemeral: true });
      }
    }
	},
};

```

**Important Considerations:**

*   **Repo Name:** The original tutorial assumed a `repoName` variable. The provided `events/interactionCreate.js` uses `discordChannelId` as the primary key. The updated code uses `interaction.channelId` to construct a unique `repoDirName`. Ensure `config.repoBaseDir` is configured.
*   **Existing Logic:** The provided snippet assumes the logic for fetching the URL, fetching/encrypting the key (`encryptedKey`), and assigning the user (`assignedUserId`) already exists within `handleAddRepoCommand` before the `// === INSERT / MODIFY CORE LOGIC HERE ===` comment. You need to integrate the new logic correctly around your existing code.
*   **Error Handling/DB Cleanup:** Reverting database changes (especially upserts) on clone failure adds complexity. The example above prioritizes cleaning up the filesystem (`repoPath`) and the temporary key (`keyFilePath`). It includes a placeholder for potentially deleting a newly created DB record if needed.
*   **Imports:** Double-check that all necessary modules (`path`, `fs/promises`, `child_process`, `crypto`, `secureKeys`, `config`, `Repository`) are imported at the top of `events/interactionCreate.js`.

## Step 2: Preventing Hanging Tests and Processes

Executing external processes like `git clone` via `spawn` still introduces potential points of failure and hangs, even when running inside Docker. While the container provides the necessary system commands (`git`, `sudo`), careful handling of the Node.js `child_process` module remains vital.

**Common Causes of Hangs (Remain Relevant):**

1.  **Unclosed Streams:** Not properly handling `stdout`, `stderr`, or `stdin` of the child process.
2.  **Unresolved Promises:** Forgetting to `await` promises or not having `resolve`/`reject` paths for all outcomes in Promise constructors.
3.  **Process Not Exiting:** The child process (`git clone` or `sudo`) itself hangs or waits for input we didn't provide.
4.  **Resource Locks:** File system operations or other resources not being released.
5.  **Test Runner Issues:** The test runner itself not correctly handling asynchronous operations or timeouts within the container.

**Strategies to Prevent Hangs (Container Context):**

1.  **Robust `finally` Blocks (Implemented Above):**
    *   **Pros:** Still essential for resource cleanup (temp keys, potentially database state) within the container, regardless of success or failure.
    *   **Cons:** Still doesn't prevent the process hang itself.
    *   **Our Use:** `finally` ensures `deleteTempKey` is attempted.

2.  **Explicit Process Termination (`child.kill()`):**
    *   **Pros:** Can still terminate a runaway `git clone` or `sudo` process *within* the container.
    *   **Cons:** Same risks of inconsistent state. Use with timeouts as a fallback.
    *   **Example (Conceptual - same logic applies inside container):**
        ```javascript
        // ... timeout logic remains the same ...
        ```

3.  **Careful `spawn`/`execFile` Usage & Promise Handling (Implemented Above):**
    *   **Pros:** This remains the primary strategy. Correctly handling `stdio`, `close`, and `error` events from `spawn` is key, even when `git` and `sudo` are readily available in the container.
    *   **Cons:** Requires diligent implementation.
    *   **Our Use:** We use `spawn`, handle `stdout`/`stderr`, and wrap the `close`/`error` events in a Promise which we `await`.

**Chosen Approach & Emphasis (Container Context):**

Our implementation continues to rely on **Strategy 3 (Careful Async Handling)** and **Strategy 1 (Robust `finally` Cleanup)**.

*   **For Tests (Inside Docker):**
    *   **No Need to Mock System Commands:** Since tests run *inside* the container, you **do not** need to mock `child_process` calls for `sudo`, `git`, `chown`, `mkdir`, or `rm`. The actual container commands will run. You might still mock `fs` if you want to prevent *actual* file system writes during a specific unit test, but often letting it write to ephemeral test directories is fine.
    *   **Focus Mocking on External/Controlled Dependencies:** Mocking should focus on:
        *   Database interactions (`../models/Repository`) to control state and avoid reliance on a persistent DB during unit/integration tests (unless specifically testing DB interaction). Use an in-memory DB or targeted database seeding/cleanup within the container.
        *   External APIs (Discord interactions via `interaction`).
        *   Modules with side effects you want to isolate (`../lib/crypto`, `../lib/secureKeys`).
    *   **Cleanup:** Ensure tests clean up any state they create *within the container* (e.g., created directories via `fs.rm`, temporary keys via `deleteTempKey`, database entries). The `finally` block in the command helps, but test-specific setup/teardown might be needed.
    *   **Async/Timers:** If using fake timers (`sinon.useFakeTimers`), ensure they are restored (`clock.restore()`). Handle asynchronous operations in tests correctly (e.g., `await` promises).
    *   **Timeouts:** If tests hang, consider test runner timeouts (`tape -t 30000`), but prioritize fixing the async logic in the code or test setup/cleanup.

*   **Emphasis:** Correctly `await`ing the `spawn` promise (based on `close`/`error` events) and using `finally` for cleanup remain critical, regardless of the execution environment. The main benefit of containerized testing is removing the need to mock the OS/system commands.

## Step 3: Update Tests (`test/add-repo-command.test.js`)

Testing this **inside the container** changes the mocking strategy significantly, focusing on mocking external dependencies and verifying interactions with the container's filesystem and `git`.

1.  **Setup Mocks & Test Environment (Containerized):**
    *   **DO NOT Mock:** `node:child_process` for `git`, `sudo`, `chown`, etc. Let the container run these. You may use `fs` directly or mock parts if needed for specific unit tests.
    *   **Mock:** `lib/crypto`, `lib/secureKeys`, `models/Repository`, and the `interaction` object.
    *   **Test Repo Setup:** Before tests that involve cloning, create a *local bare Git repository* inside the container's filesystem (e.g., in `/tmp/test-origin-repo.git`). This avoids network dependencies. Use `child_process.execSync` in your test setup (`before` or `beforeEach`) for this.
        ```javascript
        // In test setup (e.g., test.before)
        const TEST_ORIGIN_REPO_PATH = '/tmp/test-origin-repo.git';
        try {
          execSync(`rm -rf ${TEST_ORIGIN_REPO_PATH}`); // Clean previous run
          execSync(`mkdir -p ${TEST_ORIGIN_REPO_PATH}`);
          execSync(`git init --bare ${TEST_ORIGIN_REPO_PATH}`);
          console.log(`Created bare test repo at ${TEST_ORIGIN_REPO_PATH}`);
        } catch (error) {
          console.error('Failed to create test git repo:', error);
          // Decide if tests should fail here
        }
        ```
    *   Ensure the test environment (database connection, `config.repoBaseDir`) is configured correctly within the container.

2.  **Test Case: Success (Using Local Clone):**
    *   Configure mocks for `crypto`, `secureKeys`, `Repository` (e.g., `updateOne` resolves).
    *   **Provide the local path** (`/tmp/test-origin-repo.git`) as the `repoUrl` in the mock `interaction` object.
    *   Ensure the container has necessary users (`coderX`) and permissions for `sudo chown`.
    *   Execute the command handler function (or the relevant part of `execute`).
    *   **Assert:**
        *   Mocks (`decrypt`, `writeTempKey`, `Repository.updateOne`) were called.
        *   Check filesystem: the target `repoPath` directory exists and contains a `.git` directory (confirming the local clone worked). Use `fs.access` or `fs.stat`.
        *   `deleteTempKey` was called in the `finally` block.
        *   `interaction.followUp` was called with the success message.
    *   **Cleanup:** Remove the created `repoPath` directory in `afterEach` or `after`. The bare repo can be cleaned in `after.always`.

3.  **Test Case: Clone Failure (Using Invalid Local Path):**
    *   Configure mocks for initial steps to succeed (`crypto`, `secureKeys`, `Repository.updateOne`).
    *   **Provide an invalid local path** (e.g., `/tmp/non-existent-repo.git`) as the `repoUrl` in the mock `interaction`. This will cause `git clone` to fail.
    *   Execute the command handler.
    *   **Assert:**
        *   Initial mocks were called.
        *   `interaction.followUp` was called with the "Failed to clone" error.
        *   Check filesystem: the target `repoPath` directory *does not* exist (it was cleaned up).
        *   `deleteTempKey` was called.
        *   (Verify DB state/cleanup if you implemented DB deletion on failure).

// ... other test cases for writeTempKey/DB failure ...

**Important for Test Implementation (Containerized):**
*   Leverage the container's environment. Set up prerequisites like users and the dummy Git repo using `execSync` or Dockerfile instructions.
*   Focus mocks on Node.js modules (`secureKeys`, `crypto`, `Repository`, `interaction`).
*   Assert against real filesystem state changes within the container.
*   Implement thorough cleanup (`fs.rm`) in test hooks (`afterEach`, `after.always`).

```javascript
// Example Snippet for test/add-repo-command.test.js (Conceptual - Adapted for Local Clone)
const test = require('ava'); // Or tape
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execSync } = require('node:child_process'); // For test setup/cleanup

// --- Mocks ---
const mockCrypto = {
    decrypt: sinon.stub().returns('decrypted-key-content'),
    encrypt: sinon.stub().returns('test-encrypted-key') // Assume encrypt is used somewhere
};
const mockSecureKeys = {
    writeTempKey: sinon.stub().resolves('/tmp/test-keys/fake-key'),
    deleteTempKey: sinon.stub().resolves()
};
// Mock Repository static methods AND instance methods if needed
const MockRepositoryModel = sinon.stub(); // Mock constructor if used with 'new'
MockRepositoryModel.prototype.save = sinon.stub().resolves(); // Mock instance save
MockRepositoryModel.updateOne = sinon.stub().resolves({ acknowledged: true, modifiedCount: 1, upsertedId: null });
MockRepositoryModel.distinct = sinon.stub().resolves([]); // For user assignment
MockRepositoryModel.findOne = sinon.stub().resolves(null); // Default to not found
MockRepositoryModel.deleteOne = sinon.stub().resolves();

const mockConfig = {
    repoBaseDir: '/test-repos' // Test directory inside container
};

// Mock interaction factory - ** crucial to pass mocked data **
const createMockInteraction = (options = {}) => ({
    guildId: options.guildId || 'test-guild',
    channelId: options.channelId || 'test-channel-123',
    member: { permissions: { has: sinon.stub().returns(true) } }, // Assume admin permission
    options: {
        getString: (key) => options[key] || null,
        getAttachment: (key) => options[key] || null,
        // Simulate resolved values needed by the handler
        // These would normally come from previous steps (user assignment, key encryption)
        // but we provide them directly for testing the clone part.
        getString: sinon.stub().callsFake((key) => {
            if (key === 'repository') return options.repoUrl;
            if (key === 'assigned_user_id') return options.assignedUserId || 'coder1'; // Default assigned user
            if (key === 'ssh_key_encrypted') return options.encryptedSshKey || 'dummy-encrypted-key'; // Default key
            return null;
        }),
         getAttachment: sinon.stub().returns(options.attachment) // Mock attachment if needed for key fetch part
    },
    deferReply: sinon.stub().resolves(),
    followUp: sinon.stub().resolves() // Use followUp as handler defers
 });

// --- Test Environment Setup ---
const TEST_REPO_BASE = mockConfig.repoBaseDir;
const TEST_ORIGIN_REPO_PATH = '/tmp/test-origin-repo.git'; // Dummy repo to clone FROM
const TEST_TEMP_KEY_DIR = '/tmp/test-keys'; // Where mock writeTempKey places keys

// Load the module containing handleAddRepoCommand (adjust path and name)
// We need to test the exported handler function directly or the interactionCreate execute method
// Assuming handleAddRepoCommand is exported or accessible for testing:
const interactionHandler = proxyquire('../events/interactionCreate.js', { // Adjust path
    '../lib/crypto': mockCrypto,
    '../lib/secureKeys': mockSecureKeys,
    '../models/Repository': MockRepositoryModel,
    '../config': mockConfig,
    // No need to mock child_process or fs unless specifically needed
});

// Test setup: Create base test dir and dummy origin repo
test.before(async () => {
    try {
        await fs.rm(TEST_REPO_BASE, { recursive: true, force: true }); // Clean previous base dir
        await fs.rm(TEST_ORIGIN_REPO_PATH, { recursive: true, force: true }); // Clean previous origin repo
        await fs.rm(TEST_TEMP_KEY_DIR, { recursive: true, force: true }); // Clean previous temp keys

        await fs.mkdir(TEST_REPO_BASE, { recursive: true });
        await fs.mkdir(TEST_TEMP_KEY_DIR, { recursive: true }); // Create dir for mock keys

        execSync(`mkdir -p ${TEST_ORIGIN_REPO_PATH}`);
        execSync(`git init --bare ${TEST_ORIGIN_REPO_PATH}`);
        // Optionally add a commit to the bare repo if needed for tests
        // execSync(`cd ${TEST_ORIGIN_REPO_PATH} && git commit --allow-empty -m "Initial commit"`);

        console.log(`Created test base dir ${TEST_REPO_BASE} and bare repo ${TEST_ORIGIN_REPO_PATH}`);
        // Ensure coder users exist (Dockerfile/manual setup responsibility)
    } catch (error) {
        console.error('FATAL: Test setup failed:', error);
        process.exit(1); // Fail tests if setup fails
    }
});

// Test cleanup: Remove base test dir and dummy origin repo
test.after.always(async () => {
    try {
        await fs.rm(TEST_REPO_BASE, { recursive: true, force: true });
        await fs.rm(TEST_ORIGIN_REPO_PATH, { recursive: true, force: true });
        await fs.rm(TEST_TEMP_KEY_DIR, { recursive: true, force: true });
        console.log('Cleaned up test directories.');
    } catch (error) {
        console.error('Warning: Test cleanup failed:', error);
    }
});

// Reset mocks and context before each test
test.beforeEach(async t => {
    sinon.resetHistory(); // Reset spies/stubs

    // Reset specific stub behaviors
    mockCrypto.decrypt.returns('decrypted-key-content');
    mockSecureKeys.writeTempKey.resolves(path.join(TEST_TEMP_KEY_DIR, 'fake-key'));
    mockSecureKeys.deleteTempKey.resolves();
    MockRepositoryModel.updateOne.resolves({ acknowledged: true, modifiedCount: 1, upsertedId: null }); // Default success
    MockRepositoryModel.distinct.resolves(['coder2', 'coder3']); // Simulate some users assigned
    MockRepositoryModel.findOne.resolves(null); // Default repo not found
    MockRepositoryModel.deleteOne.resolves();

    // Context for cleanup
    t.context.repoPath = null;
    t.context.assignedUserId = 'coder1'; // Default test user
});

test.afterEach.always(async t => {
    // Restore stubs
    sinon.restore();
    // Cleanup specific repo dir potentially created during the test
    if (t.context.repoPath) {
        try {
            await fs.rm(t.context.repoPath, { recursive: true, force: true });
            console.log(`Cleaned test repo dir: ${t.context.repoPath}`);
        } catch (e) { /* ignore */ }
    }
});

test('Success Case - Clones local dummy repo correctly', async t => {
    const channelId = 'channel-success';
    const repoName = channelId; // Using channelId for uniqueness
    const assignedUserId = 'coder1';
    // *** Use local bare repo path as the URL ***
    const repoUrl = TEST_ORIGIN_REPO_PATH;
    t.context.repoPath = path.join(TEST_REPO_BASE, `${t.context.guildId || 'test-guild'}-${repoName}`); // Set expected path for cleanup

    const interaction = createMockInteraction({
        channelId,
        repoUrl, // Pass the local path
        assignedUserId,
        encryptedSshKey: 'test-encrypted-key'
     });

    // Execute the handler (assuming it's exported or accessible)
    // If testing via execute, you'd call interactionHandler.execute(interaction)
    // Here, assuming direct call to handleAddRepoCommand if possible
    await interactionHandler.handleAddRepoCommand(interaction); // Adjust if needed

    // Assertions
    t.true(mockCrypto.decrypt.calledOnceWith('test-encrypted-key'));
    t.true(mockSecureKeys.writeTempKey.calledOnce);
    t.true(MockRepositoryModel.updateOne.calledOnce); // Check DB update
    // Verify args of updateOne if needed

    // Check file system state *within container*
    try {
        await fs.access(t.context.repoPath); // Check clone target dir exists
        await fs.access(path.join(t.context.repoPath, '.git')); // Check clone occurred
        t.pass('Repository directory and .git folder created.');
    } catch (e) {
        t.fail(`Repository directory ${t.context.repoPath} or .git folder not found after successful clone: ${e}`);
    }

    t.true(mockSecureKeys.deleteTempKey.calledOnce); // Called in finally
    t.true(interaction.followUp.calledWithMatch(/✅ Repository.*cloned successfully/));
});

test('Clone Failure Case - Invalid local repo path', async t => {
    const channelId = 'channel-fail-clone';
    const repoName = channelId;
    const assignedUserId = 'coder1';
    // *** Use an invalid local path ***
    const repoUrl = '/tmp/non-existent-repo.git';
     t.context.repoPath = path.join(TEST_REPO_BASE, `${t.context.guildId || 'test-guild'}-${repoName}`); // Expected path that should be cleaned up

    const interaction = createMockInteraction({
        channelId,
        repoUrl, // Pass the invalid path
        assignedUserId,
        encryptedSshKey: 'test-encrypted-key'
     });

    // Execute the handler
    await interactionHandler.handleAddRepoCommand(interaction); // Adjust if needed

    // Assertions
    t.true(mockCrypto.decrypt.calledOnce);
    t.true(mockSecureKeys.writeTempKey.calledOnce);
    t.true(MockRepositoryModel.updateOne.calledOnce); // DB update attempted before clone

    t.true(interaction.followUp.calledWithMatch(/❌ Failed to clone repository/));

    // Check file system state *within container* - directory should be removed
    try {
        await fs.access(t.context.repoPath);
        t.fail(`Repository directory ${t.context.repoPath} should have been deleted after clone failure.`);
    } catch (e) {
        // Error is expected (ENOENT), means file/dir doesn't exist
        t.pass('Repository directory correctly cleaned up.');
    }

    // Check if DB cleanup was performed (if implemented)
    // t.true(MockRepositoryModel.deleteOne.calledOnce);

    t.true(mockSecureKeys.deleteTempKey.calledOnce); // Called in finally
});

// Add tests for other failure cases (writeTempKey fails, save fails etc.) adapting assertions
```

## Step 4: Run `standard --fix` and `npm test` (Inside Docker)

Ensure all code is styled correctly and all tests pass by running the commands **inside your Docker container**. Adapt the file paths for `standard --fix`.

**Option 1: Using `docker exec` (if container is already running)**
```bash
# Connect to the running container's shell
docker exec -it vibehive-app /bin/bash # Or /bin/sh

# Inside the container's shell:
cd /path/to/your/app # Navigate to your app's directory
# Update paths for standard
npx standard --fix events/interactionCreate.js test/add-repo-command.test.js lib/secureKeys.js models/Repository.js # Add relevant files
npm test

# Exit the container shell
exit
```

**Option 2: Using `docker compose run`**
```bash
# Run standard fix
docker compose run --rm app npx standard --fix events/interactionCreate.js test/add-repo-command.test.js lib/secureKeys.js models/Repository.js

# Run tests
docker compose run --rm app npm test
```

This completes the implementation of the `git clone` functionality within the `events/interactionCreate.js` handler, emphasizing containerized testing with local dummy repositories for higher fidelity and reliability. 