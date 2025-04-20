const test = require('tape')
const proxyquire = require('proxyquire')
const sinon = require('sinon')
const path = require('path')

// Mock the child_process module
const spawnStub = sinon.stub()
const mockChildProcess = {
  spawn: spawnStub
}

// Use proxyquire to inject the mock
const { invokeAiderWrapper } = proxyquire('../lib/pythonWrapper', {
  child_process: mockChildProcess
})

const scriptPath = path.resolve(__dirname, '../aider_wrapper.py') // Get expected script path

test('invokeAiderWrapper setup', t => {
  // Reset the stub before each test group if necessary, or within each test
  spawnStub.reset()
  t.end()
})

test('invokeAiderWrapper should call spawn with correct args (no context files)', async (t) => {
  t.plan(3)
  spawnStub.reset()
  // Mock the spawned process behavior (needs to emit 'close')
  const mockProcess = new (require('events').EventEmitter)()
  mockProcess.stdout = new (require('events').EventEmitter)()
  mockProcess.stderr = new (require('events').EventEmitter)()
  spawnStub.returns(mockProcess)

  const prompt = 'hello'
  const expectedArgs = [scriptPath, '--prompt', prompt]
  const expectedJson = { overall_status: 'success', events: [{ type: 'text_response', content: 'mock' }], received_context_files: [] }

  // Call the function
  const resultPromise = invokeAiderWrapper({ prompt })

  // Simulate successful process exit
  mockProcess.stdout.emit('data', JSON.stringify(expectedJson))
  mockProcess.emit('close', 0)

  // Wait for the promise to resolve
  const result = await resultPromise

  // Assert spawn was called
  t.ok(spawnStub.calledOnce, 'spawn should be called once')
  // Assert arguments passed to spawn
  t.deepEqual(spawnStub.firstCall.args[1], expectedArgs, 'spawn called with correct arguments')
  // Assert the result (optional, focuses on interaction here)
  t.equal(result.status, 'success', 'Should return status success')
})

test('invokeAiderWrapper should call spawn with context file args', async (t) => {
  t.plan(3)
  spawnStub.reset()
  const mockProcess = new (require('events').EventEmitter)()
  mockProcess.stdout = new (require('events').EventEmitter)()
  mockProcess.stderr = new (require('events').EventEmitter)()
  spawnStub.returns(mockProcess)

  const prompt = 'process files'
  const contextFiles = ['fileA.js', 'dir/fileB.txt']
  const expectedArgs = [
    scriptPath,
    '--prompt', prompt,
    '--context-file', 'fileA.js',
    '--context-file', 'dir/fileB.txt'
  ]
  const expectedJson = { overall_status: 'success', events: [], received_context_files: contextFiles }

  const resultPromise = invokeAiderWrapper({ prompt, contextFiles })

  mockProcess.stdout.emit('data', JSON.stringify(expectedJson))
  mockProcess.emit('close', 0)

  const result = await resultPromise

  t.ok(spawnStub.calledOnce, 'spawn should be called once')
  t.deepEqual(spawnStub.firstCall.args[1], expectedArgs, 'spawn called with context file arguments')
  t.equal(result.status, 'success', 'Should return status success')
})

test('invokeAiderWrapper should handle errors for invalid prompts', async (t) => {
  t.plan(2)
  spawnStub.reset()
  // No need to simulate process for invalid input handled before spawn
  const result = await invokeAiderWrapper({ prompt: ' ' }) // Empty prompt
  t.equal(result.status, 'failure', 'Should return status failure for invalid prompt')
  t.equal(result.error, 'Invalid prompt provided.', 'Should return specific error message')
})

test('invokeAiderWrapper should handle python script errors (stderr)', async (t) => {
  t.plan(3)
  spawnStub.reset()
  const mockProcess = new (require('events').EventEmitter)()
  mockProcess.stdout = new (require('events').EventEmitter)()
  mockProcess.stderr = new (require('events').EventEmitter)()
  spawnStub.returns(mockProcess)

  const prompt = 'trigger script error'
  const errorOutput = 'Traceback (most recent call last):\nError!\n'
  const resultPromise = invokeAiderWrapper({ prompt })

  // Simulate error exit
  mockProcess.stderr.emit('data', errorOutput)
  mockProcess.emit('close', 1) // Non-zero exit code

  const result = await resultPromise

  t.ok(spawnStub.calledOnce, 'spawn should be called')
  t.equal(result.status, 'failure', 'Should return status failure for script error')
  t.equal(result.error, errorOutput, 'Should capture stderr as error message')
})

test('invokeAiderWrapper should handle JSON parsing errors', async (t) => {
  t.plan(3)
  spawnStub.reset()
  const mockProcess = new (require('events').EventEmitter)()
  mockProcess.stdout = new (require('events').EventEmitter)()
  mockProcess.stderr = new (require('events').EventEmitter)()
  spawnStub.returns(mockProcess)

  const prompt = 'trigger bad json'
  const badJsonOutput = 'This is not JSON{'
  const resultPromise = invokeAiderWrapper({ prompt })

  // Simulate success exit but with bad JSON
  mockProcess.stdout.emit('data', badJsonOutput)
  mockProcess.emit('close', 0)

  const result = await resultPromise

  t.ok(spawnStub.calledOnce, 'spawn should be called')
  t.equal(result.status, 'failure', 'Should return status failure for JSON error')
  t.ok(result.error.includes('Failed to parse JSON output'), 'Error message should indicate JSON parsing failure')
})
