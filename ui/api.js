const BASE = '/plugin/dsh-terminal'

export async function api(path, method = 'GET', body, signal) {
  const response = await fetch(BASE + path, {
    method, signal, credentials: 'same-origin', cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload === null) throw new Error(payload?.error ?? 'Unable to connect to Terminal.')
  return payload
}

export const sessionPath = id => `/sessions/${encodeURIComponent(id)}`
export const events = () => new EventSource(`${BASE}/events`)

export async function follow(id, signal, onFrame) {
  const response = await fetch(`${BASE}${sessionPath(id)}/events`, { signal, cache: 'no-store' })
  if (response.status === 404) return
  if (!response.ok || !response.body) throw new Error('Unable to connect to this terminal.')
  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true })
    for (let end; (end = pending.indexOf('\n\n')) !== -1;) {
      const event = pending.slice(0, end)
      pending = pending.slice(end + 2)
      if (event.startsWith('data: ')) await onFrame(JSON.parse(event.slice(6)))
      if (signal.aborted) return
    }
  }
  if (!signal.aborted) throw new Error('Terminal connection interrupted.')
}
