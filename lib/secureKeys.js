const fs = require('node:fs/promises')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

/**
 * Writes a temporary SSH key file.
 * @param {object} options - The options object.
 * @param {string} options.repoName - The name of the repository (used for subdirectory).
 * @param {string} options.keyContent - The content of the SSH key.
 * @param {string} options.ownerUserId - The system user ID that should own the key file.
 * @param {string} [options.repoBaseDir=null] - Optional base directory override.
 * @returns {Promise<string>} The path to the temporary key file.
 * @throws {Error} If the directory cannot be created or the file cannot be written.
 */
async function writeTempKey ({ repoName, keyContent, ownerUserId, repoBaseDir = null }) {
  if (!repoName || !keyContent) {
    throw new Error('repoName and keyContent are required')
  }
  if (!ownerUserId) {
    throw new Error('ownerUserId is required')
  }
  const baseDir = repoBaseDir || process.env.REPO_BASE_DIR || '/repos'

  const repoDir = path.join(baseDir, repoName)
  const targetDir = path.join(repoDir, '.ssh')
  const targetFile = path.join(targetDir, 'id_rsa')

  try {
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(targetFile, keyContent, { mode: 0o600 })
    console.log(`Temporary key written to ${targetFile}`) // Optional logging

    // Change ownership and permissions using sudo
    try {
      console.log(`Attempting to chown ${targetFile} to ${ownerUserId}`)
      execFileSync('sudo', ['-u', ownerUserId, 'chown', `${ownerUserId}:${ownerUserId}`, targetFile])
      console.log(`Successfully chowned ${targetFile} to ${ownerUserId}`)

      // Re-apply chmod just in case
      console.log(`Attempting to chmod 600 ${targetFile} as ${ownerUserId}`)
      execFileSync('sudo', ['-u', ownerUserId, 'chmod', '600', targetFile])
      console.log(`Successfully chmod 600 ${targetFile}`)
    } catch (error) {
      console.error(`Error setting ownership/permissions for ${targetFile} via sudo: ${error.message}`)
      throw new Error(`Failed to set ownership/permissions via sudo: ${error.message}`)
    }
    return targetFile
  } catch (error) {
    console.error(`Error in writeTempKey for ${repoName} at ${baseDir}:`, error)
    throw error
  }
}

/**
 * Deletes a temporary SSH key file and its directory if empty.
 * @param {object} options - The options object.
 * @param {string} options.repoName - The name of the repository.
 * @param {string} [options.ownerUserId] - The system user ID (needed if appuser lacks direct delete permissions).
 * @param {string} [options.repoBaseDir=null] - Optional base directory override.
 * @returns {Promise<void>}
 */
async function deleteTempKey ({ repoName, ownerUserId, repoBaseDir = null }) {
  if (!repoName) {
    throw new Error('repoName is required')
  }
  const baseDir = repoBaseDir || process.env.REPO_BASE_DIR || '/repos'

  const repoDir = path.join(baseDir, repoName)
  const targetDir = path.join(repoDir, '.ssh')
  const targetFile = path.join(targetDir, 'id_rsa')

  try {
    await fs.unlink(targetFile)
    console.log(`Temporary key deleted: ${targetFile}`) // Optional logging
  } catch (err) {
    if (err.code !== 'ENOENT') {
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
    if (err.code !== 'ENOENT' && err.code !== 'ENOTEMPTY') {
      console.error(`Error removing directory ${targetDir}:`, err)
    }
  }
}

module.exports = {
  writeTempKey,
  deleteTempKey
}
