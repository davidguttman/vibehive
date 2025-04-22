# Tutorial 23: Integrate Real `aider` into Python Wrapper

This tutorial focuses on modifying the `aider_wrapper.py` script to actually initialize and run the `aider` Coder, replacing the placeholder logic from previous steps. We will also outline how to adapt the corresponding tests.

**Goal:** Make `aider_wrapper.py` use the `aider-chat` library to process prompts and context files, returning structured JSON output.

## Steps

1.  **Modify `aider_wrapper.py`:** Open the `aider_wrapper.py` file.
2.  **Import `aider` Components:** Add the necessary imports at the top of the file:
    ```python
    from aider.coders import Coder
    from aider.io import InputOutput
    import traceback # For printing stack traces
    import sys # For stderr output
    import json # For JSON output
    import argparse # For argument parsing
    ```
3.  **Update Main Execution Block (`if __name__ == "__main__":`)**
    *   **Argument Parsing:** Ensure you have argument parsing set up (likely from Tutorial 12) to get `--prompt` and potentially multiple `--context-file` arguments. Collect context files into a list.
        ```python
        # Example parser setup (adapt as needed)
        parser = argparse.ArgumentParser(description='Aider Wrapper')
        parser.add_argument('--prompt', required=True, help='The user prompt')
        parser.add_argument('--context-file', action='append', default=[], help='Files to include as context')
        args = parser.parse_args()
        prompt = args.prompt
        context_files = args.context_file
        ```
    *   **Initialize `InputOutput`:** Create an `InputOutput` instance configured for non-interactive use.
        ```python
        io = InputOutput(yes=True)
        ```
    *   **Try/Except Block:** Wrap the core logic in a `try...except` block to handle potential errors during `aider` execution.
    *   **Initialize `Coder` (Inside `try`):** Instantiate the `aider` Coder, passing the `io` object and the list of context files. We'll use the default model for now.
        ```python
        # Inside the try block
        coder = Coder(main_model=None, io=io, fnames=context_files)
        ```
    *   **Run `Coder` (Inside `try`):** Execute the coder with the user's prompt using the `with_message` keyword argument.
        ```python
        # Inside the try block, after coder initialization
        coder.run(with_message=prompt)
        ```
    *   **Success Output (Inside `try`):** If `coder.run` completes without error, prepare the success JSON output. Capture any basic text output if available (this might need refinement based on `aider`'s actual output mechanisms).
        ```python
        # Inside the try block, after coder.run
        output = {
            "overall_status": "success",
            "error": None,
            "events": [
                {"type": "status_message", "content": "Aider run completed."}
                # Potentially add {"type": "text_response", "content": coder.io.tool_output or ""}
            ]
        }
        print(json.dumps(output))
        ```
    *   **Exception Handling (`except Exception as e`):** If an exception occurs:
        *   Prepare the failure JSON output, including the error message.
        *   Print the JSON to `stdout`.
        *   Print the full traceback to `stderr` for debugging.
        ```python
        # The except block
        except Exception as e:
            error_message = str(e)
            output = {
                "overall_status": "failure",
                "error": error_message,
                "events": [
                    {"type": "status_message", "content": "Aider run failed."}
                ]
            }
            print(json.dumps(output))
            traceback.print_exc(file=sys.stderr)
            sys.exit(1) # Exit with a non-zero code on failure
        ```
4.  **Update `requirements.txt` (Optional):** If you need a specific version of `aider-chat`, update `requirements.txt` accordingly and run `pip install -r requirements.txt`. Otherwise, ensure `aider-chat` is installed in the environment where the wrapper runs.
    ```
    aider-chat>=0.x.y # Or just aider-chat if any version is fine
    ```

## Testing (`test/aider_wrapper.test.js`)

Testing becomes more complex as it now involves the actual `aider` library.

*   **Option 1 (Mocking):** This is often preferred for unit testing.
    *   You would need a way for your Node.js test to trigger a Python script that uses `unittest.mock`.
    *   This Python helper would mock `aider.coders.Coder` and its `run` method.
    *   The Node test would execute `aider_wrapper.py` (which would use the mocked `aider`).
    *   Assert that `Coder` was initialized with the correct arguments (`fnames`, `io`).
    *   Assert that `coder.run` was called with the correct `with_message`.
    *   Assert that the JSON output printed to `stdout` matches the expected structure for success or failure based on the mock's behavior.
*   **Option 2 (Basic Integration):**
    *   Ensure `aider-chat` is installed in the testing environment (e.g., Docker container or CI environment).
    *   Run `aider_wrapper.py` via your Node test (`execa` or similar) with a very simple prompt (e.g., "--prompt 'hello'") and perhaps an empty dummy context file.
    *   Assert that the script exits with code 0 (or 1 on expected failure).
    *   Assert that the output is valid JSON matching the defined success/failure structure. This doesn't validate `aider`'s specific code generation, just that the wrapper integrates and produces the correct format.

*   **Ensure Tests Run:** Make sure these tests are included when running `npm test`.

## Conclusion

By following these steps, `aider_wrapper.py` will now leverage the real `aider` library to process coding requests based on prompts and context files, providing structured JSON feedback. Remember to adapt the testing strategy based on whether you prioritize unit testing (mocking) or basic integration testing. 