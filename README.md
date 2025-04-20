# Vibehive Discord Bot

This project contains a Discord bot built with Node.js, `discord.js` v14, and Mongoose for MongoDB integration.

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
    Create a `.env` file in the project root. Copy the contents of `.env.example` (if it exists) or create it with the following variables:
    ```dotenv
    # Discord Bot Credentials
    DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
    DISCORD_CLIENT_ID=YOUR_DISCORD_APP_CLIENT_ID_HERE

    # MongoDB Connection
    MONGODB_URI=YOUR_MONGODB_CONNECTION_STRING_HERE
    MONGODB_DB_NAME=your_preferred_database_name
    ```
    Replace the placeholder values with your actual Discord bot token, client ID, MongoDB connection string (e.g., from MongoDB Atlas or a local instance), and desired database name.
    
    **Important:** Ensure `.env` is included in your `.gitignore` file to prevent committing secrets.

## Running the Bot

```bash
npm start
```

Alternatively, you can run it directly with Node:
```bash
node index.js
```

The bot will connect to Discord and MongoDB.

## Running Tests

Tests use Tape and an in-memory MongoDB server (`mongodb-memory-server`). They do not require a real `.env` file to run.

```bash
npm test
```

## Linting

This project uses StandardJS style. To check and automatically fix linting issues:

```bash
npm run lint
```

## Current Features

*   Connects to Discord using credentials from `.env`.
*   Connects to MongoDB using Mongoose based on the URI in `.env`.
*   Registers and responds "Pong!" to the `/ping` slash command.
*   Includes a Mongoose model (`models/Repository.js`) for storing repository data (although not yet used by any commands).
*   Provides a test suite covering basic command handling, database connection, and model validation.