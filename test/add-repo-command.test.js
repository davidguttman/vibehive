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
