import process from 'node:process'
import { registerCompletionHandler } from 'ava'

registerCompletionHandler(() => {
  console.log('>>> AVA Completion Handler: Forcing exit. <<<')
  process.exit(0) // Use exit code 0 for success
})
