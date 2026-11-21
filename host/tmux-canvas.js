import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { TerminalError, TerminalSession } from './session.js'
import { findTmux } from './tmux.js'

const exec = promisify(execFile)
const SESSION_NAME = 'dsh-terminal'
const OWNER_OPTION = '@dsh-terminal'
const WINDOW = /^@\d+$/u
const PANE = /^%\d+$/u
const DIRECTION = { left: ['-h', '-b'], right: ['-h'], top: ['-v', '-b'], bottom: ['-v'] }
const CHANGE = /^%(?:session-(?:changed|renamed|window-changed)|sessions-changed|(?:unlinked-)?window-(?:add|close|renamed|pane-changed)|layout-change)(?:\s|$)/u
const MISSING = /no server running|connect(?:ing)? to .+No such file|no sessions|can't find session/iu
const WINDOW_FORMAT = '#{window_id}\t#{window_active}\t#{window_panes}\t#{window_name}'
const PANE_FORMAT = '#{pane_id}\t#{pane_active}\t#{pane_left}\t#{pane_top}\t#{pane_width}\t#{pane_height}\t#{window_zoomed_flag}\t#{status-position}\t#{status}'

const cleanName = name => name.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 120)

export class TmuxCanvas {
  #executable
  #sessionId
  #terminal
  #watcher
  #timer
  #pending = Promise.resolve()
  #snapshot = { available: false, attached: false, streamId: null, windows: [], panes: [], top: 0 }

  constructor(subprocess, profileDir, signal, publish, logger) {
    this.subprocess = subprocess
    this.signal = signal
    this.publish = publish
    this.logger = logger
    const scope = createHash('sha256').update(profileDir).digest('hex').slice(0, 20)
    this.socketArgs = ['-L', `dsh-terminal-${scope}`]
    const { TMUX: _inherited, ...env } = process.env
    this.env = env
  }

  get snapshot() { return this.#snapshot }
  get terminal() { return this.#terminal }

  async start() {
    this.#executable = await findTmux(this.subprocess, this.signal)
    if (!this.#executable) return
    this.#snapshot = { ...this.#snapshot, available: true }
    await this.#enqueue(() => this.#refresh())
  }

  action(method, args) {
    return this.#enqueue(async () => {
      if (!this.#executable) throw new TerminalError(409, 'Install tmux to use a terminal canvas.')
      await this.#refresh()
      let windowId
      switch (method) {
        case 'new':
          windowId = await this.#newWindow()
          break
        case 'select':
          windowId = this.#window(args.windowId)
          await this.#command('select-window', '-t', windowId)
          break
        case 'close':
          if (!this.#snapshot.windows.some(window => window.id === args.windowId)) return {}
          await this.#command('kill-window', '-t', this.#window(args.windowId))
          break
        case 'join': {
          const source = this.#window(args.source)
          const target = this.#snapshot.panes.find(pane => pane.id === args.target)
          const active = this.#snapshot.windows.find(window => window.active)
          const flags = typeof args.side === 'string' && Object.hasOwn(DIRECTION, args.side) ? DIRECTION[args.side] : null
          if (!PANE.test(args.target ?? '') || !target || !active || source === active.id || !flags) {
            throw new TerminalError(400, 'Choose a pane in a different tmux window.')
          }
          await this.#command('join-pane', ...flags, '-s', source, '-t', target.id)
          windowId = active.id
          break
        }
        case 'break': {
          const pane = this.#snapshot.panes.find(item => item.active)
          if (!pane) throw new TerminalError(404, 'There is no active tmux pane.')
          windowId = await this.#command('break-pane', '-P', '-F', '#{window_id}', '-s', pane.id, '-t', `${this.#sessionId}:`)
          break
        }
        case 'attach':
          if (!this.#sessionId) throw new TerminalError(404, 'There is no tmux window to attach.')
          if (this.#terminal?.info.state === 'running') return {}
          await this.#closeClient()
          break
        default:
          throw new TerminalError(404, 'Terminal canvas operation not found.')
      }
      await this.#refresh()
      return windowId ? { windowId } : {}
    })
  }

  async dispose() {
    clearTimeout(this.#timer)
    this.#stopWatcher()
    await this.#pending
    await this.#closeClient()
  }

  #enqueue(operation) {
    const result = this.#pending.then(() => {
      this.signal.throwIfAborted()
      return operation()
    })
    this.#pending = result.catch(() => {})
    return result
  }

  async #newWindow() {
    if (this.#sessionId) {
      return this.#command('new-window', '-P', '-F', '#{window_id}', '-c', homedir(), '-t', `${this.#sessionId}:`)
    }
    const created = await this.#command('new-session', '-d', '-P', '-F', '#{session_id}\t#{window_id}', '-s', SESSION_NAME,
      '-c', homedir(), '-x', '80', '-y', '24')
    const [sessionId, windowId] = created.split('\t')
    await this.#command('set-option', '-t', sessionId, OWNER_OPTION, '1')
    await this.#command('set-option', '-t', sessionId, 'mouse', 'on')
    return windowId
  }

  async #refresh() {
    const sessions = (await this.#command('list-sessions', '-F', `#{session_id}\t#{${OWNER_OPTION}}\t#{session_name}`).catch(error => {
      if (MISSING.test(error.message)) return ''
      throw error
    })).split('\n').map(line => line.split('\t'))
    const record = sessions.find(([id, owner]) => /^\$\d+$/u.test(id) && owner === '1')
      ?? sessions.find(([id, , name]) => /^\$\d+$/u.test(id) && name === SESSION_NAME)
    const sessionId = record?.[0]
    if (sessionId !== this.#sessionId) {
      this.#stopWatcher()
      await this.#closeClient()
      this.#sessionId = sessionId
    }
    if (!sessionId) {
      this.#publish([], [], 0)
      return
    }

    const listing = await this.#command('list-windows', '-t', sessionId, '-F', WINDOW_FORMAT)
    const windows = listing.split('\n').flatMap(line => {
      const [id, active, panes, ...name] = line.split('\t')
      return WINDOW.test(id) ? [{ id, active: active === '1', panes: Number(panes), title: cleanName(name.join('\t')) || 'tmux' }] : []
    })
    const active = windows.find(window => window.active)
    if (!active) {
      this.#publish(windows, [], 0)
      return
    }
    if (!this.#terminal) await this.#attachClient(sessionId)
    this.#watch(sessionId)
    const dimensions = await this.#command('list-panes', '-t', active.id, '-F', PANE_FORMAT)
    const rows = dimensions.split('\n').map(line => line.split('\t'))
    const panes = rows.flatMap(([id, active, left, top, width, height, zoomed]) => {
      return PANE.test(id) && (zoomed !== '1' || active === '1')
        ? [{ id, active: active === '1', left: Number(left), top: Number(top), width: Number(width), height: Number(height) }] : []
    })
    const top = rows[0]?.[7] === 'top' ? (rows[0][8] === 'on' ? 1 : Number(rows[0][8]) || 0) : 0
    this.#publish(windows, panes, top)
  }

  #publish(windows, panes, top) {
    const next = {
      available: true, attached: this.#terminal?.info.state === 'running', streamId: this.#terminal?.info.id ?? null,
      windows, panes, top,
    }
    if (JSON.stringify(this.#snapshot) === JSON.stringify(next)) return
    this.#snapshot = next
    this.publish()
  }

  #window(id) {
    if (typeof id !== 'string' || !WINDOW.test(id) || !this.#snapshot.windows.some(window => window.id === id)) {
      throw new TerminalError(404, 'This tmux window is no longer available.')
    }
    return id
  }

  async #attachClient(sessionId) {
    const id = randomUUID()
    const handle = await this.subprocess.spawnTerminal({
      argv: [this.#executable, ...this.socketArgs, 'attach-session', '-t', sessionId],
      cwd: homedir(), env: { TMUX: '', ...(this.env.TMUX_TMPDIR ? { TMUX_TMPDIR: this.env.TMUX_TMPDIR } : {}) },
      cols: 80, rows: 24, terminalType: 'xterm-256color', graceMs: 1000, signal: this.signal,
    })
    try {
      this.signal.throwIfAborted()
      this.#terminal = new TerminalSession({ id, title: 'tmux', cols: 80, rows: 24, state: 'running' }, handle,
        () => this.#scheduleRefresh())
    } catch (error) {
      await handle.terminate()
      throw error
    }
  }

  async #closeClient() {
    if (!this.#terminal) return
    await this.#terminal.close()
    this.#terminal = undefined
  }

  #watch(sessionId) {
    if (this.#watcher || this.signal.aborted) return
    const child = spawn(this.#executable, [...this.socketArgs, '-C', 'attach-session', '-f', 'ignore-size,no-output', '-t', sessionId], {
      env: this.env, stdio: ['pipe', 'pipe', 'ignore'],
    })
    this.#watcher = child
    child.stdin.on('error', () => {})
    const lines = createInterface({ input: child.stdout })
    lines.on('line', line => { if (CHANGE.test(line)) this.#scheduleRefresh() })
    child.on('error', error => this.logger.warn('tmux event client failed: %s', error.message))
    child.once('close', () => {
      lines.close()
      if (this.#watcher !== child) return
      this.#watcher = undefined
      this.#scheduleRefresh(300)
    })
  }

  #stopWatcher() {
    const child = this.#watcher
    this.#watcher = undefined
    child?.kill()
  }

  #scheduleRefresh(delay = 65) {
    if (this.#timer || this.signal.aborted) return
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      this.#enqueue(() => this.#refresh()).catch(error => {
        if (!this.signal.aborted) this.logger.warn('tmux canvas refresh failed: %s', error.message)
      })
    }, delay)
    this.#timer.unref()
  }

  async #command(...args) {
    try {
      const { stdout } = await exec(this.#executable, [...this.socketArgs, ...args], {
        env: this.env, timeout: 4000, maxBuffer: 1024 * 1024, signal: this.signal,
      })
      return stdout.trimEnd()
    } catch (error) {
      throw new TerminalError(409, error.stderr?.trim() || 'tmux could not complete this operation.')
    }
  }
}
