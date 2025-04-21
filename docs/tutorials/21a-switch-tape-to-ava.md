# Tutorial 21a: Switch Test Runner from Tape to Ava (Incremental)

This tutorial guides you through replacing the `tape` test runner with `Ava` incrementally. Ava offers several advantages, including potentially running tests concurrently (faster execution), simpler async handling, built-in support for modern JavaScript features (like `async`/`await`), and more informative assertion messages. This guide focuses on a safe, step-by-step migration.

**Goal:** Replace `tape` with `Ava` across the entire test suite, update `package.json`, verify each converted test behaves identically, and ensure all tests pass using the new runner within the project's Docker container environment before removing the old `tape` setup.

## Prerequisites

*   Completion of previous tutorials, particularly those involving setting up tests (`test/` directory) and the Docker environment.
*   A working Docker environment (`docker` or `docker compose`) configured to run the application.
*   **Crucially: All development, installation, and testing commands (`npm install`, `npm uninstall`, `npm test`) MUST be executed *inside* the running Docker container** (e.g., via `docker exec` or `docker compose run`).

## Step 1: Update Dependencies

First, we need to install `ava` as a development dependency. **Do not remove `tape` yet.**

**Run these commands INSIDE your Docker container:**

```bash
# Navigate to your app's directory inside the container
# cd /path/to/your/app

npm install --save-dev ava
# npm uninstall tape <<< We will do this later!
```

This updates your `package.json` and `package-lock.json`, adding `ava` alongside `tape`.

## Step 2: Create a Directory for Old Tape Tests

To safely migrate, we'll keep the original tape tests around for comparison.

**Run these commands INSIDE your Docker container:**

```bash
# Navigate to your app's directory inside the container
# cd /path/to/your/app

# Create a new directory for the tape tests
mkdir tape-test

# Move all existing test files into it
# Adjust the glob pattern if your tests have different names/locations
mv test/**/*.test.js tape-test/
```

## Step 3: Update `package.json` Test Scripts

Open your `package.json` file. Locate the `"scripts"` section.

1.  Modify the existing `"test"` script to use `ava`.
2.  Add a *new* script, `"test:tape"`, to run the original tape tests from their new location.

It should look something like this:

```json
// package.json (snippet)
  "scripts": {
    "test": "ava", // Changed from tape to ava
    "test:tape": "tape tape-test/**/*.test.js", // Added to run old tests
    // ... other scripts
  },
```

This allows you to run the new Ava tests with `npm test` and the original Tape tests with `npm run test:tape`.

## Step 4: Convert Test Files Incrementally (One by One)

Now, we'll convert each test file individually, ensuring the Ava version behaves exactly like the Tape version before moving on.

**For *each* file in `tape-test/`:**

1.  **Copy:** Copy the file from `tape-test/` to `test/`.
    ```bash
    # Inside the container, e.g., for tape-test/crypto.test.js
    cp tape-test/crypto.test.js test/crypto.test.js
    ```
2.  **Convert:** Modify the *copied* file (`test/crypto.test.js` in this example) to use Ava syntax. **Focus on a direct, 1:1 conversion:**
    *   **Replace `require('tape')`:** Change `const test = require('tape')` to `const test = require('ava')`.
    *   **Make Tests Serial:** Change `test(...)` to `test.serial(...)` for *every* test case. This prevents concurrency initially, mimicking Tape's behavior and avoiding potential race conditions introduced by Ava's parallel execution. We can optimize later.
        ```diff
        - test('my test', t => { ... });
        + test.serial('my test', t => { ... });
        ```
    *   **Remove `t.plan()`:** Ava doesn't require planning assertions. Delete `t.plan(n)` calls.
    *   **Remove `t.end()`:** Ava automatically handles the end of synchronous tests and tests using `async`/`await` or returning Promises. Remove `t.end()` calls in these cases.
        *   **Exception:** If the original test used callbacks *without* `t.plan` and relied on `t.end` to signal completion, you *might* need `test.cb.serial` in Ava, which *does* require `t.end()`. Try without it first.
    *   **Update Assertions (Minimal Changes):** Use the closest Ava equivalents. **Avoid** introducing more complex Ava features like snapshot testing or fancy assertion options for now.
        *   `t.equal(a, b)` -> `t.is(a, b)` (for primitives)
        *   `t.deepEqual(a, b)` -> `t.deepEqual(a, b)` (remains the same)
        *   `t.ok(value)` -> `t.truthy(value)`
        *   `t.notOk(value)` -> `t.falsy(value)`
        *   `t.error(err)` -> `t.ifError(err)` (checks for falsy error)
        *   `t.throws(fn, ...)` -> `t.throws(fn, ...)` (syntax is similar)
        *   `t.doesNotThrow(fn, ...)` -> `t.notThrows(fn, ...)`
        *   `t.pass(...)` -> `t.pass(...)`
        *   `t.fail(...)` -> `t.fail(...)`
        *   Consult Ava docs if needed, but prefer simple equivalents.
    *   **Handle Async:**
        *   If the original test used `async`/`await`, just ensure the Ava test function is also `async`.
        *   If it used Promises, ensure the Ava test function `return`s the promise chain.
        *   If it used callbacks (and you don't need `test.cb.serial`), convert it to use `async`/`await` or Promises if straightforward. If not, stick to `test.cb.serial` and keep `t.end()`.
    *   **Avoid Hooks:** **Do not** convert setup/teardown logic to `test.before`/`test.after` hooks *yet*. Keep the setup/teardown within each `test.serial(...)` block for now to maintain the 1:1 mapping with the original Tape test.

3.  **Verify:** Run *both* the original Tape test and the new Ava test and compare their output. You might want to use TAP output for Tape for easier comparison.
    ```bash
    # Inside the container
    # Run the original tape test (using TAP reporter)
    npm run test:tape -- tape-test/crypto.test.js --tap

    # Run the new ava test
    npm test -- test/crypto.test.js
    ```
    *   Examine the output closely. Do they report the same number of passing assertions? Do they fail on the same conditions? Address any discrepancies in the Ava version (`test/crypto.test.js`) until it behaves identically to the Tape version (`tape-test/crypto.test.js`).

4.  **Repeat:** Once the converted test in `test/` passes and behaves like its counterpart in `tape-test/`, move on to the next file in `tape-test/`.

**Example Conversion (`test/crypto.test.js` - 1:1 focus):**

Original `tape-test/crypto.test.js`:
```javascript
// tape-test/crypto.test.js (using tape)
const test = require('tape');
const { encrypt, decrypt } = require('../lib/crypto');

test('Encryption/Decryption Test', t => {
  t.plan(3);
  process.env.ENCRYPTION_KEY = 'a_very_secret_key_32_chars_long';
  const originalText = 'my secret data';

  const encryptedText = encrypt(originalText);
  t.ok(encryptedText, 'Encryption should produce output');
  t.notEqual(encryptedText, originalText, 'Encrypted text should differ');

  const decryptedText = decrypt(encryptedText);
  t.equal(decryptedText, originalText, 'Decryption should restore original text');

  delete process.env.ENCRYPTION_KEY;
  // t.end(); // Not strictly needed with t.plan
});
```

Converted `test/crypto.test.js` (using Ava, minimal change):
```javascript
// test/crypto.test.js (using ava.serial)
const test = require('ava');
const { encrypt, decrypt } = require('../lib/crypto');

// Use test.serial for 1:1 conversion
test.serial('Encryption/Decryption Test', t => {
  // No t.plan() needed
  process.env.ENCRYPTION_KEY = 'a_very_secret_key_32_chars_long'; // Setup inside test
  const originalText = 'my secret data';

  const encryptedText = encrypt(originalText);
  t.truthy(encryptedText, 'Encryption should produce output'); // Use t.truthy
  // Note: tape's t.notEqual is like ava's t.notDeepEqual for objects/arrays
  // For primitives, t.not is correct. Assume original meant primitives/strings here.
  t.not(encryptedText, originalText, 'Encrypted text should differ');

  const decryptedText = decrypt(encryptedText);
  t.is(decryptedText, originalText, 'Decryption should restore original text'); // Use t.is

  delete process.env.ENCRYPTION_KEY; // Teardown inside test
  // No t.end() needed
});

// Add more tests as needed, using test.serial(...)
```

**Apply this copy-convert-verify process systematically to all files.**

## Step 5: Final Run and Linting (Inside Docker)

After converting and verifying *all* test files:

1.  Run the full Ava suite to ensure everything passes together.
```bash
    # Inside the container
npm test
```
    Address any remaining failures. If tests fail when run together but passed individually, it might indicate state leakage between tests, which `test.serial` should have minimized but might still occur.
2.  Run the linter/formatter on the new tests.
```bash
# Inside the container
    # Update path/command for standard if needed
npx standard --fix test/**/*.test.js
```

## Step 6: Cleanup

Once you are confident that all tests in `test/` (using Ava) are correct and passing reliably:

1.  **Remove the old tape tests:**
    ```bash
    # Inside the container
    rm -rf tape-test/
    ```
2.  **Uninstall tape:**
    ```bash
    # Inside the container
    npm uninstall tape
    ```
3.  **Remove the tape script:** Edit `package.json` and remove the `"test:tape"` line from the `"scripts"` section.

```json
// package.json (snippet)
  "scripts": {
    "test": "ava",
    // "test:tape": "tape tape-test/**/*.test.js", // <<< Remove this line
    // ... other scripts
  },
```

Save `package.json`. Your `package-lock.json` will be updated when you run `npm install` next or by explicitly running `npm install` now.

This completes the incremental migration from `tape` to `Ava`. You now have a working test suite using Ava. You can explore further Ava features like parallel execution (by removing `.serial`), hooks (`before`/`after`), or more advanced assertions in subsequent steps if desired. 