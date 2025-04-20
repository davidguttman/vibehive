const fs = require('node:fs/promises')
const path = require('node:path')

const REPO_BASE_DIR = process.env.REPO_BASE_DIR || '/repos' // Use '/repos' or adjust for local testing

async function writeTempKey ({ repoName, keyContent }) {
  if (!repoName || !keyContent) {
    throw new Error('repoName and keyContent are required')
  }
  const repoDir = path.join(REPO_BASE_DIR, repoName)
  const targetDir = path.join(repoDir, '.ssh')
  const targetFile = path.join(targetDir, 'id_rsa')

  await fs.mkdir(targetDir, { recursive: true })
  // Write the key file with restricted permissions
  await fs.writeFile(targetFile, keyContent, { mode: 0o600 })

  console.log(`Temporary key written to ${targetFile}`) // Optional logging
  return targetFile
}

async function deleteTempKey ({ repoName }) {
  if (!repoName) {
    throw new Error('repoName is required')
  }
  const repoDir = path.join(REPO_BASE_DIR, repoName)
  const targetDir = path.join(repoDir, '.ssh')
  const targetFile = path.join(targetDir, 'id_rsa')

  try {
    await fs.unlink(targetFile)
    console.log(`Temporary key deleted: ${targetFile}`) // Optional logging
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Ignore 'file not found' errors, re-throw others
      console.error(`Error deleting key file ${targetFile}:`, err)
      throw err
    }
    console.log(`Temporary key already deleted or never existed: ${targetFile}`) // Optional logging
  }

  // Optional: Attempt to remove the .ssh directory if it's empty
  try {
    await fs.rmdir(targetDir)
    console.log(`Removed empty directory: ${targetDir}`) // Optional logging
  } catch (err) {
    // Ignore errors if directory not found or not empty
    if (err.code !== 'ENOENT' && err.code !== 'ENOTEMPTY') {
      console.error(`Error removing directory ${targetDir}:`, err)
      // Decide if this should be a fatal error or just logged
    }
  }
}

module.exports = {
  writeTempKey,
  deleteTempKey
}
