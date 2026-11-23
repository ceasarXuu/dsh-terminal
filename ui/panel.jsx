import React, { useEffect, useRef, useState } from 'react'
import { api, events, sessionPath } from './api.js'
import { translateError } from './locales.js'
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

export function TerminalPanel({ t }) {
  const { sessions, connected } = useSessions()
  const [selected, setSelected] = useState('')
  const [position, setPosition] = useState(() => localStorage.getItem(POSITION) === 'left' ? 'left' : 'top')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [starting, setStarting] = useState(false)
  const entries = sessions ?? []
  const current = entries.find(session => session.id === selected) ?? entries[0]
  const tabs = useRef(null)

  useEffect(() => {
    tabs.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current?.id, position])

  async function perform(action) {
    setBusy(true)
    setError(null)
    try { await action() }
    catch (failure) { setError(failure) }
    finally { setBusy(false) }
  }

  async function open() {
    setStarting(true)
    await perform(async () => {
      const session = await api('/sessions', 'POST', {})
      setSelected(session.id)
    })
    setStarting(false)
  }

  function close(entry) {
    void perform(() => api(sessionPath(entry.id), 'DELETE'))
  }

  function togglePosition() {
    const next = position === 'top' ? 'left' : 'top'
    localStorage.setItem(POSITION, next)
    setPosition(next)
  }

  function handleKeys(event) {
    const direction = position === 'left' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
    if (!current || ![...direction, 'Home', 'End'].includes(event.key)) return
    const index = entries.indexOf(current)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1
      : (index + (event.key === direction[1] ? 1 : -1) + entries.length) % entries.length
    event.preventDefault()
    setSelected(entries[next].id)
    tabs.current?.querySelectorAll('[role="tab"]')[next]?.focus()
  }

  return <section className={`dsh-terminal-panel dsh-terminal-${position}`} aria-label={t('terminal')}>
    <header className="dsh-terminal-toolbar">
      <h1>{t('terminal')}</h1>
      <div className="dsh-terminal-actions">
        <button type="button" disabled={busy || !connected} onClick={() => void open()}>{t('newTerminal')}</button>
        <button type="button" onClick={togglePosition}>{t(position === 'top' ? 'tabsOnLeft' : 'tabsOnTop')}</button>
      </div>
    </header>
    {error && <div className="dsh-terminal-notice" role="alert">{translateError(t, error)}</div>}
    {!connected && <div className="dsh-terminal-notice" role="status">{t(sessions ? 'reconnecting' : 'connecting')}</div>}
    <div className="dsh-terminal-body">
      {Boolean(entries.length) && <div className="dsh-terminal-tabs" ref={tabs} role="tablist" aria-label={t('tabs')}
        aria-orientation={position === 'left' ? 'vertical' : 'horizontal'} onKeyDown={handleKeys}>
        {entries.map(entry => <div key={entry.id} className="dsh-terminal-tab" data-active={entry.id === current?.id}>
          <button type="button" role="tab" id={`terminal-tab-${entry.id}`} aria-selected={entry.id === current?.id}
            aria-controls={entry.id === current?.id ? 'dsh-terminal-current' : undefined} tabIndex={entry.id === current?.id ? 0 : -1}
            title={entry.title} onClick={() => setSelected(entry.id)}>
            {entry.state === 'running' ? entry.title : t('exitedTab', { title: entry.title })}
          </button>
          <button type="button" className="dsh-terminal-close" disabled={!connected || busy}
            aria-label={t('closeTab', { title: entry.title })} onClick={() => close(entry)}>×</button>
        </div>)}
      </div>}
      {current ? <div role="tabpanel" className="dsh-terminal-content" id="dsh-terminal-current" aria-labelledby={`terminal-tab-${current.id}`}>
        <TerminalScreen t={t} id={current.id} key={current.id} />
      </div> : <div className="dsh-terminal-empty">{starting ? t('opening') : connected ? t('empty') : ''}</div>}
    </div>
  </section>
}
