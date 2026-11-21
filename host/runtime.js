import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { TerminalError, TerminalSession } from './session.js'
import { findTmux, listTmux } from './tmux.js'
import { TmuxCanvas } from './tmux-canvas.js'

const MAX_SESSIONS = 16
const COLS = 80
const ROWS = 24

export class TerminalRuntime {
  #sessions = new Map()
  #allocations = new Map()
  #followers = new Set()
  #lifetime = new AbortController()

  constructor(subprocess, profileDir, logger) {
    this.subprocess = subprocess
    this.canvas = new TmuxCanvas(subprocess, profileDir, this.#lifetime.signal, () => this.#publish(), logger)
  }

  list() {
    return Array.from(this.#sessions.values(), session => session.info)
  }

  get(id) {
    const session = this.#find(id)
    if (!session) throw new TerminalError(404, 'This terminal was closed or is unavailable.')
    return session
  }

  follow(feed) {
    feed.send(this.#catalog())
    if (feed.closed) return
    this.#followers.add(feed)
    feed.onClose(() => this.#followers.delete(feed))
  }

  resize(id, cols, rows) {
    return this.#find(id)?.resize(cols, rows) ?? false
  }

  async tmux() {
    const signal = this.#lifetime.signal
    const executable = await findTmux(this.subprocess, signal)
    return { available: Boolean(executable), sessions: await listTmux(executable, signal) }
  }

  async open({ tmuxId } = {}) {
    this.#lifetime.signal.throwIfAborted()
    if (tmuxId !== undefined) {
      const existing = this.list().find(info => info.tmuxId === tmuxId && info.state === 'running')
      if (existing) return existing
      const pending = this.#allocations.get(tmuxId)
      if (pending) return pending
    }
    if (this.#sessions.size + this.#allocations.size >= MAX_SESSIONS) {
      throw new TerminalError(409, `Close a terminal before opening another. Up to ${MAX_SESSIONS} terminals can be open.`)
    }
    const key = tmuxId ?? Symbol()
    const pending = this.#allocate(tmuxId).finally(() => this.#allocations.delete(key))
    this.#allocations.set(key, pending)
    return pending
  }

  async close(id) {
    const session = this.#sessions.get(id)
    if (!session) return
    await session.close()
    this.#sessions.delete(id)
    this.#publish()
  }

  async dispose() {
    this.#lifetime.abort()
    for (const feed of this.#followers) feed.close()
    await Promise.allSettled(this.#allocations.values())
    const closed = await Promise.allSettled([this.canvas.dispose(), ...[...this.#sessions.keys()].map(id => this.close(id))])
    const failures = closed.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length) throw new AggregateError(failures, 'Unable to finish closing terminal processes')
  }

  async #allocate(tmuxId) {
    const signal = this.#lifetime.signal
    let argv
    let title
    let env
    if (tmuxId !== undefined) {
      const executable = await findTmux(this.subprocess, signal)
      const candidate = (await listTmux(executable, signal)).find(item => item.id === tmuxId)
      if (!candidate) throw new TerminalError(404, 'The selected tmux session is no longer available.')
      argv = [executable, 'attach-session', '-t', tmuxId]
      title = candidate.name
      if (process.env.TMUX_TMPDIR) env = { TMUX_TMPDIR: process.env.TMUX_TMPDIR }
    } else {
      const { defaultShell } = await this.subprocess.terminalEnvironment(signal)
      const shell = await this.subprocess.resolveExecutable(defaultShell || '/bin/sh', undefined, signal)
      argv = [shell]
      title = basename(shell)
    }
    const handle = await this.subprocess.spawnTerminal({
      argv, cwd: homedir(), env, cols: COLS, rows: ROWS, terminalType: 'xterm-256color', graceMs: 1000, signal,
    })
    try {
      signal.throwIfAborted()
      const info = { id: randomUUID(), title, tmuxId, cols: COLS, rows: ROWS, state: 'running' }
      const session = new TerminalSession(info, handle, () => this.#publish())
      this.#sessions.set(info.id, session)
      this.#publish()
      return info
    } catch (error) {
      await handle.terminate()
      throw error
    }
  }

  #publish() {
    const frame = this.#catalog()
    for (const feed of this.#followers) feed.send(frame)
  }

  #catalog() {
    return { type: 'sessions', sessions: this.list(), canvas: this.canvas.snapshot }
  }

  #find(id) {
    const canvas = this.canvas.terminal
    return canvas?.info.id === id ? canvas : this.#sessions.get(id)
  }
}
