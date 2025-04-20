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
    t.ok(savedRepo.repoUrl, 'Should have repoUrl')
    t.ok(savedRepo.discordChannelId, 'Should have discordChannelId')
    t.ok(savedRepo.createdAt, 'Should have createdAt timestamp')
    t.ok(savedRepo.updatedAt, 'Should have updatedAt timestamp')
    t.ok(Array.isArray(savedRepo.contextFiles), 'contextFiles should be an array')
    t.equal(savedRepo.contextFiles.length, 0, 'contextFiles should be empty by default')
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

test('Repository Model - Update contextFiles', async (t) => {
  const initialData = {
    repoUrl: 'https://github.com/updater/repo.git',
    discordChannelId: 'channelUpdate123'
  }
  const filesToAdd = ['src/index.js', 'README.md']

  try {
    // Create initial document
    const initialRepo = await new Repository(initialData).save()
    t.pass('Initial document created for update test')

    // Update the document
    const updatedRepo = await Repository.findByIdAndUpdate(
      initialRepo._id,
      { $set: { contextFiles: filesToAdd } },
      { new: true } // Return the updated document
    )

    t.ok(updatedRepo, 'Updated document should be returned')
    t.ok(Array.isArray(updatedRepo.contextFiles), 'contextFiles should still be an array')
    t.equal(updatedRepo.contextFiles.length, filesToAdd.length, 'contextFiles should have the added files')
    t.deepEqual(updatedRepo.contextFiles.slice().sort(), filesToAdd.slice().sort(), 'contextFiles content should match') // Sort for reliable comparison
  } catch (err) {
    t.fail('Should not throw error during update test')
    console.error(err)
  } finally {
    // Clean up
    await Repository.deleteMany({ discordChannelId: initialData.discordChannelId })
    t.end()
  }
})

test('** Teardown Mongoose Connection **', async (t) => {
  await closeDB() // Disconnect Mongoose
  await mongoServer.stop() // Stop the in-memory server
  t.pass('Mongoose disconnected and server stopped')
  t.end()
})
