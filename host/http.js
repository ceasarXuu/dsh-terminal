import manifest from '../package.json' with { type: 'json' }
import { TerminalError } from './session.js'

export const BASE = '/plugin/dsh-terminal'
const MAX_REQUEST_BYTES = 512 * 1024
const MAX_INPUT_BYTES = 64 * 1024
const MAX_FEED_BYTES = 4 * 1024 * 1024
const LOOPBACK = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/iu
const LOOPBACK_ADDRESS = /^(?:::1|(?:::ffff:)?127\.\d+\.\d+\.\d+)$/iu
const SESSION_PATH = /^\/sessions\/([\da-f-]{36})(?:\/(events|input|size))?$/u
const HEADERS = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-DSH-Terminal-Version': manifest.version,
}

function reply(res, status, value) {
  if (res.destroyed) return
  res.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

async function readBody(req) {
  if (req.headers['content-type']?.split(';', 1)[0].trim() !== 'application/json') {
    throw new TerminalError(415, 'Expected a JSON request.', 'invalidRequest')
  }
  if (Number(req.headers['content-length']) > MAX_REQUEST_BYTES) throw new TerminalError(413, 'Request is too large.', 'invalidRequest')
  let size = 0
  const parts = []
  for await (const part of req.iterator({ destroyOnReturn: false })) {
    size += part.length
    if (size > MAX_REQUEST_BYTES) throw new TerminalError(413, 'Request is too large.', 'invalidRequest')
    parts.push(part)
  }
  let body
  try { body = JSON.parse(Buffer.concat(parts).toString('utf8')) }
  catch { throw new TerminalError(400, 'Invalid JSON request.', 'invalidRequest') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TerminalError(400, 'Expected a JSON object.', 'invalidRequest')
  return body
}

export function createFeed(res) {
  const listeners = new Set()
  let closed = false
  res.writeHead(200, { ...HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8' })
  res.flushHeaders()
  const heartbeat = setInterval(() => write(': keep-alive\n\n'), 15_000)
  heartbeat.unref()
  res.once('close', finish)
  res.once('error', finish)

  function finish() {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    for (const listener of listeners) listener()
    listeners.clear()
  }

  function write(data) {
    if (closed || res.destroyed) return finish()
    if (res.writableLength + Buffer.byteLength(data) > MAX_FEED_BYTES) {
      finish()
      res.destroy()
      return
    }
    res.write(data)
  }

  return {
    get closed() { return closed },
    onClose(listener) { closed ? listener() : listeners.add(listener) },
    send(value) { write(`data: ${JSON.stringify(value)}\n\n`) },
    close() { finish(); res.end() },
  }
}

export function terminalRoute(connection, runtime, logger) {
  return async (req, res) => {
    try {
      const admission = connection.admit(req)
      if (admission.rejection !== undefined) {
        return reply(res, admission.rejection, { error: 'DSH did not authorize this request.', code: 'unauthorized' })
      }
      if (!LOOPBACK.test(req.headers.host ?? '') || !LOOPBACK_ADDRESS.test(req.socket.remoteAddress ?? '')) {
        return reply(res, 403, { error: 'Terminal is available in the local DSH desktop interface.', code: 'localOnly' })
      }
      const path = new URL(req.url, 'http://localhost').pathname.slice(BASE.length)
      const get = req.method === 'GET'
      if (get && path === '/canvas') return reply(res, 200, runtime.canvas.snapshot)
      if (req.method === 'POST' && path.startsWith('/canvas/')) {
        return reply(res, 200, await runtime.canvas.action(path.slice('/canvas/'.length), await readBody(req)))
      }
      if (get && path === '/sessions') return reply(res, 200, runtime.list())
      if (get && path === '/events') return runtime.follow(createFeed(res))
      if (get && path === '/tmux') return reply(res, 200, await runtime.tmux())
      if (req.method === 'POST' && path === '/sessions') {
        const { tmuxId } = await readBody(req)
        if (tmuxId !== undefined && (typeof tmuxId !== 'string' || !/^\$\d{1,12}$/u.test(tmuxId))) {
          throw new TerminalError(400, 'Invalid tmux session.', 'invalidRequest')
        }
        return reply(res, 200, await runtime.open({ tmuxId }))
      }
      const match = SESSION_PATH.exec(path)
      if (match) {
        const [, id, action] = match
        if (req.method === 'DELETE' && !action) {
          await runtime.close(id)
          return reply(res, 200, {})
        }
        if (get && action === 'events') {
          const session = runtime.get(id)
          return await session.follow(createFeed(res))
        }
        if (req.method === 'POST' && (action === 'input' || action === 'size')) {
          const body = await readBody(req)
          if (action === 'input') {
            if (typeof body.data !== 'string' || Buffer.byteLength(body.data) > MAX_INPUT_BYTES) {
              throw new TerminalError(400, 'Invalid terminal input or paste larger than 64 KiB.', 'invalidInput')
            }
            await runtime.get(id).write(body.data)
            return reply(res, 200, {})
          }
          const { cols, rows } = body
          if (!Number.isInteger(cols) || cols < 2 || cols > 350 || !Number.isInteger(rows) || rows < 1 || rows > 150) {
            throw new TerminalError(400, 'Invalid terminal dimensions.', 'invalidRequest')
          }
          return reply(res, 200, { updated: await runtime.resize(id, cols, rows) })
        }
      }
      reply(res, 404, { error: 'Terminal endpoint not found.' })
    } catch (error) {
      if (res.headersSent) return res.destroy()
      if (error instanceof TerminalError) {
        return reply(res, error.status, { error: error.message, code: error.code, params: error.params })
      }
      logger.warn('Terminal operation failed: %s', error.message)
      reply(res, 500, { error: 'Unable to complete the terminal operation.' })
    }
  }
}
