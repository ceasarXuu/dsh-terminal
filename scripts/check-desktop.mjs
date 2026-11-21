import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const launcher = new URL(process.env.DSH_TERMINAL_CHECK_URL)
const base = `${launcher.origin}/plugin/dsh-terminal`
const anonymous = await fetch(`${base}/sessions`)
assert.equal(anonymous.status, 401, 'The Desktop Host must load the plugin and protect its terminal list')
if (!launcher.searchParams.has('token')) process.exit(0)

const login = await fetch(launcher, { redirect: 'manual' })
const cookie = login.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
assert.ok(cookie, 'The DSH launch URL must establish a browser session')

async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: launcher.origin }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  })
  assert.ok(response.ok, `${method} ${path} returned HTTP ${response.status}`)
  return response.json()
}

function stream(path, predicate) {
  const ready = Promise.withResolvers()
  const signal = AbortSignal.timeout(8000)
  const done = (async () => {
    const response = await fetch(`${base}${path}`, { headers: { cookie }, signal })
    assert.equal(response.status, 200)
    const decoder = new TextDecoder()
    let pending = ''
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true })
      for (let end; (end = pending.indexOf('\n\n')) !== -1;) {
        const event = pending.slice(0, end)
        pending = pending.slice(end + 2)
        const line = event.split('\n').find(value => value.startsWith('data: '))
        if (!line) continue
        const frame = JSON.parse(line.slice(6))
        ready.resolve()
        if (predicate(frame)) return frame
      }
    }
    assert.fail('The terminal stream ended before the expected output')
  })()
  void done.catch(ready.reject)
  return { ready: ready.promise, done }
}

const ids = []
async function open(body = {}) {
  const session = await request('/sessions', 'POST', body)
  ids.push(session.id)
  return session.id
}
const output = (id, predicate) => stream(`/sessions/${id}/events`, predicate)
const send = (id, data) => request(`/sessions/${id}/input`, 'POST', { data })
const close = id => request(`/sessions/${id}`, 'DELETE')

try {
  const denied = await fetch(`${base}/sessions`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json', Origin: 'https://example.invalid' }, body: '{}',
  })
  assert.equal(denied.status, 403, 'A different origin must not open a terminal')
  const first = await open()
  const second = await open()
  assert.notEqual(first, second)
  const sessions = await request('/sessions')
  assert.ok(sessions.some(session => session.id === first))
  assert.ok(sessions.some(session => session.id === second))
  const live = output(first, frame => frame.type === 'output' && frame.data.includes('running-in-original'))
  await live.ready
  await send(first, "export DSH_CHECK_MARK=running; printf '%s%s\\n' \"$DSH_CHECK_MARK\" '-in-original'\r")
  await live.done
  const snapshot = await output(first, frame => frame.type === 'snapshot').done
  assert.match(snapshot.screen, /running-in-original/)
  assert.doesNotMatch((await output(second, frame => frame.type === 'snapshot').done).screen, /running-in-original/)
  await request(`/sessions/${first}/size`, 'POST', { cols: 93, rows: 27 })
  const resized = output(first, frame => frame.type === 'output' && frame.data.includes('size=27 93'))
  await resized.ready
  await send(first, 'printf "size=%s\\n" "$(stty size)"\r')
  await resized.done
  const alternate = output(first, frame => frame.type === 'output' && frame.data.includes('alternate-screen'))
  await alternate.ready
  await send(first, "printf '\\033[?1049h%s%s\\n' 'alternate' '-screen'; sleep 60\r")
  await alternate.done
  assert.match((await output(first, frame => frame.type === 'snapshot').done).screen, /alternate-screen/)
  const resumed = output(first, frame => frame.type === 'output' && frame.data.includes('shell-resumed'))
  await resumed.ready
  await send(first, '\x03')
  await send(first, "printf '\\033[?1049l%s%s\\n' 'shell' '-resumed'\r")
  await resumed.done
  await close(first)
  const lateResize = await request(`/sessions/${first}/size`, 'POST', { cols: 80, rows: 24 })
  assert.equal(lateResize.updated, false, 'A delayed resize must leave a closed session untouched')
  assert.ok(!(await request('/sessions')).some(session => session.id === first), 'Closing removes the terminal from the session list')

  if (process.env.DSH_TERMINAL_CHECK_TMUX === '1') {
    assert.ok(process.env.TMUX_TMPDIR, 'Use an isolated tmux server directory')
    const name = `terminal-check-${randomUUID().slice(0, 8)}`
    const tmux = (...args) => execFileSync('tmux', args, { encoding: 'utf8' })
    tmux('new-session', '-d', '-s', name)
    try {
      const candidate = (await request('/tmux')).sessions.find(session => session.name === name)
      assert.ok(candidate, 'The running tmux session must be discoverable')
      const attached = await open({ tmuxId: candidate.id })
      await output(attached, frame => frame.type === 'snapshot').done
      await close(attached)
      tmux('has-session', '-t', `=${name}`)
    } finally {
      tmux('kill-session', '-t', `=${name}`)
    }
  }
  console.log('Desktop Host: terminal creation, streaming, reattachment, resize, Ctrl-C, close, and authorization passed')
} finally {
  for (const id of ids) await close(id).catch(() => {})
}
