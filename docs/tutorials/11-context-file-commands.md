# Tutorial 11: Implement Context File Management Commands

This tutorial details the implementation of slash commands (`/files`, `/add`, `/drop`) to manage context files associated with a repository in a Discord channel.

## Task

Implement slash commands for managing context files.

## Requirements

1.  **Register New Slash Commands:**
    *   `/files`: No options. Displays the current list of context files.
    *   `/add`: Requires a string option `paths` (Description: Space-separated file paths). Adds specified files to the context.
    *   `/drop`: Requires a string option `paths` (Description: Space-separated file paths). Removes specified files from the context.

2.  **Interaction Handler Logic (`events/interactionCreate.js`):**
    *   **Handle `/files`:**
        *   Find the `Repository` document using `discordChannelId: interaction.channelId`. Reply with an error if not found.
        *   Retrieve the `contextFiles` array.
        *   Format the file list (e.g., code block, numbered list) and reply. If empty, reply "No files currently in context."
    *   **Handle `/add`:**
        *   Find the `Repository` document using `discordChannelId: interaction.channelId`. Reply with an error if not found.
        *   Get the `paths` option, split by spaces, and filter out empty strings.
        *   **Validate Paths:** Reject paths starting with `/` or containing `..`. Reply with an error for invalid paths.
        *   **Update Database:** Use `Repository.updateOne({ discordChannelId: interaction.channelId }, { $addToSet: { contextFiles: { $each: validPaths } } })`.
        *   Reply confirming which files were added.
    *   **Handle `/drop`:**
        *   Find the `Repository` document using `discordChannelId: interaction.channelId`. Reply with an error if not found.
        *   Get the `paths` option and split by spaces.
        *   **Check Existence:** Filter `pathsToRemove` against `repo.contextFiles` to see if any are present.
        *   If none are present, reply immediately indicating they weren't found.
        *   If some are present, Update DB: `await Repository.updateOne({ discordChannelId: interaction.channelId }, { $pull: { contextFiles: { $in: pathsToRemove } } });`
        *   Reply confirming which files were removed, or reply that none of the specified files were found if the initial check fails.

3.  **Code Style:** Use `standard.js`. Run `standard --fix` after implementation.

## Testing (`test/contextCommands.test.js`)

1.  **Setup:**
    *   Use `tape` for tests.
    *   Utilize `mongodb-memory-server` to start an in-memory MongoDB instance **per test file** or managed carefully across files.
    *   **Database Seeding:**
        *   Use a setup block (e.g., a dedicated `test(...)` block) before command tests.
        *   Clear the relevant collection (e.g., `mongoose.connection.db.dropCollection('repositories')`) to ensure a clean state.
        *   Use `Repository.insertMany([...])` to seed necessary test documents.
        *   **Important:** Ensure seeded documents use the correct schema field names (e.g., `discordChannelId`, `repoUrl`).
    *   **Interaction Simulation:**
        *   Create a minimal `discord.js` `Client` instance within the test setup.
        *   Load the `interactionCreate.js` event handler and attach it to the client's `Events.InteractionCreate` event.
        *   Create mock `interaction` objects for each test case using a factory function.
        *   **Trigger Handler:** Use `client.emit(Events.InteractionCreate, interaction)` to run the command logic.
        *   **Mock Replies:** Override `interaction.reply` and `interaction.followUp` within a helper function (e.g., `runCommand`) that wraps `client.emit`. Use promises to wait for the reply/follow-up and resolve with its content for assertions.
    *   **Connection Management:**
        *   Avoid global `mongoose.connect()` calls in test setup blocks, as this can interfere with other test files.
        *   If a test file needs a connection (e.g., for seeding), explicitly call `connectDB()` from `lib/mongo.js` using the test file's specific `mongoServer` URI before the relevant test block.
        *   Ensure Mongoose disconnects cleanly. Use `test.onFinish(async () => { await mongoose.disconnect(); await mongoServer.stop(); })` for final cleanup, but be aware this runs after *all* tests in all files.
        *   If connection conflicts arise between test files (especially when testing DB logic itself), consider adding explicit `mongoose.disconnect()` calls *before* establishing connections within specific test blocks (as demonstrated in `test/db.test.js`).

2.  **Test Cases:**
    *   **`/files` Command:**
        *   Assert the reply contains the files seeded in the test repository.
        *   Test the "No files currently in context" message when `contextFiles` is empty.
    *   **`/add` Command:**
        *   Assert the `Repository` document in the database is updated correctly (new files added, duplicates ignored).
        *   Verify the reply message confirms the added files.
        *   Test path validation: Assert invalid paths (e.g., `/etc/passwd`, `../secret.txt`) are rejected and an error reply is sent.
    *   **`/drop` Command:**
        *   Assert the `Repository` document in the database is updated correctly (specified files removed).
        *   Verify the reply message confirms the removed files.
        *   Test dropping files that don't exist; assert the database state is unchanged and the reply **indicates the files were not found**.
    *   **Error Handling:**
        *   Test all commands fail gracefully with an appropriate error reply if no repository is configured for the channel (`discordChannelId`).

3.  **Execution:** Ensure all tests pass when running `npm test`.

## Implementation Steps (Conceptual)

1.  **Command Registration (`deploy-commands.js`):**
    *   Add definitions for `/files`, `/add`, and `/drop` to the commands array.
    *   Include the required `paths` option for `/add` and `/drop`.
    *   Run the script to register/update the commands with Discord.

2.  **Interaction Handling (`events/interactionCreate.js`):**
    *   Ensure the handler is correctly loaded and attached to the client in `index.js` (dynamic loading recommended).
    *   **Common Logic:** Inside each command handler, first attempt to find the `Repository` based on `discordChannelId: interaction.channelId`. If not found, reply and return.
    *   **`/files` Logic:** Retrieve `repo.contextFiles`. Format and send the reply. Handle the empty case.
    *   **`/add` Logic:**
        *   Get and filter paths.
        *   Validate paths.
        *   Update DB: `await Repository.updateOne({ discordChannelId: interaction.channelId }, { $addToSet: { contextFiles: { $each: validPaths } } });`
        *   Send confirmation reply.
    *   **`/drop` Logic:**
        *   Get and filter paths.
        *   **Check Existence:** Filter `pathsToRemove` against `repo.contextFiles` to see if any are present.
        *   If none are present, reply immediately indicating they weren't found.
        *   If some are present, Update DB: `await Repository.updateOne({ discordChannelId: interaction.channelId }, { $pull: { contextFiles: { $in: pathsToRemove } } });`
        *   Send confirmation reply based on the update result (`modifiedCount`).

3.  **Testing (`test/contextCommands.test.js`):**
    *   Implement the test setup strategy described above (client emission, careful seeding, connection management).
    *   Write test cases covering success scenarios, edge cases (no files, invalid paths, file not found), and error handling (no repo configured).

Remember to run `standard --fix` on your code files after making changes. 