const test = require('ava')
// DO NOT RELY ON process.env.ENCRYPTION_KEY IN TESTS
// Instead, pass the key directly to the functions.
const crypto = require('../lib/crypto')

// Use a consistent, valid key for testing
const TEST_KEY = 'a_dummy_32_character_key_1234567'

test.serial('Crypto Module - Encryption/Decryption Round Trip', (t) => {
  const originalText = 'This is a secret message.'
  // Pass the test key explicitly
  const encryptedText = crypto.encrypt(originalText, TEST_KEY)

  t.truthy(typeof encryptedText === 'string' && encryptedText.includes(':'), 'Encrypt should return a string containing a colon')

  // Pass the test key explicitly
  const decryptedText = crypto.decrypt(encryptedText, TEST_KEY)

  t.is(decryptedText, originalText, 'Decrypted text should match original text')
})

test.serial('Crypto Module - Decrypt Invalid Input', (t) => {
  const invalidInput = 'this:is:not:valid:hex'
  // Pass the test key explicitly
  const decrypted = crypto.decrypt(invalidInput, TEST_KEY)

  t.is(decrypted, null, 'Decrypt should return null for invalid input format')

  const shortInput = 'abc:123' // Invalid hex and structure
  // Pass the test key explicitly
  const decryptedShort = crypto.decrypt(shortInput, TEST_KEY)
  t.is(decryptedShort, null, 'Decrypt should return null for input causing crypto errors')

  // Test with incorrect key (simulated)
  const originalText = 'Another secret'
  const encryptedWithGoodKey = crypto.encrypt(originalText, TEST_KEY)
  const wrongKey = '12345678901234567890123456789012' // A *different* valid 32-char key
  const decryptedWithWrongKey = crypto.decrypt(encryptedWithGoodKey, wrongKey)
  // Decryption with the wrong key should fail and return null (or throw, but we return null)
  t.is(decryptedWithWrongKey, null, 'Decrypt should return null when using the wrong key')

  // Test with invalid IV length in format
  const invalidIvFormat = 'deadbeef:deadbeefdeadbeef' // IV hex too short
  const decryptedInvalidIv = crypto.decrypt(invalidIvFormat, TEST_KEY)
  t.is(decryptedInvalidIv, null, 'Decrypt should return null for invalid IV length')
})

test.serial('Crypto Module - Encrypt/Decrypt with Different Valid Keys', (t) => {
  const key1 = '12345678901234567890123456789012'
  const key2 = 'abcdefghijklmnopqrstuvwxyz123456'
  const text = 'Test with multiple keys'

  const encrypted1 = crypto.encrypt(text, key1)
  const decrypted1 = crypto.decrypt(encrypted1, key1)
  t.is(decrypted1, text, 'Should decrypt correctly with key 1')

  const encrypted2 = crypto.encrypt(text, key2)
  const decrypted2 = crypto.decrypt(encrypted2, key2)
  t.is(decrypted2, text, 'Should decrypt correctly with key 2')

  // Try decrypting with the wrong key
  const decrypted1WithKey2 = crypto.decrypt(encrypted1, key2)
  t.is(decrypted1WithKey2, null, 'Should fail to decrypt with the wrong key')

  const decrypted2WithKey1 = crypto.decrypt(encrypted2, key1)
  t.is(decrypted2WithKey1, null, 'Should fail to decrypt with the wrong key')
})

// Note: Testing the initial require() throw for missing ENV_KEY is tricky
// without running in a separate process or using tools like proxyquire.
// The module throws upon loading if ENV_KEY is bad/missing.
