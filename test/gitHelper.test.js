const test = require('ava')
const sinon = require('sinon')
const proxyquire = require('proxyquire').noCallThru() // Use proxyquire to inject stubs
const { PassThrough } = require('node:stream')

// Define stubs
let spawnStub
let childProcessStub

// Define the module under test with proxyquire
let gitHelper

test.beforeEach(t => {
  // Create fresh stubs for each test
  spawnStub = sinon.stub()
  childProcessStub = { spawn: spawnStub }

  // Use proxyquire to load the module with the stubbed dependency and resolved path
  gitHelper = proxyquire(require.resolve('../lib/gitHelper'), {
    // Use the built-in module name directly as the key when proxying built-ins
    'node:child_process': childProcessStub
  })
})

test.afterEach.always(t => {
  // Restore stubs if necessary (though new ones are created each time)
  sinon.restore()
})

test.serial('gitAddAll calls spawn with correct arguments', async t => {
  const repoPath = '/test/repo'
  const assignedUserId = 'testuser'
  const env = { GIT_SSH_COMMAND: 'ssh -i key' }
  const expectedArgs = [
    'sudo',
    ['-u', assignedUserId, 'git', 'add', '.'],
    { cwd: repoPath, env, stdio: ['ignore', 'pipe', 'pipe'] }
  ]

  // Configure stub behavior
  const mockChild = new PassThrough()
  mockChild.stdout = new PassThrough()
  mockChild.stderr = new PassThrough()
  spawnStub.returns(mockChild)

  // Simulate successful exit
  process.nextTick(() => {
    mockChild.stdout.end('stdout output')
    mockChild.stderr.end('stderr output')
    mockChild.emit('close', 0)
  })

  await gitHelper.gitAddAll({ repoPath, assignedUserId, env })

  // Assert spawn was called once
  t.true(spawnStub.calledOnce, 'spawn should be called exactly once')
  // Assert arguments separately using deep equality
  const actualArgs = spawnStub.getCall(0).args
  t.deepEqual(actualArgs, expectedArgs, 'spawn arguments should match')
})

test.serial('gitCommit calls spawn with correct arguments and escaped message', async t => {
  const repoPath = '/test/repo'
  const assignedUserId = 'testuser'
  const env = { GIT_SSH_COMMAND: 'ssh -i key' }
  const message = 'Test commit "with quotes"'
  // Note: No escaping needed based on implementation review
  const expectedArgs = [
    'sudo',
    ['-u', assignedUserId, 'git', 'commit', '-m', message],
    { cwd: repoPath, env, stdio: ['ignore', 'pipe', 'pipe'] }
  ]

  const mockChild = new PassThrough()
  mockChild.stdout = new PassThrough()
  mockChild.stderr = new PassThrough()
  spawnStub.returns(mockChild)

  process.nextTick(() => mockChild.emit('close', 0))

  await gitHelper.gitCommit({ repoPath, assignedUserId, env, message })

  t.true(spawnStub.calledOnce, 'spawn should be called exactly once')
  const actualArgs = spawnStub.getCall(0).args
  t.deepEqual(actualArgs, expectedArgs, 'spawn arguments should match')
})

test.serial('gitPush calls spawn with correct arguments', async t => {
  const repoPath = '/test/repo'
  const assignedUserId = 'testuser'
  const env = { GIT_SSH_COMMAND: 'ssh -i key' }
  const branchName = 'feature/test-branch'
  const expectedArgs = [
    'sudo',
    ['-u', assignedUserId, 'git', 'push', 'origin', `HEAD:${branchName}`],
    { cwd: repoPath, env, stdio: ['ignore', 'pipe', 'pipe'] }
  ]

  const mockChild = new PassThrough()
  mockChild.stdout = new PassThrough()
  mockChild.stderr = new PassThrough()
  spawnStub.returns(mockChild)

  process.nextTick(() => mockChild.emit('close', 0))

  await gitHelper.gitPush({ repoPath, assignedUserId, env, branchName })

  t.true(spawnStub.calledOnce, 'spawn should be called exactly once')
  const actualArgs = spawnStub.getCall(0).args
  t.deepEqual(actualArgs, expectedArgs, 'spawn arguments should match')
})

test.serial('executeGitCommand rejects on non-zero exit code', async t => {
  const repoPath = '/test/repo'
  const assignedUserId = 'testuser'
  const env = { GIT_SSH_COMMAND: 'ssh -i key' }

  const mockChild = new PassThrough()
  mockChild.stdout = new PassThrough()
  mockChild.stderr = new PassThrough()
  spawnStub.returns(mockChild)

  process.nextTick(() => {
    mockChild.stderr.end('Git error message')
    mockChild.emit('close', 1)
  })

  await t.throwsAsync(
    () => gitHelper.gitAddAll({ repoPath, assignedUserId, env }),
    { message: /Git command failed with code 1. Stderr: Git error message/ }
  )
})

test.serial('executeGitCommand rejects on spawn error', async t => {
  const repoPath = '/test/repo'
  const assignedUserId = 'testuser'
  const env = { GIT_SSH_COMMAND: 'ssh -i key' }
  const spawnError = new Error('Spawn failed')

  const mockChild = new PassThrough()
  mockChild.stdout = new PassThrough()
  mockChild.stderr = new PassThrough()
  spawnStub.returns(mockChild)

  process.nextTick(() => {
    mockChild.emit('error', spawnError)
  })

  await t.throwsAsync(
    () => gitHelper.gitAddAll({ repoPath, assignedUserId, env }),
    { instanceOf: Error, message: 'Spawn failed' }
  )
})
