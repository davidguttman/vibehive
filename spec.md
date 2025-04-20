Okay, let's consolidate our discussion into a comprehensive specification document.

## Developer Specification: Cloud-Hosted Aider via Discord

**Version:** 1.0
**Date:** 2024-06-20

### 1. Overview

**1.1. Purpose:**
To create a cloud-hosted instance of the `aider` AI coding assistant, fully controllable via a Discord bot interface. The system allows users to perform software development tasks like planning, documentation generation, and code editing/refactoring within Git repositories without requiring a local IDE or desktop environment.

**1.2. Goals:**
*   Provide remote, mobile-friendly access to `aider`'s capabilities.
*   Support interaction with multiple Git repositories.
*   Ensure secure handling of repository credentials and isolation between repositories.
*   Maintain portability across common cloud container hosting platforms (e.g., Render, CapRover, Cloud Run).
*   Provide a user experience within Discord that mirrors interacting with `aider` in a terminal.

**1.3. High-Level Architecture:**
The system consists of a single Docker container running a Node.js application (the Discord bot) which orchestrates interactions with `aider`. The bot manages multiple cloned repositories, uses a Python script to interact with the `aider` library, stores state in MongoDB, and communicates with users via Discord.

```mermaid
graph LR
    User -- Discord Message --> DiscordAPI
    DiscordAPI -- Event --> NodeBot[Node.js Discord Bot (Docker Container)]
    NodeBot -- Read/Write State --> MongoDB[(MongoDB Atlas)]
    NodeBot -- Add to Queue --> RepoQueue[Per-Repo Queue]
    RepoQueue -- Trigger Task --> NodeBot
    NodeBot -- Spawn Process (sudo -u userX) --> PythonScript[Python Script (aider lib)]
    PythonScript -- Use Library --> AiderLib[aider.coders.Coder]
    PythonScript -- Read/Write Files --> RepoFS[/repos/repo_name (Container FS)]
    PythonScript -- Run Git --> GitCLI[Git CLI]
    GitCLI -- Clone/Push (via SSH Key) --> RemoteRepo[Remote Git Repo]
    PythonScript -- JSON Output --> NodeBot
    NodeBot -- Format & Send --> DiscordAPI
    DiscordAPI -- Response --> User

    %% Styling
    classDef botStyle fill:#f9f,stroke:#333,stroke-width:2px;
    classDef dbStyle fill:#ccf,stroke:#333,stroke-width:2px;
    classDef scriptStyle fill:#cfc,stroke:#333,stroke-width:2px;
    classDef fsStyle fill:#eee,stroke:#333,stroke-width:1px;
    class NodeBot botStyle;
    class MongoDB dbStyle;
    class PythonScript scriptStyle;
    class RepoFS fsStyle;

```

### 2. Architecture Details

**2.1. Execution Environment:**
*   The entire application runs within a single Docker container.
*   The container image must include:
    *   Node.js runtime (for the bot).
    *   Python runtime (for `aider` library and wrapper script).
    *   Git CLI.
    *   `aider-chat` Python package and its dependencies.
    *   `sudo` utility.
    *   `tree` utility (optional, for `/tree` command).
*   The Dockerfile should create a non-root user (`appuser`) and run the main bot process as this user (`USER appuser`).
*   A pre-defined pool of unprivileged system users (e.g., `coder1`, `coder2`, ...) will be created in the Dockerfile for repository isolation.
*   `sudo` will be configured to allow `appuser` to run specific commands (`python3`, `git`, `aider` via python script, `rm`, `mkdir`, `chown`) as the `coderX` users without a password.

**2.2. Repository Isolation:**
*   Each configured repository will be cloned into a dedicated directory within the container (e.g., `/repos/<repo_name>`).
*   Each repository will be assigned a user from the pre-defined pool (e.g., `coder1`). This assignment is stored in MongoDB.
*   The repository directory (`/repos/<repo_name>`) will be owned by the assigned user (`coder1`), with permissions preventing write access from other `coderX` users or `appuser`.
*   All `aider` interactions (via the Python script) and Git operations for a repository will be executed using `sudo -u <assigned_user>` with the `cwd` set to the repository directory.

**2.3. Persistence Model:**
*   The container's filesystem is treated as ephemeral.
*   Code changes are persisted by committing and pushing to the remote Git repository frequently.
*   After each successful `aider` run that modifies files, the bot will automatically:
    1.  Stage all changes (`git add .`).
    2.  Commit changes with a descriptive message.
    3.  Push changes to a dedicated branch on the remote (e.g., `aider/channel-<id>`).
*   State required across restarts (configuration, queues, history) is stored in MongoDB.

**2.4. State Management:**
*   MongoDB Atlas (free tier acceptable) will be used for persistent state.
*   Collections needed:
    *   `repositories`: Stores configuration for each added repo (URL, encrypted SSH key, assigned user ID, channel ID, role IDs, context file list).
    *   `message_history`: Stores relevant messages for `aider`'s conversation context, linked to repository/channel ID.
    *   `task_queues`: Manages the pending request queue for each repository.

### 3. Core Functionality

**3.1. Repository Management:**
*   **Adding:** Via `/add-repo` slash command (admin only). Requires Repo URL and SSH key file attachment. The bot encrypts the SSH key using a master `ENCRYPTION_KEY` environment variable (AES recommended) and stores the encrypted key in the `repositories` collection. Clones the repo, assigns a `coderX` user, creates the Discord channel and roles.
*   **Removing:** (Future Consideration) A command like `/remove-repo` (admin only) should delete the repository directory, remove associated Discord roles/channel, and delete all related data from MongoDB.

**3.2. `aider` Interaction Flow:**
1.  User sends command (`@mention` or slash command) in a repository channel.
2.  Bot identifies the repository associated with the channel.
3.  Bot adds the request to the MongoDB task queue for that repository.
4.  When the request reaches the front of the queue:
    *   Bot retrieves necessary data (repo config, context files, history).
    *   Decrypts SSH key to a temporary file within the repo workspace (owned by assigned user, 600 permissions).
    *   Constructs input for the Python script (prompt, context files).
    *   Spawns the Python script using `sudo -u <assigned_user>` with correct `cwd` and environment (including `GIT_SSH_COMMAND`).
    *   Pipes input to the Python script's stdin.
    *   Captures `stdout` (JSON output) and `stderr` from the Python script.
    *   Securely deletes the temporary SSH key file immediately after the script finishes.
    *   Parses the JSON output.
    *   Formats results and sends messages/files to Discord.
    *   If file changes occurred, performs the Git commit and push sequence.
    *   Removes the request from the queue.

**3.3. Queueing:**
*   A separate queue will be maintained for each repository (managed via MongoDB).
*   Requests are processed sequentially per repository.
*   If a user sends a command while another is processing for the same repo, the bot informs the user their request is queued.

### 4. Discord Interface

**4.1. General:**
*   Bot requires permissions for: Reading messages, sending messages, managing channels, managing roles, managing threads (if added later), reading message history, using slash commands, attaching files.
*   All interactions specific to a repository occur within its dedicated Discord channel.

**4.2. Commands:**
*   **`@<BotName> [Instruction]`**: Primary method for sending natural language instructions to `aider`. Supports multi-line messages.
*   **`/add-repo url: <string> ssh_key: <attachment>`**: (Admin Only) Adds and configures a new repository.
*   **`/add files: <string>`**: Adds one or more space-separated file paths (relative to repo root) to `aider`'s context for the current repository. Includes autocomplete based on repository files.
*   **`/files`**: Lists files currently in `aider`'s context for this repository.
*   **`/drop files: <string>`**: Removes one or more space-separated file paths from `aider`'s context. Includes autocomplete based on files currently in context.
*   **`/clear`**: Clears `aider`'s conversation history and file context for this repository.
*   **`/diff`**: Shows the changes made in the last commit pushed by the bot to the dedicated branch.
*   **`/commit`**: (Potentially redundant if auto-commit is used) Manually triggers the commit/push sequence for staged changes (if any).
*   **`/undo`**: (Requires careful implementation) Attempts to revert the last commit made by the bot on the dedicated branch.
*   **`/ls [directory: <string>]`**: Lists files in the specified directory (defaults to repo root). Includes autocomplete for the directory argument.
*   **`/tree [directory: <string>]`**: Shows the directory structure as a tree. Includes autocomplete for the directory argument.

**4.3. Autocomplete:**
*   Implement slash command autocomplete for file and directory arguments (`/add`, `/drop`, `/ls`, `/tree`).
*   The bot needs to read the repository's filesystem (as the assigned user) to provide relevant suggestions. Handle large repositories efficiently.

**4.4. Output Presentation:**
*   Short status messages and text responses: Standard Discord messages.
*   Longer text responses/generated docs: Multiple messages or formatted embeds.
*   Code blocks: Use Discord's markdown code blocks.
*   File changes (`diff`): Attach as `.diff` files.
*   File changes (`content`): Attach as files with the correct extension.
*   Errors: Formatted error messages (see Error Handling).

### 5. Data Management

**5.1. MongoDB Schemas (Conceptual):**
*   `repositories`: `{ _id, repoUrl, encryptedSshKey, assignedUserId, discordChannelId, discordReadRoleId, discordWriteRoleId, contextFiles: [string] }`
*   `message_history`: `{ _id, channelId, messageId, authorId, timestamp, content, type: 'user_instruction' | 'bot_output' }`
*   `task_queues`: `{ _id, channelId, queue: [ { userId, commandType, commandData, timestamp } ] }`

**5.2. SSH Key Handling:**
*   Master `ENCRYPTION_KEY` provided as an environment variable to the bot container.
*   Use a standard library (e.g., Node.js `crypto`) for AES encryption/decryption.
*   Encrypt key on `/add-repo`. Store encrypted key in DB.
*   Decrypt key just before needed for Git op, write to temporary file (`/repos/<repo_name>/.ssh/id_rsa`) owned by assigned user with `600` permissions.
*   Use `GIT_SSH_COMMAND="ssh -i /pathOkay, continuing the specification document:

**5.2. SSH Key Handling (Continued):**
*   Use `GIT_SSH_COMMAND="ssh -i /repos/<repo_name>/.ssh/id_rsa -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no"` when running Git commands via `sudo -u <assigned_user>`.
*   Securely delete the temporary decrypted key file immediately after the Git operation completes using `sudo -u <assigned_user> rm ...`.

**5.3. Conversation History Management:**
*   Store relevant messages (`@mention` instructions, bot's `aider` output summaries) in the `message_history` MongoDB collection.
*   Include `channelId`, `messageId`, `authorId`, `timestamp`, `content`, and `type`.
*   Before invoking the Python script, retrieve recent history from MongoDB for the channel, ordered by timestamp.
*   Format this history into a transcript suitable for `aider` (details TBD based on how the Python script/`aider` library consumes history).
*   Implement a history retention policy (e.g., max messages or max age) and a periodic cleanup job to prune old history from MongoDB.

### 6. Python Script Interface (`aider_wrapper.py`)

**6.1. Purpose:**
Acts as an intermediary between the Node.js bot and the `aider` Python library. Encapsulates the logic for setting up and running `aider.coders.Coder`.

**6.2. Invocation:**
*   Executed by the Node.js bot using `child_process.spawn` as the repository's assigned user (`sudo -u <assigned_user> python3 /path/to/aider_wrapper.py ...`).
*   The `cwd` will be the repository's workspace directory (`/repos/<repo_name>`).
*   Necessary environment variables (like `GIT_SSH_COMMAND`) will be passed.

**6.3. Input:**
*   Accept input via a combination of command-line arguments and/or JSON piped to stdin. Suggested approach:
    *   Command-line arguments for simple values: `--prompt "<user_instruction>"`, `--context-file "/path/to/file1"`, `--context-file "/path/to/file2"`.
    *   Consider passing conversation history via stdin if it's complex or long.
*   The script will receive the user's instruction/prompt and the list of files currently in `aider`'s context.

**6.4. Core Logic:**
*   Parse input arguments/stdin.
*   Initialize `aider.coders.Coder` using the provided model (configurable?), `InputOutput(yes=True)` for non-interactive mode, `fnames` for context files.
*   Run the coder with the provided prompt (`coder.run(prompt)`).
*   Capture outputs and events generated by the `Coder` execution. This may require inspecting `Coder`'s internal state or using callbacks if available.
*   Handle potential exceptions during `Coder` execution.
*   Construct the JSON output object based on the execution results.

**6.5. Output (stdout):**
*   Prints a single JSON object to stdout upon completion.
*   Uses the "Array of Typed Events" structure defined previously:

    ```json
    {
      "overall_status": "success" | "failure",
      "error": string | null,
      "events": [
        {
          "type": "status_message",
          "content": string
        },
        {
          "type": "text_response",
          "content": string // Markdown expected
        },
        {
          "type": "file_change",
          "filename": string,
          "change_type": "modified" | "added" | "deleted",
          "content": string | null, // Full new content
          "diff": string | null // Standard diff
        },
        {
          "type": "command_executed",
          "command": string
        }
        // ... other event types as needed
      ]
    }
    ```

**6.6. Error Output (stderr):**
*   Prints detailed error messages and stack traces to stderr for debugging purposes. This output is captured by the Node.js bot but *not* shown directly to users.

### 7. Error Handling

**7.1. Strategy:**
*   Implement robust error handling at all stages (Discord interaction, DB access, queue management, process spawning, script execution, output parsing).
*   Distinguish between user-facing errors and internal errors.
*   Use specific error messages where possible.
*   Log detailed internal errors for debugging.

**7.2. User Reporting:**
*   Report errors relevant to user commands in the Discord channel.
*   Use clear, concise language. Avoid technical jargon or sensitive details.
*   Example: "❌ Failed to process your request: Could not clone the repository. Please verify the URL.", "❌ Aider encountered an error. Details logged internally."

**7.3. Internal Logging:**
*   Log detailed errors, including stack traces, `stderr` from child processes, and relevant context, to the container's standard output/error (visible via `docker logs`).
*   Filter sensitive information (SSH keys, encryption keys, full paths, raw DB errors) from logs where possible, or ensure log access is restricted.

**7.4. Timeouts:**
*   Implement a configurable timeout for the Python script execution. If the script exceeds the timeout, terminate it and report a timeout error to the user.

### 8. Cleanup and Maintenance

**8.1. Temporary Files:**
*   Ensure the temporary decrypted SSH key file is always deleted immediately after the Git operation, using `finally` blocks or equivalent error-safe mechanisms.

**8.2. History Pruning:**
*   Implement a scheduled job within the bot (or a separate script) to delete old messages from the `message_history` collection based on a defined retention policy (e.g., message count or age).

**8.3. Repository Data:**
*   If a `/remove-repo` command is implemented, ensure it deletes the repository directory (`/repos/<repo_name>`) and all associated database records (repo config, history, queue entries).

**8.4. Log Rotation:**
*   If logging to files within the container, use a log rotation mechanism to prevent excessive disk usage. Standard Docker logging drivers often handle this.

### 9. Testing Plan

**9.1. Unit Tests:**
*   **Bot Logic:** Test command parsing, queue logic, state updates, message formatting, permission checks. Mock Discord API, MongoDB, and child process interactions.
*   **Python Script:** Test argument parsing, `Coder` initialization, result formatting, error handling. Mock `aider.coders.Coder` and filesystem interactions.

**9.2. Integration Tests:**
*   **Bot <-> Discord:** Test slash command registration, event handling, message sending/receiving, role/channel management (requires a test Discord server/bot token).
*   **Bot <-> MongoDB:** Test database connection, CRUD operations for all collections, queue management logic.
*   **Bot <-> Python Script:** Test spawning the script with correct arguments/environment/user, passing input, capturing and parsing JSON output, handling script errors and `stderr`.
*   **Python Script <-> `aider`:** Test that the script correctly invokes `aider` library functions and handles basic `aider` outputs/changes.
*   **Bot/Script <-> Git:** Test cloning, committing, pushing, branch creation using valid and invalid SSH keys. Requires a test Git repository.

**9.3. End-to-End Tests:**
*   Simulate full user flows from Discord:
    *   Adding a repository.
    *   Sending an `@mention` instruction.
    *   Verifying `aider` output and file changes in Discord.
    *   Verifying commit/push to the remote repository.
    *   Using file management commands (`/add`, `/files`, `/drop`, `/ls`).
    *   Handling queued requests.
    *   Handling various error conditions.

**9.4. Security Tests:**
*   Verify role permissions for commands.
*   Verify repository isolation (ensure actions in one channel/repo cannot affect another).
*   Test SSH key encryption, decryption, temporary file creation permissions, and deletion.
*   Test input validation to prevent command injection or path traversal issues.
*   Review error reporting for sensitive information leaks.

### 10. Future Considerations

*   **Discord Threads:** Re-evaluate using threads for cleaner channel organization once core functionality is stable.
*   **`/remove-repo` Command:** Implement the command to deconfigure repositories.
*   **CI Integration:** Add functionality to report test results from external CI pipelines back to Discord.
*   **Advanced Context Management:** Explore more sophisticated ways to manage `aider`'s context beyond simple file lists.
*   **Platform Support:** Test and document deployment on specific target platforms (Render, CapRover, etc.).
*   **Model Configuration:** Allow configuration of the `aider` model per repository or globally.
*   **Resource Limits:** Implement stricter resource limits (CPU, memory) for the spawned Python processes.

This specification provides a detailed blueprint for development. The next step would be to break this down into smaller implementation tasks.