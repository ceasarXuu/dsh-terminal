import React, { useEffect, useRef, useState } from 'react'
import { api, events, sessionPath } from './api.js'
import { TmuxCanvasView, WINDOW_DRAG_TYPE } from './canvas.jsx'
import { translateError } from './locales.js'
import { TerminalScreen } from './screen.jsx'

const POSITION = '@ceasarxuu/dsh-terminal:tabs'
const canvasAction = (method, body = {}) => api(`/canvas/${method}`, 'POST', body)

function useSessions() {
  const [catalog, setCatalog] = useState(null)
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    const source = events()
    source.onmessage = ({ data }) => {
      const frame = JSON.parse(data)
      if (frame.type !== 'sessions') return
      setCatalog(frame)
      setConnected(true)
    }
    source.onerror = () => setConnected(false)
    return () => source.close()
  }, [])
  return { catalog, connected }
}

export function TerminalPanel({ t }) {
  const { catalog, connected } = useSessions()
  const [selected, setSelected] = useState('')
  const [position, setPosition] = useState(() => localStorage.getItem(POSITION) === 'left' ? 'left' : 'top')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [picker, setPicker] = useState(null)
  const [starting, setStarting] = useState(false)
  const [dragSource, setDragSource] = useState(null)
  const canvas = catalog?.canvas
  const windows = canvas?.windows.map(window => ({ ...window, native: true })) ?? []
  const sessions = catalog?.sessions ?? []
  const entries = [...windows, ...sessions]
  const activeWindow = windows.find(window => window.active)
  const current = sessions.find(session => session.id === selected) ?? activeWindow ?? entries[0]
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

  async function open(tmuxId) {
    setStarting(true)
    await perform(async () => {
      if (tmuxId === undefined && canvas?.available) {
        await canvasAction('new')
        setSelected('')
      } else {
        const session = await api('/sessions', 'POST', tmuxId === undefined ? {} : { tmuxId })
        setSelected(session.id)
      }
      setPicker(null)
    })
    setStarting(false)
  }

  function select(entry) {
    if (!entry.native) return setSelected(entry.id)
    if (entry.active) return setSelected('')
    void perform(async () => {
      await canvasAction('select', { windowId: entry.id })
      setSelected('')
    })
  }

  function close(entry) {
    void perform(() => entry.native ? canvasAction('close', { windowId: entry.id }) : api(sessionPath(entry.id), 'DELETE'))
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
    if (!current || ![...direction, 'Home', 'End'].includes(event.key)) return
    const index = entries.indexOf(current)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1
      : (index + (event.key === direction[1] ? 1 : -1) + entries.length) % entries.length
    event.preventDefault()
    select(entries[next])
    tabs.current?.querySelectorAll('[role="tab"]')[next]?.focus()
  }

  function startDrag(event, id) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(WINDOW_DRAG_TYPE, id)
    setDragSource(id)
  }

  function join(args) {
    setDragSource(null)
    void perform(() => canvasAction('join', args))
  }

  return <section className={`dsh-terminal-panel dsh-terminal-${position}`} aria-label={t('terminal')}>
    <header className="dsh-terminal-toolbar">
      <h1>{t('terminal')}</h1>
      <div className="dsh-terminal-actions">
        <button type="button" disabled={busy || !connected} onClick={() => void open()}>{t('newTerminal')}</button>
        <button type="button" disabled={busy || !connected} aria-expanded={Boolean(picker)} onClick={togglePicker}>{t('connectTmux')}</button>
        <button type="button" onClick={togglePosition}>{t(position === 'top' ? 'tabsOnLeft' : 'tabsOnTop')}</button>
        {current?.native && current.panes > 1 && <button type="button" disabled={busy || !connected}
          title={t('breakPaneHelp')} onClick={() => void perform(() => canvasAction('break'))}>{t('breakPane')}</button>}
      </div>
    </header>
    {picker && <section className="dsh-terminal-picker" aria-label={t('tmuxSessions')}>
      {!picker.available ? <p>{t('installTmux')}</p>
        : !picker.sessions.length ? <p>{t('noTmuxSessions')}</p>
          : picker.sessions.map(session => <button type="button" key={session.id} disabled={busy} onClick={() => void open(session.id)}>{session.name}</button>)}
    </section>}
    {error && <div className="dsh-terminal-notice" role="alert">{translateError(t, error)}</div>}
    {!connected && <div className="dsh-terminal-notice" role="status">{t(catalog ? 'reconnecting' : 'connecting')}</div>}
    <div className="dsh-terminal-body">
      {Boolean(entries.length) && <div className="dsh-terminal-tabs" ref={tabs} role="tablist" aria-label={t('tabs')}
        aria-orientation={position === 'left' ? 'vertical' : 'horizontal'} onKeyDown={handleKeys}>
        {entries.map(entry => <div key={entry.id} className="dsh-terminal-tab" data-active={entry.id === current?.id}>
          <button type="button" role="tab" id={`terminal-tab-${entry.id}`} aria-selected={entry.id === current?.id}
            aria-controls={entry.id === current?.id ? 'dsh-terminal-current' : undefined} tabIndex={entry.id === current?.id ? 0 : -1}
            draggable={entry.native && connected && !busy} onDragStart={event => startDrag(event, entry.id)} onDragEnd={() => setDragSource(null)}
            title={entry.title} onClick={() => select(entry)}>
            {tabTitle(t, entry)}
          </button>
          <button type="button" className="dsh-terminal-close" disabled={!connected || busy}
            aria-label={t(entry.tmuxId ? 'detachTab' : 'closeTab', { title: entry.title })} onClick={() => close(entry)}>×</button>
        </div>)}
      </div>}
      {current ? <div role="tabpanel" className="dsh-terminal-content" id="dsh-terminal-current" aria-labelledby={`terminal-tab-${current.id}`}>
        {current.native ? <TmuxCanvasView t={t} canvas={canvas} active={current} source={dragSource} onJoin={join}
          onAttach={() => void perform(() => canvasAction('attach'))} /> : <TerminalScreen t={t} id={current.id} key={current.id} />}
      </div> : <div className="dsh-terminal-empty">{starting ? t('opening') : connected ? t('empty') : ''}</div>}
    </div>
  </section>
}

function tabTitle(t, entry) {
  if (entry.native && entry.panes > 1) return t('panesTab', { title: entry.title, count: entry.panes })
  if (!entry.native && entry.state !== 'running') return t('exitedTab', { title: entry.title })
  return entry.title
}
