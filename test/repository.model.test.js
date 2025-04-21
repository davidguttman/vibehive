// test/repository.model.test.js
const test = require('ava')
const { MongoMemoryServer } = require('mongodb-memory-server')
process.env.NODE_ENV = 'test' // Ensure test environment is set
const mongoose = require('mongoose')
const Repository = require('../models/Repository') // Load the model
const { connectDB, closeDB } = require('../lib/mongo') // Use the refactored DB connection

let mongoServer
let mongoUri

test.before('** Setup Mongoose Connection **', async (t) => {
  mongoServer = await MongoMemoryServer.create()
  mongoUri = mongoServer.getUri()
  await connectDB(mongoUri) // Connect using our DB module
  t.pass('Mongoose connected for Repository tests')
})

test.serial('Repository Model - Save Success', async (t) => {
  const validRepoData = {
    repoUrl: 'https://github.com/user/repo.git',
    discordChannelId: 'channel123'
  }
  const repository = new Repository(validRepoData)

  try {
    const savedRepo = await repository.save()
    t.truthy(savedRepo._id, 'Should save successfully and return an _id')
    t.truthy(savedRepo.repoUrl, 'Should have repoUrl')
    t.truthy(savedRepo.discordChannelId, 'Should have discordChannelId')
    t.truthy(savedRepo.createdAt, 'Should have createdAt timestamp')
    t.truthy(savedRepo.updatedAt, 'Should have updatedAt timestamp')
    t.true(Array.isArray(savedRepo.contextFiles), 'contextFiles should be an array')
    t.is(savedRepo.contextFiles.length, 0, 'contextFiles should be empty by default')
    await Repository.deleteMany({ discordChannelId: validRepoData.discordChannelId })
  } catch (err) {
    t.fail('Should not throw validation error for valid data')
    console.error(err)
  }
})

test.serial('Repository Model - Validation Error (Missing repoUrl)', async (t) => {
  const invalidRepoData = {
    // repoUrl is missing
    discordChannelId: 'channel456'
  }
  const repository = new Repository(invalidRepoData)

  try {
    await repository.save()
    t.fail('Should have thrown a validation error for missing repoUrl')
  } catch (err) {
    t.truthy(err instanceof mongoose.Error.ValidationError, 'Error should be a Mongoose ValidationError')
    t.truthy(err.errors.repoUrl, 'Error details should mention repoUrl')
    t.is(err.errors.repoUrl.kind, 'required', 'Error kind should be required')
  }
})

test.serial('Repository Model - Validation Error (Missing discordChannelId)', async (t) => {
  const invalidRepoData = {
    repoUrl: 'https://github.com/user/another.git'
    // discordChannelId is missing
  }
  const repository = new Repository(invalidRepoData)

  try {
    await repository.save()
    t.fail('Should have thrown a validation error for missing discordChannelId')
  } catch (err) {
    t.truthy(err instanceof mongoose.Error.ValidationError, 'Error should be a Mongoose ValidationError')
    t.truthy(err.errors.discordChannelId, 'Error details should mention discordChannelId')
  }
})

test.serial('Repository Model - Uniqueness Error (discordChannelId)', async (t) => {
  const repoData1 = { repoUrl: 'url1', discordChannelId: 'uniqueChannel789' }
  const repoData2 = { repoUrl: 'url2', discordChannelId: 'uniqueChannel789' } // Same channel ID

  try {
    await new Repository(repoData1).save()
    t.pass('First repository saved successfully')
    await new Repository(repoData2).save()
    t.fail('Should have thrown a uniqueness error on discordChannelId')
  } catch (err) {
    // Mongoose uniqueness error code is 11000
    t.truthy(err.code === 11000 || err.message.includes('duplicate key'), 'Error should indicate a duplicate key violation')
    await Repository.deleteMany({ discordChannelId: 'uniqueChannel789' })
  }
})

test.serial('Repository Model - Update contextFiles', async (t) => {
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

    t.truthy(updatedRepo, 'Updated document should be returned')
    t.true(Array.isArray(updatedRepo.contextFiles), 'contextFiles should still be an array')
    t.is(updatedRepo.contextFiles.length, filesToAdd.length, 'contextFiles should have the added files')
    t.deepEqual(updatedRepo.contextFiles.slice().sort(), filesToAdd.slice().sort(), 'contextFiles content should match') // Sort for reliable comparison
    await Repository.deleteMany({ discordChannelId: initialData.discordChannelId })
  } catch (err) {
    t.fail('Should not throw error during update test')
    console.error(err)
  }
})

test.serial('Repository Model - Create and Save with SSH Key', async (t) => {
  const repoData = {
    repoUrl: 'git@github.com:user/test-repo-ssh.git',
    discordChannelId: 'channel-ssh-123',
    contextFiles: ['README.md'],
    encryptedSshKey: 'dummy-encrypted-key-data' // Add the new field
  }
  const repository = new Repository(repoData)
  let savedRepo
  try {
    savedRepo = await repository.save()

    t.truthy(savedRepo._id, 'Repository should be saved with an ID')
    t.is(savedRepo.repoUrl, repoData.repoUrl, 'repoUrl should match')
    t.is(savedRepo.discordChannelId, repoData.discordChannelId, 'discordChannelId should match')
    t.deepEqual(savedRepo.contextFiles.slice(), repoData.contextFiles, 'contextFiles should match')
    t.is(savedRepo.encryptedSshKey, repoData.encryptedSshKey, 'encryptedSshKey should match') // Assert the new field
    if (savedRepo) await Repository.findByIdAndDelete(savedRepo._id)
  } catch (err) {
    t.fail('Should not fail saving repo with SSH key')
    console.error(err)
  }
})

test.serial('Repository Model - Find and Update with SSH Key', async (t) => {
  const initialData = {
    repoUrl: 'git@github.com:user/update-ssh.git',
    discordChannelId: 'channel-ssh-456',
    encryptedSshKey: 'initial-key'
  }
  let repo
  try {
    repo = await new Repository(initialData).save()
    t.pass('Created initial repo for update test')

    const foundRepo = await Repository.findById(repo._id)
    t.truthy(foundRepo, 'Repository should be found by ID')
    t.is(foundRepo.encryptedSshKey, initialData.encryptedSshKey, 'Initial SSH key should match')

    const updatedKey = 'updated-encrypted-key-data'
    foundRepo.encryptedSshKey = updatedKey
    const updatedRepo = await foundRepo.save()

    t.is(updatedRepo.encryptedSshKey, updatedKey, 'encryptedSshKey should be updated')
    if (repo) await Repository.findByIdAndDelete(repo._id)
  } catch (err) {
    t.fail('Should not fail finding/updating repo with SSH key')
    console.error(err)
  }
})

test.after.always('** Teardown Mongoose Connection **', async (t) => {
  await closeDB() // Disconnect Mongoose
  if (mongoServer) {
    await mongoServer.stop() // Stop the in-memory server
  }
  t.pass('Mongoose disconnected and server stopped')
})
