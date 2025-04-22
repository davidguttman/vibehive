// lib/gitHelper.js
const { spawn } = require('node:child_process')

/**
 * Executes a Git command using sudo -u.
 * @param {object} options - Options object.
 * @param {string} options.repoPath - Absolute path to the repository.
 * @param {string} options.assignedUserId - The user ID to run the command as.
 * @param {object} options.env - Environment variables (including GIT_SSH_COMMAND).
 * @param {string[]} options.gitArgs - Array of arguments for the git command.
 * @returns {Promise<{stdout: string, stderr: string}>} - Resolves with output, rejects on error.
 */
function executeGitCommand ({ repoPath, assignedUserId, env, gitArgs }) {
  return new Promise((resolve, reject) => {
    const command = 'sudo'
    const args = ['-u', assignedUserId, 'git', ...gitArgs]
    const options = {
      cwd: repoPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'] // ignore stdin, capture stdout, stderr
    }

    console.log(`Executing: ${command} ${args.join(' ')} in ${repoPath}`)

    const child = spawn(command, args, options)

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`Git command success (${gitArgs[0]}):\nStdout: ${stdout}\nStderr: ${stderr}`)
        resolve({ stdout, stderr })
      } else {
        console.error(`Git command failed (${gitArgs[0]}) with code ${code}:\nStderr: ${stderr}\nStdout: ${stdout}`)
        reject(new Error(`Git command failed with code ${code}. Stderr: ${stderr}`))
      }
    })

    child.on('error', (err) => {
      console.error(`Failed to spawn Git command (${gitArgs[0]}):`, err)
      reject(err)
    })
  })
}

/**
 * Stages all changes in the repository.
 * @param {object} options - Options object.
 * @param {string} options.repoPath - Absolute path to the repository.
 * @param {string} options.assignedUserId - The user ID to run the command as.
 * @param {object} options.env - Environment variables (including GIT_SSH_COMMAND).
 * @returns {Promise<void>}
 */
async function gitAddAll ({ repoPath, assignedUserId, env }) {
  await executeGitCommand({ repoPath, assignedUserId, env, gitArgs: ['add', '.'] })
}

/**
 * Commits staged changes.
 * @param {object} options - Options object.
 * @param {string} options.repoPath - Absolute path to the repository.
 * @param {string} options.assignedUserId - The user ID to run the command as.
 * @param {object} options.env - Environment variables (including GIT_SSH_COMMAND).
 * @param {string} options.message - The commit message.
 * @returns {Promise<void>}
 */
async function gitCommit ({ repoPath, assignedUserId, env, message }) {
  // Basic commit message escaping (replace " with ") - more robust escaping might be needed
  const escapedMessage = message.replace(/"/g, '"')
  await executeGitCommand({
    repoPath,
    assignedUserId,
    env,
    gitArgs: ['commit', '-m', escapedMessage]
  })
}

/**
 * Pushes the current HEAD to a specified remote branch.
 * @param {object} options - Options object.
 * @param {string} options.repoPath - Absolute path to the repository.
 * @param {string} options.assignedUserId - The user ID to run the command as.
 * @param {object} options.env - Environment variables (including GIT_SSH_COMMAND).
 * @param {string} options.branchName - The name of the remote branch to push to.
 * @returns {Promise<void>}
 */
async function gitPush ({ repoPath, assignedUserId, env, branchName }) {
  // Push current HEAD to the remote branch, creating/updating it forcefully if needed
  // Consider if force-pushing is desired (-f) or if creating a new branch is safer.
  // Using HEAD:branchName ensures we push the current state to the specified branch.
  await executeGitCommand({
    repoPath,
    assignedUserId,
    env,
    // NOTE: Using push origin HEAD:branchName - this will create or update the branch.
    // Add -f for force push if necessary, but be careful.
    gitArgs: ['push', 'origin', `HEAD:${branchName}`]
  })
}

module.exports = {
  gitAddAll,
  gitCommit,
  gitPush
}
