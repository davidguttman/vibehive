# Tutorial 24: Detect File Changes in Python Wrapper

This tutorial explains how to enhance the `aider_wrapper.py` script to detect file modifications, additions, and deletions performed by the `aider` Coder within a Git repository context. It leverages the `GitPython` library to compare the repository state before and after `aider` runs.

**Goal:** Modify `aider_wrapper.py` to identify files changed by `aider` and include detailed `file_change` events in the structured JSON output.

## Prerequisites

*   Completion of Tutorial 23 (`23-integrate-aider.md`).
*   `git` installed on the system where the wrapper runs.
*   The directory where `aider_wrapper.py` is executed must be the root of a Git repository or within one.

## Steps

1.  **Update Dependencies:** Add `GitPython` to your `requirements.txt` file.
    ```txt
    # requirements.txt
    aider-chat
    GitPython
    ```
    Install or update dependencies:
    ```bash
    pip install -r requirements.txt
    ```

2.  **Modify `aider_wrapper.py` - Imports:** Add the necessary import for `git`.
    ```python
    # At the top of aider_wrapper.py
    from aider.coders import Coder
    from aider.io import InputOutput
    import traceback
    import sys
    import json
    import argparse
    import git # <-- Add this import
    import os # <-- Add this import for path joining
    ```

3.  **Modify `aider_wrapper.py` - Before `coder.run()`:** Inside the `try` block, before initializing or running the `Coder`:
    *   Initialize a `git.Repo` object to interact with the repository in the current working directory.
    *   Get the initial Git status using the porcelain format, which is stable for scripting.
    ```python
    # Inside the try block, before coder = Coder(...)
    repo = git.Repo('.')
    repo_root = repo.working_tree_dir
    initial_status_output = repo.git.status('--porcelain')
    ```

4.  **Modify `aider_wrapper.py` - After `coder.run()`:** Still inside the `try` block, *after* `coder.run()` has successfully completed:
    *   Get the final Git status.
    *   Implement logic to parse the status output and identify changes.
    *   Prepare `file_change` events for the JSON output.

    ```python
    # Inside the try block, after coder.run(...)

    final_status_output = repo.git.status('--porcelain')

    file_changes = [] # List to hold file change events

    # --- Simple Status Parsing Logic ---
    # Note: This is a basic parser. Robust parsing might need more detail.
    # It compares lines in initial and final status for simplicity.
    # A more robust approach involves parsing each line's status code (' M', '??', etc.)

    initial_lines = set(line.strip() for line in initial_status_output.splitlines())
    final_lines = set(line.strip() for line in final_status_output.splitlines())

    # Crude detection: Files present in final but not initial (or different status)
    # This doesn't perfectly capture all transitions but is a starting point.
    changed_or_new_lines = final_lines - initial_lines
    deleted_lines = initial_lines - final_lines # Lines gone from status

    for line in changed_or_new_lines:
        parts = line.split(maxsplit=1)
        status_code = parts[0]
        filepath = parts[1].strip()
        full_path = os.path.join(repo_root, filepath)

        change_type = "unknown"
        content = None
        diff = None

        if status_code == '??': # Untracked -> Added
            change_type = "added"
            try:
                with open(full_path, 'r') as f:
                    content = f.read()
            except Exception:
                content = None # Handle potential read errors
        elif status_code.startswith('M') or status_code.startswith('A'): # Modified or Staged Added/Modified
             change_type = "modified" # Treat staged adds/mods as modified for simplicity here
             try:
                 with open(full_path, 'r') as f:
                     content = f.read()
                 # Attempt to get diff against HEAD (may fail if file is new/unstaged)
                 try:
                     diff = repo.git.diff('HEAD', '--', filepath)
                 except git.GitCommandError:
                     diff = None # Diff might not be possible depending on state
             except Exception:
                 content = None
                 diff = None
        # Add more status codes (' D', 'R ', 'C ', etc.) as needed

        if change_type != "unknown":
             file_changes.append({
                 "type": "file_change",
                 "filename": filepath, # Relative path from status
                 "change_type": change_type,
                 "content": content,
                 "diff": diff
             })

    for line in deleted_lines:
         # Simplistic check: if a line representing a tracked file disappeared
         if not line.startswith('??'): # Ignore if it was just untracked before
            parts = line.split(maxsplit=1)
            filepath = parts[1].strip()
            # Check if file *actually* doesn't exist anymore
            full_path = os.path.join(repo_root, filepath)
            if not os.path.exists(full_path):
                 file_changes.append({
                     "type": "file_change",
                     "filename": filepath,
                     "change_type": "deleted",
                     "content": None,
                     "diff": None
                 })

    # --- Update Success Output ---
    success_message = "Aider run completed."
    if file_changes:
        success_message += f" Detected {len(file_changes)} file change(s)."

    output = {
        "overall_status": "success",
        "error": None,
        "events": [
            {"type": "status_message", "content": success_message}
            # Potentially add {"type": "text_response", ...} from Tutorial 23 if needed
        ] + file_changes # Append the detected changes
    }
    print(json.dumps(output, indent=2)) # Use indent for readability

    # --- Update Exception Handling (Optional) ---
    # You might want to modify the failure JSON in the `except` block
    # to indicate that file change detection might be incomplete due to the error.
    # Example for except block:
    # ... existing except block ...
    # output = { ... }
    # output["events"].append({"type": "status_message", "content": "File change detection may be incomplete due to error."})
    # print(json.dumps(output, indent=2))
    # ... rest of except block ...
    ```
    *Self-Correction:* The initial prompt suggested `repo.index.iter_blobs()` or complex diffing. Using `git status --porcelain` before and after is simpler and more robust for detecting changes, including untracked files becoming tracked (added) or files being deleted. Parsing the porcelain format is the key challenge. The code above provides a *basic* parsing approach; a production system might need a more thorough parser covering all Git status codes (` M`, `A `, ` D`, `R `, `C `, `??`, etc.). Generating diffs also requires care depending on whether changes are staged or not. The example uses `repo.git.diff('HEAD', '--', filepath)` which works for tracked files modified relative to the last commit.

5.  **Refine `overall_status` and Messages:** The code in Step 4 includes an example of updating the success message based on whether changes were detected. You could further refine `overall_status` if needed, but "success" generally indicates the `aider` process itself finished.

## Testing (`test/aider_wrapper.test.js`)

Testing this functionality requires setting up a temporary Git repository environment.

*   **Dependencies:** Your test setup might need `fs-extra` for easier file system manipulation and cleanup.
*   **Test Structure:**
    1.  **`beforeEach` Hook:**
        *   Create a temporary directory (e.g., using `tmp.dirSync()` or `fs.mkdtempSync`).
        *   `cd` into the temporary directory.
        *   Initialize a Git repository (`git init`).
        *   Create and commit an initial file (e.g., `dummy.txt`). Use `execaSync` or similar.
            ```javascript
            // Example using execa
            const execa = require('execa');
            const fs = require('fs-extra');
            const path = require('path');
            const os = require('os');

            let testRepoPath;

            beforeEach(() => {
              testRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-test-'));
              execa.sync('git', ['init'], { cwd: testRepoPath });
              fs.writeFileSync(path.join(testRepoPath, 'dummy.txt'), 'Initial content.');
              execa.sync('git', ['add', '.'], { cwd: testRepoPath });
              execa.sync('git', ['commit', '-m', 'Initial commit'], { cwd: testRepoPath });
            });
            ```
    2.  **`afterEach` Hook:**
        *   Clean up the temporary directory (`fs.removeSync(testRepoPath)`).
    3.  **Test Cases (using `ava` or your chosen runner):**
        *   **Modification:**
            *   In your test, *before* running `aider_wrapper.py`, modify `dummy.txt` within `testRepoPath`.
            *   Run `aider_wrapper.py` (mocking `coder.run` if needed, but ensure it exits successfully). Crucially, run it with `cwd: testRepoPath`.
            *   Parse the JSON output.
            *   Assert that the `events` array contains one `file_change` event.
            *   Assert the event has `filename: "dummy.txt"`, `change_type: "modified"`.
            *   Assert `content` matches the modified content.
            *   Assert `diff` is present (or handle cases where it might be null).
        *   **Addition:**
            *   Mock `coder.run` or modify the test setup to simulate `aider` creating `new.txt` inside `testRepoPath` *after* the initial commit but *before* the final `git status` check would happen conceptually (or just place the file there before running the wrapper).
            *   Run `aider_wrapper.py` with `cwd: testRepoPath`.
            *   Parse JSON output.
            *   Assert a `file_change` event exists for `new.txt` with `change_type: "added"` and correct `content`.
        *   **Deletion:**
            *   *Before* running the wrapper, delete `dummy.txt` from `testRepoPath`.
            *   Run `aider_wrapper.py` with `cwd: testRepoPath`.
            *   Parse JSON output.
            *   Assert a `file_change` event exists for `dummy.txt` with `change_type: "deleted"`.
*   **Running Tests:** Ensure these tests are executed as part of your `npm test` command.

## Conclusion

By integrating `GitPython` and parsing `git status`, the `aider_wrapper.py` script can now effectively report file changes made during an `aider` session. This provides valuable feedback on the actions taken by the AI coder. Remember that robust status parsing and diff generation might require further refinement based on specific needs and edge cases. 