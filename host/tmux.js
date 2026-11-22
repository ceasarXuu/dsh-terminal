import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { TerminalError } from './session.js'

const exec = promisify(execFile)
const TMUX_COMMANDS = ['tmux', '/opt/homebrew/bin/tmux', '/usr/local/bin/tmux']

export async function findTmux(subprocess, signal) {
  if (process.platform === 'win32') return null
  for (const command of TMUX_COMMANDS) {
    if (signal?.aborted) break
    const executable = await subprocess.resolveExecutable(command, undefined, signal).catch(() => null)
    if (executable) return executable
  }
  return null
}

export async function listTmux(executable, signal) {
  if (!executable) return []
  try {
    const { stdout } = await exec(executable, ['list-sessions', '-F', '#{session_id}\t#{session_name}'], {
      signal, timeout: 4000, maxBuffer: 256 * 1024,
    })
    return stdout.split('\n').flatMap(line => {
      const result = /^(\$\d+)\t(.*)$/u.exec(line)
      return result ? [{ id: result[1], name: result[2].replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 120) }] : []
    })
  } catch (error) {
    if (error.code === 1 && /no server running|connect(?:ing)? to .+No such file/iu.test(error.stderr ?? '')) return []
    throw new TerminalError(503, 'Unable to list tmux sessions on this Mac.', 'tmuxListFailed')
  }
}
