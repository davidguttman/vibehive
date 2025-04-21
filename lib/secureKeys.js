const fs = require('node:fs/promises')
const path = require('node:path')

async function writeTempKey ({ repoName, keyContent, repoBaseDir = null }) {
  if (!repoName || !keyContent) {
    throw new Error('repoName and keyContent are required')
  }
  const baseDir = repoBaseDir || process.env.REPO_BASE_DIR || '/repos'

  const repoDir = path.join(baseDir, repoName)
  const targetDir = path.join(repoDir, '.ssh')
  const targetFile = path.join(targetDir, 'id_rsa')

  try {
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(targetFile, keyContent, { mode: 0o600 })
    console.log(`Temporary key written to ${targetFile}`) // Optional logging
    return targetFile
  } catch (error) {
    console.error(`Error in writeTempKey for ${repoName} at ${baseDir}:`, error)
    throw error
  }
}

async function deleteTempKey ({ repoName, repoBaseDir = null }) {
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
