import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { TerminalError, TerminalSession } from './session.js'

const MAX_SESSIONS = 16
const COLS = 80
const ROWS = 24

export class TerminalRuntime {
  #sessions = new Map()
  #openings = new Set()
  #followers = new Set()
  #lifetime = new AbortController()

  constructor(subprocess) {
    this.subprocess = subprocess
  }

  list() {
    return Array.from(this.#sessions.values(), session => session.info)
  }

  get(id) {
    const session = this.#sessions.get(id)
    if (!session) throw new TerminalError(404, 'This terminal was closed or is unavailable.', 'terminalUnavailable')
    return session
  }

  follow(feed) {
    feed.send(this.#catalog())
    if (feed.closed) return
    this.#followers.add(feed)
    feed.onClose(() => this.#followers.delete(feed))
  }

  resize(id, cols, rows) {
    return this.#sessions.get(id)?.resize(cols, rows) ?? false
  }

  async open() {
    this.#lifetime.signal.throwIfAborted()
    if (this.#sessions.size + this.#openings.size >= MAX_SESSIONS) {
      throw new TerminalError(409, `Close a terminal before opening another. Up to ${MAX_SESSIONS} terminals can be open.`,
        'terminalLimit', { limit: MAX_SESSIONS })
    }
    const opening = this.#allocate().finally(() => this.#openings.delete(opening))
    this.#openings.add(opening)
    return opening
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
    await Promise.allSettled(this.#openings)
    const closed = await Promise.allSettled([...this.#sessions.keys()].map(id => this.close(id)))
    const failures = closed.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length) throw new AggregateError(failures, 'Unable to finish closing terminal processes')
  }

  async #allocate() {
    const signal = this.#lifetime.signal
    const { defaultShell } = await this.subprocess.terminalEnvironment(signal)
    const shell = await this.subprocess.resolveExecutable(defaultShell || '/bin/sh', undefined, signal)
    const handle = await this.subprocess.spawnTerminal({
      argv: [shell], cwd: homedir(), cols: COLS, rows: ROWS, terminalType: 'xterm-256color', graceMs: 1000, signal,
    })
    try {
      signal.throwIfAborted()
      const info = { id: randomUUID(), title: basename(shell), cols: COLS, rows: ROWS, state: 'running' }
      this.#sessions.set(info.id, new TerminalSession(info, handle, () => this.#publish()))
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
    return { type: 'sessions', sessions: this.list() }
  }
}
