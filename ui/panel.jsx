import React, { useEffect, useRef, useState } from 'react'
import { api, events, sessionPath } from './api.js'
import { TerminalScreen } from './screen.jsx'

const POSITION = '@ceasarxuu/dsh-terminal:tabs'

function useSessions() {
  const [sessions, setSessions] = useState(null)
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    const source = events()
    source.onmessage = ({ data }) => {
      const frame = JSON.parse(data)
      if (frame.type !== 'sessions') return
      setSessions(frame.sessions)
      setConnected(true)
    }
    source.onerror = () => setConnected(false)
    return () => source.close()
  }, [])
  return { sessions, connected }
}

export function TerminalPanel() {
  const { sessions, connected } = useSessions()
  const [selected, setSelected] = useState('')
  const [position, setPosition] = useState(() => localStorage.getItem(POSITION) === 'left' ? 'left' : 'top')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [picker, setPicker] = useState(null)
  const [starting, setStarting] = useState(false)
  const current = sessions?.find(session => session.id === selected) ?? sessions?.[0]
  const tabs = useRef(null)

  useEffect(() => {
    tabs.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current?.id, position])

  async function perform(action) {
    setBusy(true)
    setError('')
    try { await action() }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  async function open(tmuxId) {
    setStarting(true)
    await perform(async () => {
      const session = await api('/sessions', 'POST', tmuxId === undefined ? {} : { tmuxId })
      setSelected(session.id)
      setPicker(null)
    })
    setStarting(false)
  }

  function close(session) {
    void perform(() => api(sessionPath(session.id), 'DELETE'))
  }

  function togglePosition() {
    const next = position === 'top' ? 'left' : 'top'
    localStorage.setItem(POSITION, next)
    setPosition(next)
  }

  function togglePicker() {
    if (picker) setPicker(null)
    else void perform(async () => setPicker(await api('/tmux')))
  }

  function handleKeys(event) {
    const direction = position === 'left' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
    if (!current || !sessions?.length || ![...direction, 'Home', 'End'].includes(event.key)) return
    const index = sessions.indexOf(current)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? sessions.length - 1
      : (index + (event.key === direction[1] ? 1 : -1) + sessions.length) % sessions.length
    event.preventDefault()
    setSelected(sessions[next].id)
    tabs.current?.querySelectorAll('[role="tab"]')[next]?.focus()
  }

  return <section className={`dsh-terminal-panel dsh-terminal-${position}`} aria-label="Terminal">
    <header className="dsh-terminal-toolbar">
      <h1>Terminal</h1>
      <div className="dsh-terminal-actions">
        <button type="button" disabled={busy || !connected} onClick={() => void open()}>New Terminal</button>
        <button type="button" disabled={busy || !connected} aria-expanded={Boolean(picker)} onClick={togglePicker}>Connect tmux</button>
        <button type="button" onClick={togglePosition}>{position === 'top' ? 'Tabs on Left' : 'Tabs on Top'}</button>
      </div>
    </header>
    {picker && <section className="dsh-terminal-picker" aria-label="tmux sessions">
      {!picker.available ? <p>Install tmux on this Mac to connect existing sessions.</p>
        : !picker.sessions.length ? <p>No running tmux sessions.</p>
          : picker.sessions.map(session => <button type="button" key={session.id} disabled={busy} onClick={() => void open(session.id)}>{session.name}</button>)}
    </section>}
    {error && <div className="dsh-terminal-notice" role="alert">{error}</div>}
    {!connected && <div className="dsh-terminal-notice" role="status">{sessions ? 'Reconnecting to Terminal…' : 'Connecting to Terminal…'}</div>}
    <div className="dsh-terminal-body">
      {Boolean(sessions?.length) && <div className="dsh-terminal-tabs" ref={tabs} role="tablist" aria-label="Terminal tabs"
        aria-orientation={position === 'left' ? 'vertical' : 'horizontal'} onKeyDown={handleKeys}>
        {sessions.map(session => <div key={session.id} className="dsh-terminal-tab" data-active={session.id === current?.id}>
          <button type="button" role="tab" id={`terminal-tab-${session.id}`} aria-selected={session.id === current?.id}
            aria-controls={session.id === current?.id ? 'dsh-terminal-current' : undefined} tabIndex={session.id === current?.id ? 0 : -1}
            title={session.title} onClick={() => setSelected(session.id)}>
            {session.title}{session.state === 'running' ? '' : ' (exited)'}
          </button>
          <button type="button" className="dsh-terminal-close" disabled={!connected || busy}
            aria-label={`${session.tmuxId ? 'Detach' : 'Close'} ${session.title}`} onClick={() => close(session)}>×</button>
        </div>)}
      </div>}
      {current ? <div role="tabpanel" className="dsh-terminal-content" id="dsh-terminal-current" aria-labelledby={`terminal-tab-${current.id}`}>
        <TerminalScreen id={current.id} key={current.id} />
      </div> : <div className="dsh-terminal-empty">{starting ? 'Opening terminal…' : connected ? 'No open terminals' : ''}</div>}
    </div>
  </section>
}
