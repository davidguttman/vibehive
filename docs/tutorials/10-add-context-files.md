# Tutorial 10: Add Context Files to Schema

Task: Add the `contextFiles` field to the Repository schema.
Requirements:
1.  Modify `models/Repository.js` (from Prompt 3).
2.  Add a new field to the `repositorySchema`:
    -   `contextFiles`: { type: [String], default: [] }
3.  Ensure existing model usage is not broken (Mongoose should handle the default).
4.  Use standard.js style. Run `standard --fix`.
Testing:
-   Modify `test/repository.model.test.js` (from Prompt 3).
-   Test creating a new repository document. Assert that `contextFiles` exists and is an empty array by default.
-   Test updating an existing document to add file paths to `contextFiles`. Assert the update is successful.
-   Ensure tests run via `npm test`. 