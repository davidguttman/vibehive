# Tutorial 13a: Codebase Inspection and Cleanup

This tutorial covers essential steps to ensure the codebase is clean, documented, and easy for others (and your future self) to understand and run.

## Goal

Perform a quick inspection and cleanup pass over the codebase, focusing on:
1.  Removing `t.plan()` from test files.
2.  Updating the main `README.md`.
3.  Ensuring `.env.example` reflects required production variables.

## Steps

### 1. Remove `t.plan()` from Test Files

**Why?** We've decided against using `t.plan()` in our `tape` tests to avoid the brittleness of specifying the exact number of assertions upfront.

**How?**

*   **Identify files:** Find all test files that might contain `t.plan()`.
    ```bash
    # Use grep to find files containing t.plan(
    grep -l 't\.plan(' test/**/*.test.js
    ```
*   **Remove the lines:** Manually edit each file identified by the `grep` command and delete any lines containing `t.plan(...)`.
    *   *Example:* If `test/some.test.js` contains `t.plan(3)`, delete that entire line.

### 2. Update `README.md`

**Why?** The `README.md` is the entry point for understanding the project. It should accurately reflect the current features, setup, and usage.

**How?**

*   **Review Current README:** Read the existing `README.md` file.
*   **Update Sections:** Ensure the following information is present and up-to-date:
    *   **Project Purpose:** A brief description of what Vibehive does.
    *   **Features:** List the main capabilities (e.g., Discord bot, `/add-repo`, `/files`, `/add`, `/drop` commands, AI interaction via mentions, AES encryption via `lib/crypto.js`).
    *   **Setup:** Instructions on cloning, installing dependencies (`npm install`).
    *   **Configuration:** Explain the need for a `.env` file and list the required environment variables (see next step).
    *   **Running the Bot:** How to start the bot (`npm start`, mention deployment if applicable).
    *   **Running Tests:** How to run the test suite (`npm test`).
*   **Add Crypto Info:** Specifically mention the new `lib/crypto.js` module and its reliance on the `ENCRYPTION_KEY` environment variable.

### 3. Update/Create `.env.example`

**Why?** The `.env.example` file serves as a template, showing users exactly which environment variables are required to run the application in production.

**How?**

*   **Identify Required Variables:** Based on our code (`index.js`, `config.js`, `lib/crypto.js`), the required variables are:
    *   `DISCORD_BOT_TOKEN`: For the Discord bot to log in.
    *   `DISCORD_CLIENT_ID`: For registering slash commands.
    *   `MONGO_URI`: The connection string for the MongoDB database.
    *   `ENCRYPTION_KEY`: The 32-character key for AES encryption/decryption.
*   **Create/Update the File:** Ensure the `.env.example` file exists and contains the following structure, with placeholder values:

    ```dotenv
    # .env.example

    # Discord Bot Credentials
    DISCORD_BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
    DISCORD_CLIENT_ID=YOUR_DISCORD_APP_CLIENT_ID_HERE

    # MongoDB Connection
    # Example: mongodb://user:password@host:port/database
    MONGO_URI=YOUR_MONGODB_CONNECTION_STRING_HERE

    # AES Encryption (MUST be 32 characters long)
    ENCRYPTION_KEY=YOUR_SECURE_32_CHARACTER_ENCRYPTION_KEY_HERE
    ```

Completing these steps ensures the project is more maintainable and easier to set up. 