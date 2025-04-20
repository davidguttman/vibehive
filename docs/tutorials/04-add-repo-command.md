# Tutorial: Adding the `/add-repo` Slash Command Stub

This tutorial focuses on adding a new slash command, `/add-repo`, to our Discord bot. We'll register the command with Discord, add an option to accept a URL, implement basic permission checking (only Administrators can use it), and provide an initial acknowledgement reply.

## Prerequisites

*   Completion of the previous tutorials ([01](./01-basic-discord-bot.md), [02](./02-mongodb-integration.md), [03](./03-mongoose-schema.md)).

## Step 1: Update Command Registration (`index.js`)

We need to define the new `/add-repo` command and its options, then include it in the list of commands sent to Discord during startup.

Modify `index.js`:

```diff
 // index.js

 // 1. Package Requires
 const {
   Client, GatewayIntentBits, Events, REST, Routes,
-  PermissionsBitField // Import PermissionsBitField for permission checks
+  PermissionsBitField, // Import PermissionsBitField
+  SlashCommandBuilder // Import SlashCommandBuilder for defining commands
 } = require('discord.js')

 // 2. Local Requires
 // ... (no changes here)

 // 3. Constants
 // ... (no changes here)

-// Simple command definition
+// Command definitions using SlashCommandBuilder
 const commands = [
   {
     name: 'ping',
     description: 'Replies with Pong!'
+  },
+  new SlashCommandBuilder()
+    .setName('add-repo')
+    .setDescription('Adds a repository to be monitored in this channel.')
+    .addStringOption(option =>
+      option.setName('url')
+        .setDescription('The full URL (HTTPS or SSH) of the repository.')
+        .setRequired(true))
+    // Optional: Set permissions directly on the command definition
+    // .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
+    // .setDMPermission(false) // Disable in DMs
+]
+  // Convert SlashCommandBuilder instances to JSON for the REST API
+  .map(command => command.toJSON()); // Add .toJSON() if using SlashCommandBuilder

 // 4. Immediately Run Code
 // ... (rest of the file until interaction handler)
 // Function to register slash commands
 (async () => {
   try {
     console.log('Started refreshing application (/) commands.')

-    await rest.put(
+    // The body needs to be the array of command JSON definitions
+    const commandData = commands // Already mapped to JSON if using SlashCommandBuilder
+
+    await rest.put(
       Routes.applicationCommands(discordClientId), // Register globally
       // Use Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) for faster testing in a specific server
-      { body: commands }
+      { body: commandData } // Use the command data
     )

     console.log('Successfully reloaded application (/) commands.')
```

**Summary of `index.js` (Command Registration) changes:**
1.  Import `SlashCommandBuilder` and `PermissionsBitField` from `discord.js`.
2.  Define the `commands` array using `SlashCommandBuilder` for better structure and type safety.
3.  Define the `/add-repo` command with its name, description, and a required string option `url`.
4.  *(Self-Correction during thought process):* Ensure the command definitions are converted to JSON using `.map(command => command.toJSON())` before sending them to the `rest.put` method if you used `SlashCommandBuilder`. The previous `ping` command was already plain JSON, but the builder creates objects that need conversion. If you define all commands as plain JSON objects, this map is not needed. *Correction:* The tutorial shows defining `/ping` as a plain object and `/add-repo` with the builder. To handle this mix, we need to conditionally call `toJSON`. A simpler approach for this tutorial is to define *both* using `SlashCommandBuilder`. Let's adjust the diff.

**Revised `index.js` Diff (Simpler Approach):**
```diff
 // index.js

 // 1. Package Requires
 const {
   Client, GatewayIntentBits, Events, REST, Routes,
-  PermissionsBitField // Import PermissionsBitField for permission checks
+  PermissionsBitField, // Import PermissionsBitField
+  SlashCommandBuilder // Import SlashCommandBuilder for defining commands
 } = require('discord.js')

 // 2. Local Requires
 // ... (no changes here)

 // 3. Constants
 // ... (no changes here)

-// Simple command definition
+// Command definitions using SlashCommandBuilder
 const commands = [
-  {
-    name: 'ping',
-    description: 'Replies with Pong!'
-  }
+  new SlashCommandBuilder()
+    .setName('ping')
+    .setDescription('Replies with Pong!'),
+  new SlashCommandBuilder()
+    .setName('add-repo')
+    .setDescription('Adds a repository to be monitored in this channel.')
+    .addStringOption(option =>
+      option.setName('url')
+        .setDescription('The full URL (HTTPS or SSH) of the repository.')
+        .setRequired(true))
+    // Optional: Set permissions directly on the command definition
+    // .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
+    // .setDMPermission(false) // Disable in DMs
 ]
+  // Convert all command builder instances to JSON for the REST API
+  .map(command => command.toJSON());

 // 4. Immediately Run Code
 // ... (rest of the file until interaction handler)
 // Function to register slash commands
 (async () => {
   try {
-    console.log('Started refreshing application (/) commands.')
+    console.log(`Started refreshing ${commands.length} application (/) commands.`); // Log count

     await rest.put(
       Routes.applicationCommands(discordClientId), // Register globally
       // Use Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) for faster testing in a specific server
-      { body: commands }
+      { body: commands } // Use the mapped JSON command definitions
     )

-    console.log('Successfully reloaded application (/) commands.')
+    console.log(`Successfully reloaded ${commands.length} application (/) commands.`); // Log count
```
This revised approach uses `SlashCommandBuilder` for all commands and maps them all to JSON, which is cleaner.

## Step 2: Update Interaction Handler (`index.js`)

Now, handle the incoming `/add-repo` interaction, check permissions, and reply.

Modify the `client.on(Events.InteractionCreate, ...)` handler in `index.js`:

```diff
 // Event: Interaction Created (Slash Command Execution)
 client.on(Events.InteractionCreate, async interaction => {
   if (!interaction.isChatInputCommand()) return // Only handle slash commands
+  // Ensure the interaction is from a guild (server)
+  if (!interaction.inGuild()) {
+    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
+    return;
+  }

   const { commandName } = interaction

   console.log(`Received interaction: ${commandName}`)

   if (commandName === 'ping') {
     try {
+      // Defer reply for potentially longer operations (good practice)
+      // await interaction.deferReply({ ephemeral: false }); // Example: public deferral
       await interaction.reply('Pong!')
       console.log('Replied to /ping command.')
     } catch (error) {
       console.error('Error replying to ping:', error)
       // Inform user if possible
       if (interaction.replied || interaction.deferred) {
         await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true })
       } else {
         await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true })
       }
     }
+  } else if (commandName === 'add-repo') {
+    try {
+      // 1. Check Permissions
+      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
+        await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
+        console.log(`User ${interaction.user.tag} attempted to use /add-repo without permissions.`);
+        return;
+      }
+
+      // 2. Get the URL option
+      const repoUrl = interaction.options.getString('url'); // 'url' matches the option name
+      if (!repoUrl) { // Should not happen if option is required, but good practice to check
+        await interaction.reply({ content: 'Error: The repository URL is missing.', ephemeral: true });
+        return;
+      }
+
+      // 3. Reply with acknowledgement (temporary)
+      // It's often good to defer the reply if the next steps take time
+      await interaction.deferReply({ ephemeral: true }); // Acknowledge privately for now
+
+      // --- Placeholder for future logic (saving to DB) ---
+      console.log(`Admin ${interaction.user.tag} requested to add repo: ${repoUrl} in channel ${interaction.channelId}`);
+      // --- End Placeholder ---
+
+      // Follow up after deferral
+      await interaction.followUp({ content: `Received request to add repository: ${repoUrl}`, ephemeral: true });
+
+    } catch (error) {
+      console.error(`Error handling /add-repo command:`, error);
+      if (interaction.replied || interaction.deferred) {
+        await interaction.followUp({ content: 'There was an error processing your request.', ephemeral: true });
+      } else {
+        await interaction.reply({ content: 'There was an error processing your request.', ephemeral: true });
+      }
+    }
   }
   // Add handlers for other commands here
 })
```

**Summary of Interaction Handler changes:**
1.  Added an `else if` block for `commandName === 'add-repo'`.
2.  Checked if the command is used within a Guild (server).
3.  Inside the block, checked if `interaction.member.permissions` includes the `Administrator` flag.
4.  If the user lacks permission, reply with an error message (using `ephemeral: true` makes the reply visible only to the user) and return.
5.  If permitted, retrieve the `url` string option using `interaction.options.getString('url')`.
6.  Added `interaction.deferReply({ ephemeral: true })` to acknowledge the command quickly while potential database operations happen later.
7.  Used `interaction.followUp()` to send the final confirmation message after deferral. *(Self-correction: Initially just used `reply`, but `deferReply/followUp` is better practice for commands that might do work).*

## Step 3: Run the Linter

Apply standard style to the modified `index.js`:

```bash
npm run lint
```

## Step 4: Testing the `/add-repo` Command Stub

Create a test file to verify the new command's basic logic (permissions, acknowledgement).

Create `test/add-repo-command.test.js`:

```javascript
// test/add-repo-command.test.js
const test = require('tape')
const sinon = require('sinon') // Using sinon for easier mocking
const { PermissionsBitField } = require('discord.js')

// We need to simulate the part of index.js that handles interactions
// Normally, you might extract the handler logic into its own module,
// but for this tutorial, we'll define a simplified mock handler.

// Mock Interaction Object Factory
function createMockInteraction (options = {}) {
  const {
    commandName = 'add-repo',
    isChatInputCommand = true,
    inGuild = true,
    userTag = 'testuser#1234',
    channelId = 'channel-test-id',
    isAdmin = false,
    repoUrl = 'https://github.com/test/repo.git',
    replied = false,
    deferred = false
  } = options

  // Use Sinon stubs for reply/followUp to track calls
  const replyStub = sinon.stub().resolves()
  const followUpStub = sinon.stub().resolves()
  const deferReplyStub = sinon.stub().resolves()

  return {
    commandName,
    isChatInputCommand: () => isChatInputCommand,
    inGuild: () => inGuild,
    user: { tag: userTag },
    channelId,
    member: {
      // Simulate the permissions check
      permissions: {
        has: (permission) => {
          return permission === PermissionsBitField.Flags.Administrator && isAdmin
        }
      }
    },
    options: {
      // Simulate getting the option value
      getString: (name) => {
        return name === 'url' ? repoUrl : null
      }
    },
    reply: replyStub,
    followUp: followUpStub,
    deferReply: deferReplyStub,
    // Expose stubs for assertions
    stubs: { reply: replyStub, followUp: followUpStub, deferReply: deferReplyStub },
    // Simulate state for error handling checks
    replied,
    deferred
  }
}

// Simplified interaction handler logic (mirroring index.js)
async function handleInteraction (interaction) {
  if (!interaction.isChatInputCommand()) return
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true })
    return
  }

  const { commandName } = interaction

  if (commandName === 'add-repo') {
    try {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true })
        return // Exit early
      }

      const repoUrl = interaction.options.getString('url')
      if (!repoUrl) {
        await interaction.reply({ content: 'Error: The repository URL is missing.', ephemeral: true })
        return // Exit early
      }

      await interaction.deferReply({ ephemeral: true })
      // Placeholder logic would go here
      await interaction.followUp({ content: `Received request to add repository: ${repoUrl}`, ephemeral: true })
    } catch (error) {
      console.error('Mock handler error:', error)
      // Simplified error reply for testing
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'There was an error processing your request.', ephemeral: true })
      } else {
        await interaction.reply({ content: 'There was an error processing your request.', ephemeral: true })
      }
    }
  } else if (commandName === 'ping') {
    // Add a basic ping handler if needed for completeness, or ignore
    await interaction.reply('Pong!')
  }
}

// --- Tests ---

test('/add-repo Command - Non-Admin', async (t) => {
  const mockInteraction = createMockInteraction({ isAdmin: false })
  await handleInteraction(mockInteraction)

  t.ok(mockInteraction.stubs.reply.calledOnce, 'reply should be called once')
  const replyArgs = mockInteraction.stubs.reply.firstCall.args[0]
  t.equal(replyArgs.content, 'You do not have permission to use this command.', 'Should reply with permission error')
  t.equal(replyArgs.ephemeral, true, 'Permission error reply should be ephemeral')
  t.notOk(mockInteraction.stubs.deferReply.called, 'deferReply should not be called')
  t.notOk(mockInteraction.stubs.followUp.called, 'followUp should not be called')

  t.end()
})

test('/add-repo Command - Admin Success', async (t) => {
  const testUrl = 'https://valid-repo.com/test.git'
  const mockInteraction = createMockInteraction({ isAdmin: true, repoUrl: testUrl })
  await handleInteraction(mockInteraction)

  t.ok(mockInteraction.stubs.deferReply.calledOnce, 'deferReply should be called once for admin')
  const deferArgs = mockInteraction.stubs.deferReply.firstCall.args[0]
  t.equal(deferArgs.ephemeral, true, 'Defer reply should be ephemeral')

  t.ok(mockInteraction.stubs.followUp.calledOnce, 'followUp should be called once after deferral')
  const followUpArgs = mockInteraction.stubs.followUp.firstCall.args[0]
  t.equal(followUpArgs.content, `Received request to add repository: ${testUrl}`, 'Should followUp with acknowledgement and URL')
  t.equal(followUpArgs.ephemeral, true, 'Acknowledgement followUp should be ephemeral')
  t.notOk(mockInteraction.stubs.reply.called, 'reply should not be called directly on success')

  t.end()
})

test('/add-repo Command - Missing URL (Should not happen if required)', async (t) => {
  // Although the option is required, test the internal check just in case
  const mockInteraction = createMockInteraction({ isAdmin: true, repoUrl: null }) // Simulate missing URL
  await handleInteraction(mockInteraction)

  t.ok(mockInteraction.stubs.reply.calledOnce, 'reply should be called once for missing URL')
  const replyArgs = mockInteraction.stubs.reply.firstCall.args[0]
  t.equal(replyArgs.content, 'Error: The repository URL is missing.', 'Should reply with missing URL error')
  t.equal(replyArgs.ephemeral, true, 'Missing URL error reply should be ephemeral')
  t.notOk(mockInteraction.stubs.deferReply.called, 'deferReply should not be called')
  t.notOk(mockInteraction.stubs.followUp.called, 'followUp should not be called')

  t.end()
})

test('Interaction Handler - Not in Guild', async (t) => {
  const mockInteraction = createMockInteraction({ inGuild: false })
  await handleInteraction(mockInteraction)

  t.ok(mockInteraction.stubs.reply.calledOnce, 'reply should be called once')
  const replyArgs = mockInteraction.stubs.reply.firstCall.args[0]
  t.equal(replyArgs.content, 'This command can only be used in a server.', 'Should reply with guild-only error')
  t.equal(replyArgs.ephemeral, true, 'Guild-only error reply should be ephemeral')
  t.notOk(mockInteraction.stubs.deferReply.called, 'deferReply should not be called')
  t.notOk(mockInteraction.stubs.followUp.called, 'followUp should not be called')

  t.end()
})

// Optional: Add a test for a different command to ensure it's ignored by add-repo logic
test('Interaction Handler - Ignores Other Commands', async (t) => {
  const mockInteraction = createMockInteraction({ commandName: 'ping', isAdmin: true })
  await handleInteraction(mockInteraction)

  // Check if ping's reply was called, and add-repo's were not
  t.ok(mockInteraction.stubs.reply.calledOnce, 'ping reply should be called')
  t.equal(mockInteraction.stubs.reply.firstCall.args[0], 'Pong!', 'Should reply Pong! for ping command')
  t.notOk(mockInteraction.stubs.deferReply.called, 'deferReply should not be called for ping')
  t.notOk(mockInteraction.stubs.followUp.called, 'followUp should not be called for ping')

  t.end()
})
```

**Explanation of `test/add-repo-command.test.js`:**
1.  Requires `tape` and `sinon` (you might need to `npm install --save-dev sinon`) for mocking.
2.  Defines a `createMockInteraction` factory function to easily generate interaction objects with different properties (admin status, URL, etc.) and stubbed reply/followUp methods.
3.  Defines a simplified `handleInteraction` function that mimics the relevant logic from `index.js` for testing purposes. *(Note: A better long-term approach is to extract the command handling logic from `index.js` into separate files/functions so they can be required and tested directly without mocking the entire `index.js` flow).*
4.  Tests the non-admin case, asserting that the correct permission error reply is sent.
5.  Tests the admin success case, asserting that `deferReply` and `followUp` are called with the correct acknowledgement message and URL.
6.  Tests the (unlikely but safe) case where the URL might be missing internally.
7.  Tests the `inGuild` check.
8.  Optionally tests that other commands (like `/ping`) are handled correctly and don't trigger the `/add-repo` logic.

*Before running `npm test`, install sinon:*
```bash
npm install --save-dev sinon
```

## Step 5: Run Tests

Verify that the new command stub tests pass along with all existing tests.

```bash
npm test
```

You should see output including the new `add-repo-command.test.js` tests passing.

---

Success! You've added the `/add-repo` slash command, complete with a URL option and administrator permission checks. The bot now acknowledges the command correctly, paving the way for adding the database logic in the next step. 