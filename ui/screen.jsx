import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { api, follow, sessionPath } from './api.js'
import { translateError } from './locales.js'

export function TerminalScreen({ id, t }) {
  const element = useRef(null)
  const [status, setStatus] = useState({ key: 'connecting' })
  const [error, setError] = useState(null)
  const inputLabel = t('input')

  useEffect(() => {
    const node = element.current
    const lifetime = new AbortController()
    const { signal } = lifetime
    const terminal = new Terminal({
      disableStdin: true, cursorBlink: true, scrollback: 1000, fontSize: 13, fontFamily: 'Menlo, Consolas, monospace',
      theme: { background: '#15171b', foreground: '#e4e6eb', cursor: '#dce7fb', selectionBackground: '#465978' },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(node)
    function recordDimensions() {
      node.dataset.cols = terminal.cols
      node.dataset.rows = terminal.rows
    }
    const geometry = terminal.onResize(recordDimensions)
    recordDimensions()
    function contextMenu(event) {
      if (!event.shiftKey && terminal.modes.mouseTrackingMode !== 'none') event.preventDefault()
    }
    node.addEventListener('contextmenu', contextMenu)
    const path = sessionPath(id)
    let ready = false
    let retry
    let resizeTimer
    let generation = 0
    let requestedSize = ''
    let pendingInput = 0
    let inputQueue = Promise.resolve()

    function setInputAllowed(value) {
      ready = value
      terminal.options.disableStdin = !value
    }

    function requestSize() {
      clearTimeout(resizeTimer)
      if (!ready || !node.clientWidth || !node.clientHeight) return
      resizeTimer = setTimeout(() => {
        const dimensions = fit.proposeDimensions()
        if (!ready || !dimensions) return
        const cols = Math.min(350, dimensions.cols)
        const rows = Math.min(150, dimensions.rows)
        if (cols < 2 || rows < 1 || (cols === terminal.cols && rows === terminal.rows)) return
        const key = `${cols}:${rows}`
        if (requestedSize === key) return
        requestedSize = key
        void api(`${path}/size`, 'POST', { cols, rows }, signal).catch(failure => {
          if (requestedSize === key) requestedSize = ''
          if (!signal.aborted && ready) setError(failure)
        })
      }, 60)
    }

    const input = terminal.onData(data => {
      if (!ready) return
      if (pendingInput + data.length > 128 * 1024) {
        setError({ code: 'inputBusy' })
        return
      }
      const inputGeneration = generation
      pendingInput += data.length
      inputQueue = inputQueue.then(async () => {
        if (!ready || signal.aborted || inputGeneration !== generation) return
        await api(`${path}/input`, 'POST', { data }, signal)
      }).catch(failure => {
        if (!signal.aborted) setError(failure)
      }).finally(() => { pendingInput -= data.length })
    })
    const observer = new ResizeObserver(requestSize)
    observer.observe(node)

    const write = text => new Promise(resolve => {
      const finish = () => {
        signal.removeEventListener('abort', finish)
        resolve()
      }
      signal.addEventListener('abort', finish, { once: true })
      terminal.write(text, finish)
    })
    const connect = async () => {
      try {
        await follow(id, signal, async frame => {
          if (signal.aborted) return
          if (frame.type === 'output') return write(frame.data)
          const session = frame.session
          if (frame.type === 'snapshot') {
            terminal.reset()
            terminal.resize(session.cols, session.rows)
            await write(frame.screen)
            if (signal.aborted) return
            setError(null)
            requestedSize = ''
          } else {
            terminal.resize(session.cols, session.rows)
          }
          const running = session.state === 'running'
          setInputAllowed(running)
          setStatus(running ? null : session.exitCode == null ? { key: 'disconnected' }
            : { key: 'exited', params: { code: session.exitCode } })
          if (frame.type === 'snapshot' && running) {
            terminal.focus()
            requestSize()
          }
        })
        if (!signal.aborted) {
          setInputAllowed(false)
          setStatus({ key: 'closed' })
        }
      } catch {
        if (signal.aborted) return
        generation += 1
        setInputAllowed(false)
        setStatus({ key: 'reconnecting' })
        retry = setTimeout(connect, 900)
      }
    }
    void connect()
    return () => {
      lifetime.abort()
      clearTimeout(retry)
      clearTimeout(resizeTimer)
      observer.disconnect()
      geometry.dispose()
      node.removeEventListener('contextmenu', contextMenu)
      input.dispose()
      terminal.dispose()
    }
  }, [id])

  useEffect(() => {
    element.current?.querySelector('textarea')?.setAttribute('aria-label', inputLabel)
  }, [id, inputLabel])

  return <div className="dsh-terminal-screen">
    {status && <div role="status" className="dsh-terminal-status">{t(status.key, status.params)}</div>}
    <div ref={element} className="dsh-terminal-viewport" />
    {error && <div role="alert" className="dsh-terminal-alert">{translateError(t, error)}</div>}
  </div>
}
