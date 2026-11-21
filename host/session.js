import headless from '@xterm/headless'
import serialize from '@xterm/addon-serialize'

const { Terminal } = headless
const { SerializeAddon } = serialize
const SCROLLBACK = 1000

export class TerminalSession {
  #screen
  #serializer = new SerializeAddon()
  #viewers = new Set()
  #operations = Promise.resolve()
  #closed
  #drained
  #mouseEncoding = 0

  constructor(info, handle, onExit) {
    this.info = info
    this.handle = handle
    this.#screen = new Terminal({ cols: info.cols, rows: info.rows, scrollback: SCROLLBACK, allowProposedApi: true })
    this.#screen.loadAddon(this.#serializer)
    // The serializer restores mouse tracking but omits the SGR encoding.
    for (const final of ['h', 'l']) {
      this.#screen.parser.registerCsiHandler({ prefix: '?', final }, modes => {
        for (const mode of modes) {
          if (mode === 1006 || mode === 1016) {
            if (final === 'h') this.#mouseEncoding = mode
            else if (this.#mouseEncoding === mode) this.#mouseEncoding = 0
          }
        }
        return false
      })
    }
    this.#screen.parser.registerEscHandler({ final: 'c' }, () => { this.#mouseEncoding = 0; return false })
    this.#drained = this.#readOutput(onExit)
  }

  follow(feed) {
    return this.#enqueue(() => {
      if (this.#closed || feed.closed) return feed.close()
      const encoding = this.#mouseEncoding ? `\x1b[?${this.#mouseEncoding}h` : ''
      feed.send({ type: 'snapshot', screen: this.#serializer.serialize() + encoding, session: this.info })
      if (feed.closed) return
      this.#viewers.add(feed)
      feed.onClose(() => this.#viewers.delete(feed))
    })
  }

  write(data) {
    return this.#enqueue(() => this.#useProcess(() => this.handle.write(data)))
  }

  resize(cols, rows) {
    return this.#enqueue(async () => {
      if (this.#closed || this.info.state !== 'running' || !this.handle.running) return false
      if (cols !== this.info.cols || rows !== this.info.rows) {
        await this.handle.resize(cols, rows)
        this.#screen.resize(cols, rows)
        this.info = { ...this.info, cols, rows }
        this.#publish({ type: 'state', session: this.info })
      }
      return true
    })
  }

  close() {
    this.#closed ??= this.#operations.then(async () => {
      await this.handle.terminate()
      await this.#drained
      for (const feed of this.#viewers) feed.close()
      this.#screen.dispose()
    }).catch(error => {
      this.#closed = undefined
      throw error
    })
    return this.#closed
  }

  #useProcess(operation) {
    if (this.#closed || this.info.state !== 'running') {
      throw new TerminalError(409, 'This terminal is no longer running.')
    }
    return operation()
  }

  #enqueue(operation) {
    const result = this.#operations.then(operation)
    this.#operations = result.catch(() => {})
    return result
  }

  #publish(frame) {
    for (const feed of this.#viewers) feed.send(frame)
  }

  async #readOutput(onExit) {
    const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
    const outcome = this.handle.done.catch(() => null)
    try {
      for await (const chunk of this.handle.output) {
        await this.#output(decoder.decode(chunk, { stream: true }))
      }
      await this.#output(decoder.decode())
      const result = await outcome
      this.info = { ...this.info, state: result ? 'exited' : 'failed', exitCode: result?.exitCode ?? null }
    } catch {
      this.info = { ...this.info, state: 'failed', exitCode: null }
    }
    this.#publish({ type: 'state', session: this.info })
    onExit()
  }

  async #output(data) {
    // Keep individual frames small enough for a slow renderer to recover by reattaching.
    for (const part of data.match(/[^]{1,8192}/gu) ?? []) {
      await this.#enqueue(async () => {
        await new Promise(resolve => this.#screen.write(part, resolve))
        this.#publish({ type: 'output', data: part })
      })
    }
  }
}

export class TerminalError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
