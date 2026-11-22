import React from 'react'
import terminalCSS from '@xterm/xterm/css/xterm.css'
import panelCSS from './style.css'
import { TerminalPanel } from './panel.jsx'
import { dictionaries, namespace } from './locales.js'

export const inject = ['slots', 'locale']

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(namespace, dictionaries), 'dsh-terminal: translations')
  const t = ctx.locale.bind(namespace)
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = `${terminalCSS}\n${panelCSS}`
    document.head.append(style)
    return () => { style.remove() }
  }, 'dsh-terminal: styles')
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'terminal', locale: namespace,
  }, TerminalPanel)), 'dsh-terminal: main panel')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: 'terminal', order: -9, label: () => t('terminal'),
  }, () => <span className="dsh-terminal-icon" aria-hidden="true">&gt;_</span>)), 'dsh-terminal: entry')
}
