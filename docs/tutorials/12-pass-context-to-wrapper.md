# Tutorial 12: Pass Context Files to the Aider Wrapper

This tutorial describes how to modify the system to pass the list of context files, stored in the database for a repository, to the Python `aider_wrapper.py` script when the bot is mentioned.

## Task

Pass the stored context files associated with a repository to the Python wrapper script upon a bot mention.

## Requirements

1.  **Modify `aider_wrapper.py`:**
    *   Update the script to accept multiple `--context-file` command-line arguments.
    *   Include the list of received context files in the JSON output for verification purposes.
2.  **Modify `lib/pythonWrapper.js`:**
    *   Update the `invokeAiderWrapper` function to accept an array of context file paths.
    *   Modify the process spawning logic to include `--context-file <path>` for each file in the provided array.
3.  **Modify the `@mention` handler (`events/interactionCreate.js` or similar):**
    *   When handling a mention and a corresponding repository is found in the database, retrieve its `contextFiles` array.
    *   Pass this array to the `invokeAiderWrapper` function.
4.  **Code Style:** Use `standard.js` style for Node.js code. Remember to run `standard --fix`.

## Implementation Steps (Conceptual)

1.  **Update `aider_wrapper.py`:**
    *   Import the `argparse` module.
    *   Add an argument for context files:
        ```python
        parser.add_argument(
            '--context-file',
            action='append', # Allows the argument to appear multiple times
            help='Path to a context file to include',
            default=[] # Initialize with an empty list if none are provided
        )
        ```
    *   Include the received files in the output JSON:
        ```python
        # Inside the main execution block, after parsing args
        args = parser.parse_args()
        # ... other code ...
        result = {
            "prompt": args.prompt,
            # ... other potential output fields ...
            "received_context_files": args.context_file # Add the list here
        }
        print(json.dumps(result))
        ```

2.  **Update `lib/pythonWrapper.js`:**
    *   Modify the function signature:
        ```javascript
        async function invokeAiderWrapper ({ prompt, contextFiles = [] }) {
          // ... existing setup ...
        }
        ```
        *Note: Using an options object and providing a default value for `contextFiles`.*
    *   Build the arguments list dynamically:
        ```javascript
        // Inside invokeAiderWrapper
        const pythonExecutable = 'python3' // Or your configured Python path
        const scriptPath = path.join(__dirname, '..', 'aider_wrapper.py') // Adjust path as needed

        const args = [
          scriptPath,
          '--prompt',
          prompt // Make sure prompt is properly escaped if necessary
        ]

        // Add context file arguments
        for (const filePath of contextFiles) {
          args.push('--context-file', filePath)
        }

        // ... rest of the spawn logic using the 'args' array ...
        const pythonProcess = spawn(pythonExecutable, args)
        // ... handle stdout, stderr, exit ...
        ```

3.  **Update Mention Handler:**
    *   Locate the code that handles bot mentions (likely in `events/interactionCreate.js`).
    *   After finding the `Repository` document for the channel:
        ```javascript
        // Assuming 'repo' is the fetched Mongoose document
        const prompt = interaction.content // Or however the prompt is extracted
        const contextFiles = repo.contextFiles || [] // Get context files from the repo doc

        // Call the updated wrapper function
        try {
          const result = await invokeAiderWrapper({ prompt, contextFiles })
          // Process the result...
          interaction.reply(result.stdout || 'Processed.') // Example reply
        } catch (error) {
          // Handle errors...
          interaction.reply(`Error invoking wrapper: ${error.message}`)
        }
        ```

## Testing

Update the relevant test files to cover the new functionality:

1.  **`test/aider_wrapper.test.js`:**
    *   Add test cases that execute `aider_wrapper.py` directly using `child_process.execFile` or similar.
    *   Pass multiple `--context-file` arguments (e.g., `--context-file file1.txt --context-file path/to/file2.js`).
    *   Parse the JSON output and assert that the `received_context_files` array exists and contains the expected file paths.

2.  **`test/pythonWrapper.test.js`:**
    *   Mock `child_process.spawn`.
    *   Call `invokeAiderWrapper` with a sample `prompt` and an array of `contextFiles`.
    *   Inspect the arguments passed to the mocked `spawn`. Assert that the `args` array includes the script path, `--prompt`, the prompt content, and then pairs of `--context-file` and the corresponding file path for each item in the input `contextFiles` array.

3.  **`test/mentionHandler.test.js`:**
    *   Seed the test database with a `Repository` document that includes a `contextFiles` array (e.g., `['README.md', 'src/main.js']`).
    *   Simulate a mention interaction targeting the channel associated with the seeded repository.
    *   Mock the `invokeAiderWrapper` function (e.g., using `sinon.stub`).
    *   Assert that `invokeAiderWrapper` was called.
    *   Inspect the arguments passed to the mocked `invokeAiderWrapper`. Assert that the `contextFiles` property of the options object matches the array seeded in the database.

Ensure all tests pass by running `npm test`.

## Conclusion

By following these steps, the bot will now correctly retrieve the context files associated with a repository during a mention and pass them along to the underlying Python script, enabling more context-aware interactions. Remember to apply `standard --fix` to ensure code style consistency. 