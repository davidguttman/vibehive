const test = require('tape')
const { invokeAiderWrapper } = require('../lib/pythonWrapper')

test('invokeAiderWrapper should return success for valid prompts', async (t) => {
  t.plan(1)
  const result = await invokeAiderWrapper('Write a hello world program in python')
  t.equal(result.status, 'success', 'Should return status success')
})

test('invokeAiderWrapper should handle errors for invalid prompts', async (t) => {
  t.plan(2)
  const result = await invokeAiderWrapper('') // Empty prompt
  t.equal(result.status, 'failure', 'Should return status failure')
  t.equal(result.error, 'Invalid prompt provided.', 'Should return specific error message for empty prompt')
})

test('invokeAiderWrapper should handle python script errors', async (t) => {
  // This test assumes the python script might fail or return an error structure
  // Adjust the prompt or mock the python script execution if needed to simulate an error
  t.plan(1)
  // Example: Simulating an error response by modifying the expected output or using a specific prompt known to cause issues
  // For now, let's assume a specific prompt might trigger a known error condition in the python script
  // or that the script itself is modified for testing to return an error structure
  const result = await invokeAiderWrapper('trigger error') // Assuming this prompt causes the python script to indicate failure
  // The expected result depends on how the python script signals errors.
  // Check for the new failure structure when the script is expected to fail
  t.equal(result.status, 'failure', 'Should return status failure for script error')
})
