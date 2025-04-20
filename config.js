// config.js

// 1. Package Requires
// Only load .env file in non-test environments
if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config()
}

// 2. Local Requires (None)

// 3. Constants
const config = {
  // Provide default empty strings for test environment if needed,
  // although tests should ideally provide their own specific config (like the DB URI)
  discordToken: process.env.DISCORD_TOKEN || '',
  discordClientId: process.env.DISCORD_CLIENT_ID || '',
  mongoURI: process.env.MONGODB_URI || '',
  mongoDBName: process.env.MONGODB_DB_NAME || ''
}

// 4. Immediately Run Code (Validation - only in non-test environments)
if (process.env.NODE_ENV !== 'test') {
  const requiredEnvVars = ['discordToken', 'discordClientId', 'mongoURI', 'mongoDBName']
  const missingEnvVars = requiredEnvVars.filter(key => !config[key])

  if (missingEnvVars.length > 0) {
    console.error(`Error: Missing required environment variables: ${missingEnvVars.join(', ')}`)
    process.exit(1)
  }
}

// 5. Module Exports
module.exports = config

// 6. Functions (None)
