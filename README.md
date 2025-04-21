# Vibehive Discord Bot

This project is a Discord bot built with Node.js, `discord.js` v14, and Mongoose for MongoDB integration. It allows users to interact with an AI (via a Python wrapper, `aider_wrapper.py`) within specific Discord channels associated with Git repositories. The bot securely manages SSH keys for repositories requiring them and includes context files in AI interactions. The entire application is containerized using Docker.

## Features

*   Connects to Discord using `discord.js`.
*   Connects to MongoDB using `mongoose`.
*   Registers and handles Discord slash commands:
    *   `/ping`: Responds with "Pong!"
    *   `/add-repo <url> <ssh_key>`: (Admin only) Associates a Git repository URL with the current channel and securely stores an uploaded SSH private key (encrypted) for accessing the repository.
    *   `/files`: Lists the files currently included in the context for the channel's associated repository.
    *   `/add <file1> [file2...]`: Adds one or more files to the context list for the channel.
    *   `/drop <file1> [file2...]`: Removes one or more files from the context list for the channel.
*   Handles bot mentions (`@Vibehive <prompt>`):
    *   Retrieves the repository configuration for the channel.
    *   If an encrypted SSH key is stored, decrypts it and writes it to a temporary, secure file (`0o600` permissions).
    *   Invokes a Python wrapper (`aider_wrapper.py`) with the prompt, context files, and sets `GIT_SSH_COMMAND` to use the temporary key if applicable.
    *   Securely deletes the temporary key file after the wrapper script finishes.
    *   Parses the JSON response from the wrapper and replies to the user in Discord.
*   Includes a Mongoose model (`models/Repository.js`) for storing repository URLs, context file lists, and encrypted SSH keys per channel.
*   Provides a secure AES-256-CBC encryption/decryption module (`lib/crypto.js`) for SSH keys using a key from environment variables.
*   Provides secure temporary SSH key file handling (`lib/secureKeys.js`) ensuring correct permissions and cleanup.
*   Comprehensive test suite using `tape` and `mongodb-memory-server`.
*   Uses `standard` for code style.
*   **Dockerized:** Includes a multi-stage `Dockerfile` for building a production-ready image.
    *   Build stage installs dependencies, runs linters and tests (`npm test`).
    *   Production stage copies only necessary artifacts and production dependencies.
    *   Sets up a non-root user (`appuser`) to run the application.
    *   Configures specific `sudo` permissions for `appuser` to run necessary commands (like `git`, `python3`) as separate `coderX` users within isolated directories (`/repos/coderX`).

## Setup

### Prerequisites

*   Docker & Docker Compose (Recommended) or Node.js v18+ and npm
*   Git

### Option 1: Running with Docker (Recommended)

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd vibehive
    ```
2.  **Configure Environment Variables:**
    Create a `.env` file in the project root. Copy the contents of `.env.example` and fill in your actual credentials and keys.
    ```bash
    cp .env.example .env
    # Edit .env with your values
    ```
    **Important:** Ensure `.env` is included in your `.gitignore` file.

3.  **Build the Docker Image:**
    ```bash
    docker build -t vibehive .
    ```
    *(Note: The build process runs `npm install`, `pip install`, and `npm test`. Ensure tests pass for the build to succeed.)*

4.  **Run the Container:**
    Use the built image. Ensure the `.env` file is passed to the container.
    ```bash
    docker run --rm --env-file .env --name vibehive-bot -d vibehive
    ```
    *   `--rm`: Automatically remove the container when it stops.
    *   `--env-file .env`: Loads environment variables from your `.env` file.
    *   `--name vibehive-bot`: Assigns a name to the container.
    *   `-d`: Runs the container in detached mode (in the background).

5.  **Deploy Slash Commands (If not done before/on update):**
    You might need to run the deployment script within the container if commands change.
    ```bash
    docker exec vibehive-bot node deploy-commands.js
    ```

6.  **View Logs:**
    ```bash
    docker logs -f vibehive-bot
    ```

7.  **Stop the Container:**
    ```bash
    docker stop vibehive-bot
    ```

### Option 2: Running Natively (Requires Node.js, npm, Python3)

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd vibehive
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    # Install Python dependencies (if aider_wrapper.py has any)
    pip install -r requirements.txt
    ```

3.  **Configure Environment Variables:**
    Create and populate the `.env` file as described in the Docker setup.

4.  **Deploy Slash Commands:**
    ```bash
    node deploy-commands.js
    ```

5.  **Start the Bot:**
    ```bash
    npm start
    ```
    Alternatively:
    ```bash
    node index.js
    ```

## Running Tests

Tests use `tape` and an in-memory MongoDB server (`mongodb-memory-server`). They do not require a real `.env` file or a running MongoDB instance. They are also run during the Docker build.

```bash
npm test
```

## Linting

This project uses StandardJS style. To check and automatically fix linting issues:

```bash
npm run lint
# or
npx standard --fix
```

## Docker Environment Testing

A script is provided to test the user, group, permissions, and `sudo` setup within the built Docker image:

```bash
bash test/test-docker-setup.sh
```
This script runs a temporary container and performs checks inside it.

## Environment Variables (`.env.example`)

The following variables are required in your `.env` file:

```dotenv
# Discord Bot Credentials
DISCORD_BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
DISCORD_CLIENT_ID=YOUR_DISCORD_APP_CLIENT_ID_HERE

# MongoDB Connection
# Example: mongodb://user:password@host:port/database
MONGO_URI=YOUR_MONGODB_CONNECTION_STRING_HERE

# AES Encryption (MUST be 32 characters long)
ENCRYPTION_KEY=YOUR_SECURE_32_CHARACTER_ENCRYPTION_KEY_HERE

# Base directory for coder repos inside the container (Optional, defaults to /repos)
# REPO_BASE_DIR=/repos
```

*   `DISCORD_BOT_TOKEN`: Your bot's secret token from the Discord Developer Portal.
*   `DISCORD_CLIENT_ID`: Your bot application's client ID.
*   `MONGO_URI`: Your MongoDB connection string.
*   `ENCRYPTION_KEY`: A secure, **32-character** string used for encrypting/decrypting SSH keys.
*   `REPO_BASE_DIR`: (Optional) Defines the base directory inside the container where `coderX` home directories are created. Defaults to `/repos` if not set. Used by `lib/secureKeys.js`.

## Security Considerations

*   **SSH Key Handling:** Private SSH keys are encrypted at rest using AES-256 with a key derived from `ENCRYPTION_KEY`. They are only decrypted in memory, written to a temporary file with strict permissions (`0o600`) just before use, and deleted immediately after. Ensure the `ENCRYPTION_KEY` is kept secret and strong.
*   **Docker Permissions:** The application runs as a non-root user (`appuser`). Specific commands requiring elevated privileges or needing to run as different users (`coderX`) are handled via `sudo` with a tightly controlled list of allowed commands defined in the `Dockerfile`.
*   **Environment Variables:** Never commit your `.env` file to version control. Use environment variable injection or secrets management tools in production deployments.