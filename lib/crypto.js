const crypto = require('node:crypto')

const IV_LENGTH = 16 // For AES, this is always 16

// Function to get the key, checking env var only if needed
function getKey (providedKey) {
  const key = providedKey || process.env.ENCRYPTION_KEY
  if (!key || key.length !== 32) {
    if (!providedKey) {
      // Only throw if the key wasn't explicitly provided (i.e., we relied on env)
      throw new Error('Missing or invalid ENCRYPTION_KEY environment variable. It must be 32 characters long.')
    } else {
      // Throw if an invalid key was explicitly passed
      throw new Error('Invalid encryption key provided. It must be 32 characters long.')
    }
  }
  return key
}

function encrypt (text, providedKey) {
  const key = getKey(providedKey)
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv)
  let encrypted = cipher.update(text)

  encrypted = Buffer.concat([encrypted, cipher.final()])

  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

function decrypt (text, providedKey) {
  const key = getKey(providedKey)
  try {
    if (typeof text !== 'string') {
      throw new Error('Input must be a string.')
    }
    const textParts = text.split(':')
    if (textParts.length !== 2) {
      throw new Error('Invalid encrypted text format.')
    }
    const ivHex = textParts[0]
    const encryptedHex = textParts[1]

    // Validate hex format before creating buffers
    if (!/^[0-9a-fA-F]+$/.test(ivHex) || !/^[0-9a-fA-F]+$/.test(encryptedHex)) {
      throw new Error('Invalid hex string format.')
    }

    const iv = Buffer.from(ivHex, 'hex')
    // Ensure IV is correct length
    if (iv.length !== IV_LENGTH) {
      throw new Error('Invalid IV length.')
    }
    const encryptedText = Buffer.from(encryptedHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv)
    let decrypted = decipher.update(encryptedText)

    decrypted = Buffer.concat([decrypted, decipher.final()])

    return decrypted.toString()
  } catch (error) {
    // Log specific crypto errors vs format errors
    console.error(`Decryption failed: ${error.message}`)
    return null
  }
}

module.exports = { encrypt, decrypt }
