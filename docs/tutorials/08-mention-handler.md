# Tutorial: Handling Bot Mentions and Triggering the Python Wrapper

This tutorial explains how to make the Discord bot listen for messages where it's mentioned, extract the user's prompt, look up configuration data from MongoDB, and trigger the Python script via the Node.js wrapper created in the previous step.

## Prerequisites

*   Completion of all previous tutorials (up to [07](./07-node-python-wrapper.md)).
*   A running MongoDB instance (local or Atlas) and the `MONGODB_URI` environment variable set.
*   The bot client initialized with necessary intents (`Guilds`, `GuildMessages`, `MessageContent`).
*   The `Repository` model (`models/Repository.js`) defined.
*   The `invokeAiderWrapper` function (`lib/pythonWrapper.js`) created.

## Step 1: Update Bot Intents

The bot needs specific "Intents" enabled to receive message content. The `MessageContent` intent is privileged and must be enabled in the Discord Developer Portal for your bot application.

In your main bot file (e.g., `index.js` or `bot.js`), ensure the `Client` is initialized with `Guilds`, `GuildMessages`, and `MessageContent` intents.

```javascript
// index.js (or your main bot file)

// ... other requires
const { Client, GatewayIntentBits, Events } = require('discord.js');
// ... other requires like connectDB, command handlers...
const { invokeAiderWrapper } = require('./lib/pythonWrapper'); // Import the wrapper
const Repository = require('./models/Repository'); // Import the model
const connectDB = require('./lib/db'); // Import connectDB

// ... Load commands ...

// Create a new client instance with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // Needed for guild information
    GatewayIntentBits.GuildMessages, // Needed to receive messages in guilds
    GatewayIntentBits.MessageContent // Needed to read message content (Privileged)
    // Add other intents if needed (e.g., GuildMembers)
  ]
});

// ... rest of your bot setup (login, command handling, etc.)
```

**Important:** Go to your bot's application page on the [Discord Developer Portal](https://discord.com/developers/applications), navigate to the "Bot" section, and ensure the "Message Content Intent" toggle is enabled under "Privileged Gateway Intents".

## Step 2: Add the `messageCreate` Event Handler

Now, let's add the logic to handle incoming messages.

```javascript
// index.js (or your main bot file, AFTER client initialization)

// ... client initialization ...
// ... command loading and interaction handling ...

// Event listener for message creation
client.on(Events.MessageCreate, async message => {
  // 1. Ignore messages from bots (including self)
  if (message.author.bot) return;

  // 2. Check if the bot was mentioned
  if (message.mentions.has(client.user)) {
    console.log(`Bot mentioned by ${message.author.tag} in channel ${message.channel.id}`);

    // 3. Extract the prompt (remove mention + trim)
    // Discord mentions look like <@USER_ID> or <@!USER_ID>
    const mentionRegex = new RegExp(`^<@!?${client.user.id}>\\s*`);
    const prompt = message.content.replace(mentionRegex, '').trim();

    if (!prompt) {
      // If the message was just the mention with nothing else
      console.log('Mention received without a prompt.');
      message.reply('You mentioned me, but didn\'t provide a prompt!'); // Optional reply
      return;
    }

    console.log(`Extracted prompt: "${prompt}"`);

    // 4. Get channelId
    const channelId = message.channelId;

    try {
      // Ensure DB is connected (optional, depends on your connection strategy)
      await connectDB(); // Or ensure it's connected elsewhere

      // 5. Find Repository config for this channel
      const repoConfig = await Repository.findOne({ discordChannelId: channelId });

      if (!repoConfig) {
        console.log(`No repository configured for channel ${channelId}`);
        message.reply({ content: 'This channel is not configured for AI interactions. An admin can use `/add-repo` to set it up.', ephemeral: true });
        return;
      }

      console.log(`Found repository config for channel ${channelId}: ${repoConfig.repoUrl}`);

      // Add some user feedback that the request is being processed
      await message.reply('Processing your request...'); // Or use deferReply if interactions are complex

      // 6. Invoke the Python wrapper
      const result = await invokeAiderWrapper({ prompt }); // Pass prompt in options object

      // 7. Process the result (logging for now)
      if (result.status === 'success') {
        console.log('Python wrapper succeeded:', result.data);
        // In the next tutorial, we'll display this output properly
        // For now, just send a confirmation or the raw content
        const responseContent = result.data?.events?.[0]?.content || 'Received a response, but couldn\'t extract content.';
        await message.channel.send(`**Response:**\n\`\`\`\n${responseContent}\n\`\`\``); // Using followUp if deferred
      } else {
        console.error('Python wrapper failed:', result.error);
        await message.channel.send(`There was an error processing your request: ${result.error}`); // Using followUp if deferred
      }
    } catch (error) {
      console.error('Error handling mention:', error);
      try {
        await message.reply('Sorry, something went wrong while processing your request.');
      } catch (replyError) {
        console.error('Failed to send error reply:', replyError);
      }
    }
  }
  // No mention or handled above, ignore the message otherwise
});

// ... client.login(token) ...
```

**Explanation:**

1.  **`client.on(Events.MessageCreate, ...)`**: Sets up an asynchronous listener for the `messageCreate` event.
2.  **`message.author.bot`**: Checks if the message author is a bot and ignores it if true.
3.  **`message.mentions.has(client.user)`**: Checks if the bot's user object is present in the message mentions.
4.  **Extract Prompt**: Uses a regular expression (`mentionRegex`) to remove the bot's mention (which can be `<@USER_ID>` or `<@!USER_ID>`) from the start of the message content. `trim()` removes extra whitespace.
5.  **Channel ID**: Gets the `channelId` where the message was sent.
6.  **Database Lookup**: Connects to the DB (if needed) and uses `Repository.findOne()` to search for a document matching the `channelId`.
7.  **No Repo Found**: If `repoConfig` is null, it sends an ephemeral reply informing the user the channel isn't set up.
8.  **Repo Found**: If configuration exists, it informs the user it's processing the request (`message.reply(...)`).
9.  **`invokeAiderWrapper`**: Calls the function from `lib/pythonWrapper.js`, passing the extracted `prompt` in an options object.
10. **Result Handling**: Checks the `status` field of the returned object.
    *   On `success`, logs the data and sends the content (for now).
    *   On `failure`, logs the error and sends an error message to the channel.
11. **Error Catching**: A `try...catch` block wraps the database and wrapper logic to handle unexpected errors gracefully.

## Step 3: Run the Linter

Apply standard style to your main bot file:

```bash
npm run lint -- --fix index.js
```

(Replace `index.js` if your main file has a different name).

## Step 4: Create Test File (`test/mentionHandler.test.js`)

Now, let's create tests for this new functionality.

Create `test/mentionHandler.test.js`:

```javascript
// test/mentionHandler.test.js
const test = require('tape');
const sinon = require('sinon');
const { EventEmitter } = require('events'); // To mock client
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

// Modules to test/stub
const Repository = require('../models/Repository'); // Real model
const pythonWrapper = require('../lib/pythonWrapper'); // To stub invokeAiderWrapper
// We need to simulate the client.on('messageCreate', ...) registration.
// We'll do this by manually calling the handler function exported from index.js or wherever it lives.
// Let's assume for testing we can extract or easily invoke the handler.
// *Modification needed in index.js potentially, or complex setup*

// --- Mock Objects ---
const mockClient = new EventEmitter(); // Simulate Discord client events
mockClient.user = { id: 'mock-bot-id', tag: 'MockBot#0000' };
mockClient.application = { id: 'mock-app-id' }; // Often needed internally

// --- In-Memory DB Setup ---
let mongoServer;
let mongoUri;

const setup = async () => {
  mongoServer = await MongoMemoryServer.create();
  mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
  // Seed data
  await Repository.create({
    discordChannelId: 'channel-with-repo',
    repoUrl: 'https://github.com/test/repo.git'
  });
};

const teardown = async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
};

// --- Stubs ---
let invokeAiderStub;
let replyStub;
let sendStub; // For channel.send

// --- Test Handler ---
// NOTE: This assumes you've structured your bot code so the handler
// can be imported and called directly, passing mock objects.
// e.g., export the handler function from where it's defined.
// If it's tightly coupled within index.js, testing is harder.
// Let's *pretend* we have access to the handler function:
// const { handleMessageCreate } = require('../index.js'); // Ideal scenario

// If not exportable, we might trigger the event on the mock client
// and assert side effects.

// --- Test Cases ---

test.onFinish(async () => { // Ensure teardown runs even if tests fail
  await teardown();
});

test('Mention Handler - Setup', async (t) => {
  await setup();
  t.pass('In-memory DB started and seeded');
  t.end();
});

test('Mention Handler - Ignores Bot Messages', async (t) => {
  t.plan(1);
  // Arrange
  const mockMessage = {
    author: { bot: true }, // Message IS from a bot
    mentions: { has: () => false }, // Doesn't matter for this test
    content: 'Regular message',
    channelId: 'any-channel',
    reply: sinon.fake(),
    channel: { send: sinon.fake() }
  };
  invokeAiderStub = sinon.stub(pythonWrapper, 'invokeAiderWrapper'); // Reset stub just in case

  // Act
  // Simulate the event (or call handler directly if possible)
  // await handleMessageCreate(mockMessage); // <-- If handler is exportable
  mockClient.emit('messageCreate', mockMessage); // Simulate event if handler attached like client.on(...)

  // Assert
  t.ok(invokeAiderStub.notCalled, 'invokeAiderWrapper should NOT be called for bot messages');

  invokeAiderStub.restore();
});

test('Mention Handler - No Mention', async (t) => {
  t.plan(1);
  // Arrange
  const mockMessage = {
    author: { bot: false, id: 'user-id', tag: 'User#1234' },
    mentions: { has: (user) => user.id === mockClient.user.id ? false : false }, // Bot NOT mentioned
    content: 'Regular message without mention',
    channelId: 'any-channel',
    reply: sinon.fake(),
    channel: { send: sinon.fake() }
  };
  invokeAiderStub = sinon.stub(pythonWrapper, 'invokeAiderWrapper');

  // Act
  mockClient.emit('messageCreate', mockMessage);

  // Assert
  t.ok(invokeAiderStub.notCalled, 'invokeAiderWrapper should NOT be called if bot is not mentioned');

  invokeAiderStub.restore();
});

test('Mention Handler - Mention, No Repo Configured', async (t) => {
  t.plan(3);
  // Arrange
  replyStub = sinon.fake();
  const mockMessage = {
    author: { bot: false, id: 'user-id', tag: 'User#1234' },
    mentions: { has: (user) => user.id === mockClient.user.id }, // Bot IS mentioned
    content: `<@${mockClient.user.id}> what is this channel?`,
    channelId: 'channel-without-repo', // Different from seeded channel
    reply: replyStub,
    channel: { send: sinon.fake() }
  };
  invokeAiderStub = sinon.stub(pythonWrapper, 'invokeAiderWrapper');

  // Act
  mockClient.emit('messageCreate', mockMessage);
  // Note: Need a small delay or direct handler call if async operations inside aren't awaited properly
  // In a real scenario with client.on, mongoose might take time. Let's assume direct call or sufficient wait.

  // Assert
  t.ok(invokeAiderStub.notCalled, 'invokeAiderWrapper should NOT be called when no repo is configured');
  t.ok(replyStub.calledOnce, 'reply should be called once');
  t.ok(replyStub.calledWithMatch({ content: /channel is not configured/i, ephemeral: true }), 'Should reply with "not configured" message');

  invokeAiderStub.restore();
});


test('Mention Handler - Mention, Repo Found, Wrapper Called', async (t) => {
  t.plan(3);
  // Arrange
  replyStub = sinon.fake(); // Initial processing reply
  sendStub = sinon.fake();  // For the final result
  const mockMessage = {
    author: { bot: false, id: 'user-id', tag: 'User#1234' },
    mentions: { has: (user) => user.id === mockClient.user.id }, // Bot IS mentioned
    content: `<@${mockClient.user.id}> do the thing`,
    channelId: 'channel-with-repo', // MATCHES seeded channel
    reply: replyStub,
    channel: { send: sendStub } // Mock channel.send
  };
  // Mock the wrapper to return success
  const mockSuccessResult = { status: 'success', data: { events: [{ type: 'text_response', content: 'Mocked AI response' }] } };
  invokeAiderStub = sinon.stub(pythonWrapper, 'invokeAiderWrapper').resolves(mockSuccessResult);

  // Act
  mockClient.emit('messageCreate', mockMessage);
  // If the handler is async, need to ensure promises resolve. Tape handles top-level async fine.
  // Allow time for async operations within the handler if using emit.
  await new Promise(resolve => setImmediate(resolve)); // Ensure event loop turn allows promise resolution

  // Assert
  t.ok(replyStub.calledOnceWith('Processing your request...'), 'Should send initial "Processing" reply');
  t.ok(invokeAiderStub.calledOnce, 'invokeAiderWrapper should be called once');
  t.ok(invokeAiderStub.calledWith({ prompt: 'do the thing' }), 'invokeAiderWrapper called with correct prompt');
  // We'll test the output formatting in the next tutorial's tests
  t.ok(sendStub.calledOnceWithMatch(/Mocked AI response/), 'channel.send should be called with wrapper result');


  invokeAiderStub.restore();
});

test('Mention Handler - Mention, Repo Found, Wrapper Fails', async (t) => {
  t.plan(3);
    // Arrange
  replyStub = sinon.fake(); // Initial processing reply
  sendStub = sinon.fake();  // For the final result
  const mockMessage = {
    author: { bot: false, id: 'user-id', tag: 'User#1234' },
    mentions: { has: (user) => user.id === mockClient.user.id }, // Bot IS mentioned
    content: `<@${mockClient.user.id}> trigger failure`,
    channelId: 'channel-with-repo', // MATCHES seeded channel
    reply: replyStub,
    channel: { send: sendStub }
  };
  // Mock the wrapper to return failure
  const mockFailureResult = { status: 'failure', error: 'Simulated python error' };
  invokeAiderStub = sinon.stub(pythonWrapper, 'invokeAiderWrapper').resolves(mockFailureResult);

  // Act
  mockClient.emit('messageCreate', mockMessage);
  await new Promise(resolve => setImmediate(resolve)); // Allow promises to resolve

  // Assert
  t.ok(replyStub.calledOnceWith('Processing your request...'), 'Should send initial "Processing" reply');
  t.ok(invokeAiderStub.calledOnce, 'invokeAiderWrapper should be called once');
  t.ok(sendStub.calledOnceWithMatch(/error processing your request: Simulated python error/i), 'channel.send should be called with error message');


  invokeAiderStub.restore();
});

// Teardown is handled by test.onFinish

```

**Explanation of Tests:**

1.  **Requires & Mocks**: Imports `tape`, `sinon` for stubbing, `EventEmitter` to mock the client, `mongodb-memory-server`, `mongoose`, the `Repository` model, and the `pythonWrapper`.
2.  **Mock Client**: Creates a simple event emitter to simulate the Discord client firing `messageCreate`. It has a mock `user` object.
3.  **In-Memory DB**: Uses `mongodb-memory-server` to set up a temporary MongoDB instance for testing, including `setup` and `teardown` functions. Seeds a test `Repository` document in `setup`.
4.  **Stubs**: Declares variables for Sinon stubs (`invokeAiderStub`, `replyStub`, `sendStub`).
5.  **Test Handler Note**: Explains the ideal way to test would be to export the handler function itself. The current tests simulate the `client.emit('messageCreate', ...)` behavior, which works if the handler is attached using `client.on`.
6.  **`test.onFinish(teardown)`**: Ensures the database connection is closed and the server is stopped after all tests run.
7.  **Test Cases**:
    *   **Setup**: Runs the DB setup.
    *   **Ignores Bot Messages**: Simulates a message from a bot and asserts `invokeAiderWrapper` is *not* called.
    *   **No Mention**: Simulates a message *not* mentioning the bot and asserts the wrapper is *not* called.
    *   **Mention, No Repo**: Simulates a mention in a channel *without* a DB record. Asserts the wrapper is *not* called and the correct "not configured" reply is sent.
    *   **Mention, Repo Found, Wrapper Called**: Simulates a mention in the *configured* channel. Asserts the initial "Processing" reply is sent, `invokeAiderWrapper` *is* called with the correct extracted prompt, and the final `channel.send` contains the mocked successful response. Uses `setImmediate` to allow async operations within the handler to complete before assertions.
    *   **Mention, Repo Found, Wrapper Fails**: Similar to the success case, but mocks `invokeAiderWrapper` to return a `failure` status. Asserts the initial reply is sent, the wrapper is called, and the final `channel.send` contains the error message from the wrapper.
8.  **`stub.restore()`**: Stubs are restored after each test where they are used to avoid interference.

## Step 5: Update `package.json`

Add the test script command if you haven't already, or ensure it runs all tests including the new one. Also add `sinon` if it's not already a dev dependency.

```bash
npm install --save-dev sinon
```

Ensure your `package.json`'s `scripts.test` includes the new file (e.g., using a glob pattern):

```json
// package.json
{
  // ... other properties
  "scripts": {
    "test": "tape test/**/*.test.js", // Ensure this pattern catches the new file
    "lint": "standard",
    "start": "node index.js" // Or your main file
    // ... other scripts
  }
  // ... dependencies / devDependencies
}
```

## Step 6: Run Tests

Execute the tests to ensure the new functionality works as expected and doesn't break existing features.

```bash
npm test
```

Address any failures in the code or the tests. Remember you might need to adjust the test setup depending on exactly how your `messageCreate` handler is implemented and attached in `index.js`.

## Conclusion

You have now implemented the core logic for the bot to respond to mentions. It checks for configuration, extracts user prompts, calls the Python backend via the Node.js wrapper, and provides feedback to the user. The next step will focus on refining how the output from the Python script (especially code blocks or formatted text) is presented back to the user in Discord. 