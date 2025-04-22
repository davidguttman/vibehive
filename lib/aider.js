// Stub for invokeAiderWrapper to satisfy imports in tests and main code
async function invokeAiderWrapper (opts) {
  // This stub can be replaced with a real implementation or a proxy to pythonWrapper
  return {
    stdout: '',
    stderr: '',
    error: null,
    data: { overall_status: 'success', events: [] }
  }
}

module.exports = { invokeAiderWrapper }
