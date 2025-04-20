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
        *   Find the `Repository` document using `interaction.channelId`. Reply with an error if not found.
        *   Retrieve the `contextFiles` array.
        *   Format the file list (e.g., code block, numbered list) and reply. If empty, reply "No files currently in context."
    *   **Handle `/add`:**
        *   Find the `Repository` document using `interaction.channelId`. Reply with an error if not found.
        *   Get the `paths` option, split by spaces, and filter out empty strings.
        *   **Validate Paths:** Reject paths starting with `/` or containing `..`. Reply with an error for invalid paths.
        *   **Update Database:** Use MongoDB's `$addToSet` with `$each` to add valid, unique paths to the `contextFiles` array.
        *   Reply confirming which files were added.
    *   **Handle `/drop`:**
        *   Find the `Repository` document using `interaction.channelId`. Reply with an error if not found.
        *   Get the `paths` option and split by spaces.
        *   **Update Database:** Use MongoDB's `$pull` with `$in` to remove specified paths from the `contextFiles` array.
        *   Reply confirming which files were removed (or mention if they weren't in the list).

3.  **Code Style:** Use `standard.js`. Run `standard --fix` after implementation.

## Testing (`test/contextCommands.test.js`)

1.  **Setup:**
    *   Use `tape` for tests.
    *   Utilize an in-memory MongoDB instance (e.g., `mongodb-memory-server`).
    *   Seed the database with a test `Repository` document before tests.
    *   Mock the `interaction` object for each command scenario, including `interaction.reply`.

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
        *   Test dropping files that don't exist; assert the database state is unchanged and the reply indicates this.
    *   **Error Handling:**
        *   Test all commands fail gracefully with an appropriate error reply if no repository is configured for `interaction.channelId`.

3.  **Execution:** Ensure all tests pass when running `npm test`.

## Implementation Steps (Conceptual)

1.  **Command Registration (`deploy-commands.js`):**
    *   Add definitions for `/files`, `/add`, and `/drop` to the commands array.
    *   Include the required `paths` option for `/add` and `/drop`.
    *   Run the script to register/update the commands with Discord.

2.  **Interaction Handling (`events/interactionCreate.js`):**
    *   Add `if/else if` blocks or a switch statement within the `interactionCreate` event handler to check `interaction.commandName`.
    *   **Common Logic:** Inside each command handler, first attempt to find the `Repository` based on `interaction.channelId`. If not found, call `interaction.reply({ content: 'No repository configured for this channel.', ephemeral: true });` and return.
    *   **`/files` Logic:** Retrieve `repo.contextFiles`. Format and send the reply using `interaction.reply`. Handle the empty case.
    *   **`/add` Logic:**
        *   Get paths: `const paths = interaction.options.getString('paths').split(' ').filter(p => p);`
        *   Validate paths: Loop through `paths`, check for invalid patterns (`startsWith('/')`, `includes('..')`). If invalid, reply with an error and return.
        *   Update DB: `await Repository.updateOne({ channelId: interaction.channelId }, { $addToSet: { contextFiles: { $each: validPaths } } });`
        *   Send confirmation reply.
    *   **`/drop` Logic:**
        *   Get paths: `const pathsToRemove = interaction.options.getString('paths').split(' ').filter(p => p);`
        *   Update DB: `const updateResult = await Repository.updateOne({ channelId: interaction.channelId }, { $pull: { contextFiles: { $in: pathsToRemove } } });`
        *   Send confirmation reply, potentially indicating how many were actually removed based on `updateResult.modifiedCount` (though `$pull` doesn't easily tell *which* were removed if some didn't exist). A simpler confirmation is usually sufficient.

3.  **Testing (`test/contextCommands.test.js`):**
    *   Follow the testing requirements outlined above, mocking dependencies and asserting database state and replies.

Remember to run `standard --fix` on your code files after making changes. 