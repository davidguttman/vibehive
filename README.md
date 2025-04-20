# vibehive

## My Discord Bot

A basic Discord bot built with Node.js and discord.js v14.

## Setup

1.  Clone the repository (or download the files).
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env` file in the project root with your bot token and client ID:
    ```
    DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE
    DISCORD_CLIENT_ID=YOUR_APPLICATION_CLIENT_ID_HERE
    ```
4.  (Optional) Lint the code:
    ```bash
    npm run lint
    ```

## Running the Bot

```bash
node index.js
# or
npm start
```

## Features

*   Responds "Pong!" to the `/ping` slash command.