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

async function checkCanvas() {
  const canvas = () => request('/canvas')
  const action = (method, body = {}) => request(`/canvas/${method}`, 'POST', body)
  const owned = new Set()
  const open = async () => {
    const { windowId } = await action('new')
    owned.add(windowId)
    return windowId
  }
  assert.equal((await canvas()).available, true, 'The installed tmux must provide the canvas')
  try {
    const first = await open()
    const second = await open()
    const canvasId = (await canvas()).streamId
    await request(`/sessions/${canvasId}/size`, 'POST', { cols: 180, rows: 80 })
    const marker = output(canvasId, frame => frame.type === 'output' && frame.data.includes('native-pane-kept'))
    await marker.ready
    await send(canvasId, "export DSH_CANVAS_MARK=native; printf '%s%s\\n' \"$DSH_CANVAS_MARK\" '-pane-kept'\r")
    await marker.done

    await action('select', { windowId: first })
    const target = (await canvas()).panes[0]
    await action('join', { source: second, target: target.id, side: 'right' })
    let updated = await canvas()
    assert.equal(updated.windows.find(window => window.id === first).panes, 2)
    assert.ok(!updated.windows.some(window => window.id === second))
    assert.ok(updated.panes.some(pane => pane.left > target.left))
    assert.match((await output(canvasId, frame => frame.type === 'snapshot').done).screen, /native-pane-kept/)

    const detached = await action('break')
    owned.add(detached.windowId)
    assert.equal((await canvas()).windows.find(window => window.id === first).panes, 1)
    await action('select', { windowId: detached.windowId })
    const sameShell = output(canvasId, frame => frame.type === 'output' && frame.data.includes('native-reattached'))
    await sameShell.ready
    await send(canvasId, "printf '%s%s\\n' \"$DSH_CANVAS_MARK\" '-reattached'\r")
    await sameShell.done

    await action('select', { windowId: first })
    for (let count = 2; count <= 12; count += 1) {
      const source = count === 2 ? detached.windowId : await open()
      await action('select', { windowId: first })
      const largest = (await canvas()).panes.sort((a, b) => b.width * b.height - a.width * a.height)[0]
      await action('join', { source, target: largest.id, side: largest.width >= largest.height ? 'right' : 'bottom' })
    }
    updated = await canvas()
    assert.equal(updated.windows.find(window => window.id === first).panes, 12)
    console.log('Native tmux canvas: moved live panes, preserved shell state, broke out a pane, and reached 12 panes')
  } finally {
    for (const windowId of owned) await action('close', { windowId }).catch(() => {})
  }
}

if (process.env.DSH_TERMINAL_CHECK_CANVAS === '1') await checkCanvas()

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
