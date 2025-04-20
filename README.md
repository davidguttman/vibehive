# Vibehive Discord Bot

This project is a Discord bot built with Node.js, `discord.js` v14, and Mongoose for MongoDB integration. It allows users to interact with an AI (via a Python wrapper) within specific Discord channels associated with Git repositories, managing a list of context files for the AI interactions.

## Features

*   Connects to Discord using `discord.js`.
*   Connects to MongoDB using `mongoose`.
*   Registers and handles Discord slash commands:
    *   `/ping`: Responds with "Pong!"
    *   `/add-repo <url>`: (Admin only) Associates a Git repository URL with the current channel.
    *   `/files`: Lists the files currently included in the context for the channel's associated repository.
    *   `/add <file1> [file2...]`: Adds one or more files to the context list for the channel.
    *   `/drop <file1> [file2...]`: Removes one or more files from the context list for the channel.
*   Handles bot mentions (`@Vibehive <prompt>`): Sends the prompt and context files to a Python wrapper (`aider_wrapper.py`) for AI processing and replies with the response.
*   Includes a Mongoose model (`models/Repository.js`) for storing repository URLs and context file lists per channel.
*   Provides a secure AES-256-CBC encryption/decryption module (`lib/crypto.js`) using a key from environment variables.
*   Comprehensive test suite using `tape` and `mongodb-memory-server`.
*   Uses `standard` for code style.

## Setup

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd vibehive
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    Create a `.env` file in the project root. Copy the contents of `.env.example` or create it manually. See the `.env.example` section below for required variables.

    **Important:** Ensure `.env` is included in your `.gitignore` file to prevent committing secrets.

## Running the Bot

First, deploy the slash commands:

```bash
node deploy-commands.js
```

Then, start the bot:

```bash
npm start
```

Alternatively, you can run it directly with Node:
```bash
node index.js
```

The bot will connect to Discord and MongoDB.

## Running Tests

Tests use `tape` and an in-memory MongoDB server (`mongodb-memory-server`). They do not require a real `.env` file or a running MongoDB instance.

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

## Environment Variables (`.env.example`)

The following variables are required in your `.env` file for the bot to run correctly:

```dotenv
# Discord Bot Credentials
DISCORD_BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
DISCORD_CLIENT_ID=YOUR_DISCORD_APP_CLIENT_ID_HERE

# MongoDB Connection
# Example: mongodb://user:password@host:port/database
MONGO_URI=YOUR_MONGODB_CONNECTION_STRING_HERE

# AES Encryption (MUST be 32 characters long)
ENCRYPTION_KEY=YOUR_SECURE_32_CHARACTER_ENCRYPTION_KEY_HERE
```

*   `DISCORD_BOT_TOKEN`: Your bot's secret token from the Discord Developer Portal.
*   `DISCORD_CLIENT_ID`: Your bot application's client ID.
*   `MONGO_URI`: Your MongoDB connection string.
*   `ENCRYPTION_KEY`: A secure, **32-character** string used for encrypting/decrypting sensitive data (if any future features require it - currently unused by core logic but required by `lib/crypto.js`).