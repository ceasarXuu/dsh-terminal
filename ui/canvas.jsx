import React, { useEffect, useRef, useState } from 'react'
import { TerminalScreen } from './screen.jsx'

export const WINDOW_DRAG_TYPE = 'application/x-dsh-terminal-tmux-window'

function dropPreview(container, panes, topOffset, event) {
  const viewport = container.querySelector('.dsh-terminal-viewport')
  const grid = viewport?.querySelector('.xterm-screen')?.getBoundingClientRect()
  const cols = Number(viewport?.dataset.cols)
  const rows = Number(viewport?.dataset.rows)
  if (!grid?.width || !grid.height || !cols || !rows) return null

  const cellWidth = grid.width / cols
  const cellHeight = grid.height / rows
  const x = (event.clientX - grid.left) / cellWidth
  const y = (event.clientY - grid.top) / cellHeight - topOffset
  const possible = panes.filter(pane => x >= pane.left && x < pane.left + pane.width
    && y >= pane.top && y < pane.top + pane.height)
  const pane = possible.find(item => item.active) ?? possible.at(-1)
  if (!pane) return null

  const horizontal = (x - pane.left) / pane.width
  const vertical = (y - pane.top) / pane.height
  const distances = { left: horizontal, right: 1 - horizontal, top: vertical, bottom: 1 - vertical }
  const side = Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0]
  const bounds = container.getBoundingClientRect()
  const width = pane.width * cellWidth
  const height = pane.height * cellHeight
  const splitX = side === 'left' || side === 'right'
  return {
    target: pane.id,
    side,
    style: {
      left: grid.left - bounds.left + pane.left * cellWidth + (side === 'right' ? width / 2 : 0),
      top: grid.top - bounds.top + (pane.top + topOffset) * cellHeight + (side === 'bottom' ? height / 2 : 0),
      width: splitX ? width / 2 : width,
      height: splitX ? height : height / 2,
    },
  }
}

export function TmuxCanvasView({ canvas, active, source, onJoin, onAttach }) {
  const [preview, setPreview] = useState(null)
  const container = useRef(null)
  useEffect(() => { setPreview(null) }, [active.id, source])
  useEffect(() => {
    container.current?.querySelector('textarea[aria-label="Terminal input"]')?.focus()
  }, [active.id])

  function plan(event) {
    if (!source || source === active.id || !event.dataTransfer.types.includes(WINDOW_DRAG_TYPE)) return null
    return dropPreview(event.currentTarget, canvas.panes, canvas.top, event)
  }

  function hover(event) {
    const position = plan(event)
    if (position) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    }
    setPreview(position)
  }

  function drop(event) {
    const position = plan(event)
    setPreview(null)
    if (!position || event.dataTransfer.getData(WINDOW_DRAG_TYPE) !== source) return
    event.preventDefault()
    onJoin({ source, target: position.target, side: position.side })
  }

  return <div className="dsh-terminal-canvas" ref={container} onDragOver={hover} onDrop={drop}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPreview(null) }}>
    {canvas.streamId && <TerminalScreen id={canvas.streamId} key={canvas.streamId} />}
    {!canvas.attached && <button type="button" className="dsh-terminal-reattach" onClick={onAttach}>Attach tmux</button>}
    {preview && <div className="dsh-terminal-drop-preview" style={preview.style} data-side={preview.side} aria-hidden="true" />}
  </div>
}
