# Tutorial 13: AES Encryption/Decryption Module

This tutorial guides you through creating a Node.js module for symmetric AES encryption and decryption using the built-in `crypto` module.

## Goal

Implement a reusable module `lib/crypto.js` that can encrypt and decrypt strings using AES-256-CBC, with the master key managed via an environment variable. Include tests to verify its functionality and error handling.

## Steps

### 1. Create the Crypto Module File

Create a new file for our encryption logic:

```bash
touch lib/crypto.js
```

### 2. Require Dependencies and Check Environment Variable

In `lib/crypto.js`, require the `crypto` module and immediately check for the `ENCRYPTION_KEY` environment variable. Ensure it exists and meets the length requirement (32 bytes for AES-256).

```javascript
// lib/crypto.js
const crypto = require('node:crypto')

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY // Must be 256 bits (32 characters)
const IV_LENGTH = 16 // For AES, this is always 16

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
  throw new Error('Missing or invalid ENCRYPTION_KEY environment variable. It must be 32 characters long.')
}

// ... rest of the module ...
```

### 3. Implement the `encrypt` Function

Add the `encrypt` function. This function will:
- Generate a random Initialization Vector (IV).
- Create an AES-256-CBC cipher using the key and IV.
- Encrypt the input text.
- Return the IV and encrypted text concatenated, separated by a colon, both in hex format.

```javascript
// lib/crypto.js
// ... (require and key check from step 2) ...

function encrypt (text) {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv)
  let encrypted = cipher.update(text)

  encrypted = Buffer.concat([encrypted, cipher.final()])

  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

// ... rest of the module ...
```

### 4. Implement the `decrypt` Function

Add the `decrypt` function. This function will:
- Take the IV:encryptedText string.
- Split it to retrieve the IV and the encrypted text.
- Convert both from hex back to buffers.
- Create an AES-256-CBC decipher using the key and retrieved IV.
- Decrypt the text.
- Return the original string.
- Include error handling for invalid input formats.

```javascript
// lib/crypto.js
// ... (require, key check, encrypt function) ...

function decrypt (text) {
  try {
    const textParts = text.split(':')
    const iv = Buffer.from(textParts.shift(), 'hex')
    const encryptedText = Buffer.from(textParts.join(':'), 'hex')
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv)
    let decrypted = decipher.update(encryptedText)

    decrypted = Buffer.concat([decrypted, decipher.final()])

    return decrypted.toString()
  } catch (error) {
    console.error('Decryption failed:', error)
    // Return null or throw a specific error based on desired handling
    return null
  }
}

// ... rest of the module ...
```

### 5. Export Functions

Export the `encrypt` and `decrypt` functions.

```javascript
// lib/crypto.js
// ... (all previous code) ...

module.exports = { encrypt, decrypt }
```

### 6. Create Test File

Create a test file using `tape`:

```bash
touch test/crypto.test.js
```

### 7. Write Tests

In `test/crypto.test.js`, write tests covering:
- Basic encryption and decryption round trip.
- Decryption with invalid input.
- The initial environment variable check (this requires running a separate process or carefully managing module loading).

**Note:** For the environment variable check test, you might need a helper script or use a library like `proxyquire` to control the environment variable *before* the module is required. For simplicity, we'll focus on the functional tests here.

```javascript
// test/crypto.test.js
const test = require('tape')
// Set a dummy key *before* requiring the module
process.env.ENCRYPTION_KEY = 'a_dummy_32_character_key_123456'
const { encrypt, decrypt } = require('../lib/crypto') // Now require the module

test('Crypto Module - Encryption/Decryption Round Trip', (t) => {
  const originalText = 'This is a secret message.'
  const encryptedText = encrypt(originalText)

  t.ok(typeof encryptedText === 'string' && encryptedText.includes(':'), 'Encrypt should return a string containing a colon')

  const decryptedText = decrypt(encryptedText)

  t.equal(decryptedText, originalText, 'Decrypted text should match original text')
  t.end()
})

test('Crypto Module - Decrypt Invalid Input', (t) => {
  const invalidInput = 'this:is:not:valid:hex'
  const decrypted = decrypt(invalidInput)

  t.equal(decrypted, null, 'Decrypt should return null for invalid input format')

  const shortInput = 'abc:123'
  const decryptedShort = decrypt(shortInput)
  t.equal(decryptedShort, null, 'Decrypt should return null for input causing crypto errors')

  t.end()
})

// Optional: Test for missing/invalid key (requires more setup)
test.skip('Crypto Module - Startup Key Check (Manual/Advanced)', (t) => {
  // This test is harder to automate within the same process
  // because the check happens on require().
  // You'd typically run a separate node process with an invalid/missing key
  // and assert that it throws an error.
  // e.g., node -e "try { require('./lib/crypto') } catch (e) { process.exit(0) } process.exit(1)"
  t.pass('Skipping startup key check test (requires separate process execution)')
  t.end()
})

```

### 8. Update `package.json` (if needed)

Ensure `tape` is a development dependency:

```bash
npm install --save-dev tape
```

Add or ensure your `test` script in `package.json` runs tape:

```json
// package.json
{
  // ... other properties
  "scripts": {
    "test": "tape test/**/*.test.js",
    // ... other scripts
  }
}
```

### 9. Run `standard --fix`

Apply standard.js formatting:

```bash
npx standard --fix
```

### 10. Run Tests

Execute the tests to ensure everything works as expected:

```bash
npm test
```

You should see your tests passing. This confirms your AES encryption/decryption module is working correctly. 