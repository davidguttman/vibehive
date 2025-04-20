# Tutorial: Creating a Placeholder `aider` Wrapper Script

This tutorial involves creating a simple Python script that acts as a stand-in (placeholder) for a more complex interaction, like calling an external AI tool (`aider`). This script will parse a command-line argument and output a structured JSON response, simulating the expected output format.

## Prerequisites

*   Python 3 installed on your system.
*   Basic understanding of command-line arguments.

## Step 1: Create the Script File

We'll place the script in the project root for simplicity, but you could place it in a `scripts/` directory if preferred.

Create the file `aider_wrapper.py` in the project root:

```python
#!/usr/bin/env python3
# aider_wrapper.py

import argparse
import json
import sys

def main():
    parser = argparse.ArgumentParser(description="Placeholder for aider interaction.")
    parser.add_argument("--prompt", required=True, help="The prompt to send to the placeholder.")

    try:
        args = parser.parse_args()
        prompt_value = args.prompt

        response = {
            "overall_status": "success",
            "error": None,
            "events": [
                {
                    "type": "text_response",
                    "content": f"Placeholder response for prompt: {prompt_value}"
                }
            ]
        }

        # Print the JSON response to stdout
        json.dump(response, sys.stdout, indent=2)
        print() # Add a newline for cleaner output

    except SystemExit as e:
        # Argparse exits with status 2 for missing required arguments
        # We don't need to print the default argparse error message again
        # Just ensure we exit with a non-zero code
        if e.code != 0:
            sys.stderr.write("Error: --prompt argument is required.\n")
        sys.exit(e.code if e.code is not None else 1) # Exit with argparse code or 1
    except Exception as e:
        # Catch other potential errors
        sys.stderr.write(f"An unexpected error occurred: {e}\n")
        # Print a JSON error structure to stdout (optional, depends on desired error handling)
        error_response = {
            "overall_status": "error",
            "error": str(e),
            "events": []
        }
        json.dump(error_response, sys.stdout, indent=2)
        print()
        sys.exit(1)

if __name__ == "__main__":
    main()

```

**Explanation:**
1.  **`#!/usr/bin/env python3`**: Shebang line, indicating the script should be executed with Python 3.
2.  **Imports**: Imports `argparse` for command-line argument parsing, `json` for JSON handling, and `sys` for interacting with stdin/stdout/stderr and exit codes.
3.  **`argparse.ArgumentParser`**: Sets up the argument parser.
4.  **`parser.add_argument("--prompt", required=True, ...)`**: Defines the `--prompt` argument, making it mandatory.
5.  **`parser.parse_args()`**: Parses the arguments provided when the script is run. If `--prompt` is missing, `argparse` will automatically print an error to stderr and try to exit (which we catch).
6.  **Response Dictionary**: Creates the standard success response dictionary.
7.  **`f"Placeholder... {prompt_value}"`**: Uses an f-string to embed the provided prompt value into the response content.
8.  **`json.dump(response, sys.stdout, indent=2)`**: Prints the Python dictionary as a formatted JSON string directly to standard output.
9.  **Error Handling**: 
    *   Catches `SystemExit` which `argparse` raises on errors (like missing arguments). It checks the exit code and prints a custom message to stderr if needed.
    *   Catches general `Exception` for other unexpected issues, prints to stderr, and optionally outputs a JSON error object.
10. **`if __name__ == "__main__":`**: Standard Python practice to ensure the `main()` function is called only when the script is executed directly.

## Step 2: Make the Script Executable

In your terminal, give the script execute permissions:

```bash
chmod +x aider_wrapper.py
```

## Step 3: Testing the Script Manually (Optional)

You can test the script directly from your terminal:

*   **Success Case:**
    ```bash
    ./aider_wrapper.py --prompt "Test this script"
    ```
    *(Should output the success JSON with "Test this script" embedded)*

*   **Error Case (Missing Prompt):**
    ```bash
    ./aider_wrapper.py
    ```
    *(Should print "Error: --prompt argument is required." to stderr and exit with a non-zero code)*

## Step 4: Create Node.js Test File (`test/aider_wrapper.test.js`)

Now, create a test file in your Node.js project to execute this Python script as a child process and verify its behavior.

Create `test/aider_wrapper.test.js`:

```javascript
// test/aider_wrapper.test.js
const test = require('tape')
const { execFile } = require('child_process')
const path = require('path')

// Resolve the path to the Python script relative to the test file
const scriptPath = path.resolve(__dirname, '../aider_wrapper.py')

// Helper to run the script
function runScript (args, callback) {
  // Use 'python3' or 'python' depending on your system setup
  // Ensure the script is executable or call python3 directly
  execFile('python3', [scriptPath, ...args], (error, stdout, stderr) => {
    callback(error, stdout, stderr)
  })
}

test('Aider Wrapper Script - Success Case', (t) => {
  const promptText = 'hello world'
  runScript(['--prompt', promptText], (error, stdout, stderr) => {
    t.error(error, 'Script should exit without error (error code 0)')
    t.equal(stderr, '', 'Stderr should be empty on success')

    try {
      const output = JSON.parse(stdout)
      t.ok(output, 'Stdout should be valid JSON')
      t.equal(output.overall_status, 'success', 'Status should be success')
      t.equal(output.error, null, 'Error field should be null')
      t.ok(Array.isArray(output.events), 'Events should be an array')
      t.equal(output.events.length, 1, 'Events array should have one element')
      t.equal(output.events[0].type, 'text_response', 'Event type should be text_response')
      t.equal(output.events[0].content, `Placeholder response for prompt: ${promptText}`, 'Event content should contain the prompt')
    } catch (parseError) {
      t.fail(`Failed to parse JSON output: ${parseError}\nOutput: ${stdout}`)
    }

    t.end()
  })
})

test('Aider Wrapper Script - Error Case (Missing Prompt)', (t) => {
  runScript([], (error, stdout, stderr) => {
    t.ok(error, 'Script should exit with an error (non-zero code)')
    // Different Python/argparse versions might exit with 1 or 2
    t.ok(error.code !== 0, `Exit code should be non-zero (was ${error.code})`)
    t.ok(stderr.includes('Error: --prompt argument is required.'), 'Stderr should contain the custom error message')
    // Depending on argparse version, stdout might be empty or contain usage info
    // t.equal(stdout, '', 'Stdout should ideally be empty on argument error')
    t.comment(`Stdout content on error: ${stdout}`)
    t.comment(`Stderr content on error: ${stderr}`)
    t.end()
  })
})

```

**Explanation of `test/aider_wrapper.test.js`:**
1.  Requires `tape`, `child_process.execFile` (safer than `exec` for running specific files), and `path`.
2.  Resolves the absolute path to `aider_wrapper.py`.
3.  A helper function `runScript` executes the Python script using `execFile`, passing arguments and capturing `error`, `stdout`, and `stderr`.
4.  **Success Test**: Calls `runScript` with `--prompt` and a value. It asserts:
    *   No execution error occurred (`t.error`).
    *   `stderr` is empty.
    *   `stdout` is valid JSON (`JSON.parse`).
    *   The JSON structure and content match the expected output, including the prompt value.
5.  **Error Test**: Calls `runScript` with *no* arguments. It asserts:
    *   An execution error *did* occur (`t.ok(error)`).
    *   The error's exit code is non-zero.
    *   `stderr` contains the specific error message we defined in the Python script.

## Step 5: Run Tests

Execute the Node.js tests to ensure the Python script behaves as expected when called as a child process.

```bash
npm test
```

You should see the new `aider_wrapper.test.js` tests passing along with the previous ones.

---

Done! You now have a basic Python wrapper script that accepts a prompt and returns a structured JSON response, along with Node.js tests to verify its core functionality and error handling. 