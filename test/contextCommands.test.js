const test = require('tape')
const { MongoMemoryServer } = require('mongodb-memory-server')
const mongoose = require('mongoose')
const Repository = require('../models/Repository') // Adjust path as needed
// Remove direct require of handler:
// const interactionHandler = require('../events/interactionCreate') // Adjust path as needed

// Need Client to emit events
const { Client, Events, GatewayIntentBits } = require('discord.js')

let mongoServer
let client // Declare client for emitting events

// Mock interaction object factory
const createMockInteraction = (commandName, options = {}, discordChannelId = 'test-channel-123') => ({
  channelId: discordChannelId, // Keep channelId for interaction object as Discord uses that
  commandName,
  options: {
    getString: (key) => options[key]
    // Add other option types if needed (getBoolean, getInteger, etc.)
  },
  reply: test.Test.prototype.comment, // Use tape's comment for mock replies
  followUp: test.Test.prototype.comment, // Use tape's comment for mock followUps
  isChatInputCommand: () => true,
  replied: false,
  deferred: false,
  // Mock guild related properties if needed by handler checks
  inGuild: () => true,
  guildId: 'mock-guild-id'
  // Add other properties/methods if your handler uses them
})

// Test setup: start in-memory MongoDB and connect mongoose
test.onFinish(async () => {
  // Disconnect Mongoose *after* all tests run
  // This allows subsequent test files (like db.test.js) to manage their own connections
  // without this file interfering by disconnecting too early.
  // However, ensure it *does* disconnect eventually.
  await mongoose.disconnect().catch(err => console.error('Error during final disconnect:', err))
  if (mongoServer) {
    await mongoServer.stop()
  }
})

test('Setup In-Memory MongoDB and Discord Client', async (t) => {
  // Start Mongo
  mongoServer = await MongoMemoryServer.create()
  // const mongoUri = mongoServer.getUri() // Removed unused variable
  // DO NOT connect mongoose globally here. Let tests manage connection via connectDB if needed.
  // try {
  t.pass('In-memory MongoDB server started for contextCommands tests')

  // Setup mock client and load handlers (similar to index.js but minimal)
  client = new Client({ intents: [GatewayIntentBits.Guilds] }) // Minimal intents
  const eventPath = require('path').join(__dirname, '../events/interactionCreate.js')
  const event = require(eventPath)
  if (event.name && event.execute) {
    client.on(event.name, (...args) => event.execute(...args))
    t.pass(`Loaded event handler: ${event.name}`)
  } else {
    t.fail('Could not load interactionCreate handler')
  }

  t.end()
})

// Helper to run command via event emission
async function runCommand (t, interaction) {
  return new Promise((resolve) => {
    // Override reply/followUp to signal test completion
    interaction.reply = (options) => {
      t.comment(`Interaction replied: ${JSON.stringify(options)}`)
      resolve(options) // Resolve with reply content for assertions
    }
    interaction.followUp = (options) => {
      t.comment(`Interaction followed up: ${JSON.stringify(options)}`)
      resolve(options) // Resolve with followUp content
    }

    client.emit(Events.InteractionCreate, interaction)
  })
}

test('Context Commands: Setup Data', async (t) => {
  try {
    // Ensure DB connection using the specific server for this test file
    const mongoUri = mongoServer.getUri() // Get URI from this file's server
    const { connectDB } = require('../lib/mongo') // Require connectDB here
    await connectDB(mongoUri) // Connect specifically for this test block
    t.pass('Ensured DB connection for Setup Data')

    // Clear potentially existing collection
    await mongoose.connection.db.dropCollection('repositories').catch(err => {
      if (err.codeName !== 'NamespaceNotFound') throw err
    })
    t.pass('Dropped repositories collection (if existed)')

    const initialRepos = [
      { discordChannelId: 'files-channel-1', repoUrl: 'git@github.com:test/files-repo.git', contextFiles: ['file1.js', 'src/file2.ts'] },
      { discordChannelId: 'files-channel-2', repoUrl: 'git@github.com:test/files-repo-empty.git', contextFiles: [] },
      // files-channel-3 is intentionally left out (no repo case)
      { discordChannelId: 'add-channel-1', repoUrl: 'git@github.com:test/repo-add.git', contextFiles: ['existing.txt'] },
      { discordChannelId: 'add-channel-2', repoUrl: 'git@github.com:test/repo-add-invalid.git', contextFiles: [] },
      // add-channel-3 intentionally left out
      { discordChannelId: 'drop-channel-1', repoUrl: 'git@github.com:test/repo-drop.git', contextFiles: ['keep.js', 'remove.txt', 'another/to_remove.css'] },
      { discordChannelId: 'drop-channel-2', repoUrl: 'git@github.com:test/repo-drop-none.git', contextFiles: ['file1.js', 'file2.js'] }
      // drop-channel-3 intentionally left out
    ]
    console.log('DEBUG: Inserting initial repos:', JSON.stringify(initialRepos)) // Debug log
    await Repository.insertMany(initialRepos)
    t.pass('Inserted initial repository data')
  } catch (err) {
    console.error('DEBUG: Error during setup data:', err) // Debug log
    t.fail('Failed to setup initial data', err)
  }
  t.end()
})

test('Context Commands: /files', async (t) => {
  const discordChannelId = 'files-channel-1'
  const interaction = createMockInteraction('files', {}, discordChannelId)

  const replyOptions = await runCommand(t, interaction)

  t.ok(replyOptions.ephemeral, 'Reply should be ephemeral')
  t.match(replyOptions.content, /Files in context:/, 'Reply contains header')
  t.match(replyOptions.content, /`file1.js`/, 'Reply contains file1.js')
  t.match(replyOptions.content, /`src\/file2.ts`/, 'Reply contains src/file2.ts')
  t.end()
})

test('Context Commands: /files (no files)', async (t) => {
  const discordChannelId = 'files-channel-2'
  const interaction = createMockInteraction('files', {}, discordChannelId)
  const replyOptions = await runCommand(t, interaction)

  t.ok(replyOptions.ephemeral, 'Reply should be ephemeral')
  t.equal(replyOptions.content, 'No files currently in context.', 'Reply indicates no files')
  t.end()
})

test('Context Commands: /files (no repo)', async (t) => {
  const discordChannelId = 'files-channel-3' // This channel had no data inserted
  const interaction = createMockInteraction('files', {}, discordChannelId)
  const replyOptions = await runCommand(t, interaction)

  t.ok(replyOptions.ephemeral, 'Reply should be ephemeral')
  t.equal(replyOptions.content, 'No repository configured for this channel.', 'Reply indicates no repo')
  t.end()
})

test('Context Commands: /add', async (t) => {
  const discordChannelId = 'add-channel-1'
  const interaction = createMockInteraction('add', { paths: 'new/file.js another.txt existing.txt ' }, discordChannelId)
  const replyOptions = await runCommand(t, interaction)

  t.ok(replyOptions.ephemeral, 'Reply should be ephemeral')
  t.match(replyOptions.content, /Attempted to add files: `new\/file.js`, `another.txt`, `existing.txt`/, 'Reply confirms added files')

  // Verify database
  const repo = await Repository.findOne({ discordChannelId })
  t.ok(repo, 'Repo should exist')
  t.deepEqual(repo.contextFiles.sort(), ['another.txt', 'existing.txt', 'new/file.js'].sort(), 'Database contains correct files (including existing, ignoring duplicate add)')
  t.end()
})

test('Context Commands: /add (invalid paths)', async (t) => {
  const discordChannelId = 'add-channel-2'
  const interaction = createMockInteraction('add', { paths: 'valid.js /etc/passwd ../../secrets.txt another/valid.ts ' }, discordChannelId)
  const replyOptions = await runCommand(t, interaction)

  t.ok(replyOptions.ephemeral, 'Reply should be ephemeral')
  t.match(replyOptions.content, /Error: Invalid paths detected: `\/etc\/passwd`, `..\/..\/secrets.txt`/, 'Reply indicates invalid paths')

  // Verify database (should not have changed)
  const repo = await Repository.findOne({ discordChannelId })
  t.ok(repo, 'Repo should exist')
  t.deepEqual(repo.contextFiles, [], 'Database should remain unchanged after invalid add attempt')
  t.end()
})

test('Context Commands: /add (no repo)', async (t) => {
  const discordChannelId = 'add-channel-3'
  const interaction = createMockInteraction('add', { paths: 'a/file.js' }, discordChannelId)
  const replyOptions = await runCommand(t, interaction)

  t.ok(replyOptions.ephemeral, 'Reply should be ephemeral')
  t.equal(replyOptions.content, 'No repository configured for this channel.', 'Reply indicates no repo')
  t.end()
})

test('Context Commands: /drop', async (t) => {
  const discordChannelId = 'drop-channel-1'
  const interaction = createMockInteraction('drop', { paths: 'remove.txt not_present.py another/to_remove.css ' }, discordChannelId)
  const replyOptions = await runCommand(t, interaction)

  t.ok(replyOptions.ephemeral, 'Reply should be ephemeral')
  t.match(replyOptions.content, /Removed files: `remove.txt`, `not_present.py`, `another\/to_remove.css`/, 'Reply confirms removed files (even if not present)')

  // Verify database
  const repo = await Repository.findOne({ discordChannelId })
  t.ok(repo, 'Repo should exist')
  t.deepEqual(repo.contextFiles, ['keep.js'], 'Database contains only the remaining file')
  t.end()
})

test('Context Commands: /drop (no files match)', async (t) => {
  const discordChannelId = 'drop-channel-2'
  const interaction = createMockInteraction('drop', { paths: 'nonexistent.txt another.css' }, discordChannelId)
  const replyOptions = await runCommand(t, interaction)

  t.ok(replyOptions.ephemeral, 'Reply should be ephemeral')
  t.match(replyOptions.content, /None of the specified files \(`nonexistent.txt`, `another.css`\) were found/, 'Reply indicates no files were found to remove')

  // Verify database (should not have changed)
  const repo = await Repository.findOne({ discordChannelId })
  t.ok(repo, 'Repo should exist')
  t.deepEqual(repo.contextFiles.sort(), ['file1.js', 'file2.js'].sort(), 'Database should remain unchanged')
  t.end()
})

test('Context Commands: /drop (no repo)', async (t) => {
  const discordChannelId = 'drop-channel-3'
  const interaction = createMockInteraction('drop', { paths: 'a/file.js' }, discordChannelId)
  const replyOptions = await runCommand(t, interaction)

  t.ok(replyOptions.ephemeral, 'Reply should be ephemeral')
  t.equal(replyOptions.content, 'No repository configured for this channel.', 'Reply indicates no repo')
  t.end()
})

// Cleanup: Ensure mongoose connection is closed after all tests
// Note: tape doesn't have a global afterAll hook like jest.
// The test.onFinish handler covers this, but be mindful if tests run in parallel extensively.
