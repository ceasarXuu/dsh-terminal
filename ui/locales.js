export const namespace = 'dshTerminal'

const zh = {
  terminal: '终端',
  newTerminal: '新建终端',
  tabsOnLeft: '标签栏移到左侧',
  tabsOnTop: '标签栏移到顶部',
  connecting: '正在连接终端…',
  reconnecting: '正在重新连接终端…',
  opening: '正在打开终端…',
  empty: '暂无终端',
  tabs: '终端标签栏',
  exitedTab: '{title}（已退出）',
  closeTab: '关闭 {title}',
  input: '终端输入',
  closed: '终端已关闭',
  disconnected: '终端已断开连接',
  exited: '进程已退出（{code}）',
  'error.operationFailed': '暂时无法完成终端操作。',
  'error.unauthorized': '当前 DSH 会话没有终端访问权限。',
  'error.localOnly': '终端仅在本机 DSH 桌面端可用。',
  'error.invalidRequest': '终端请求无效。',
  'error.inputBusy': '终端输入繁忙，请稍后再粘贴。',
  'error.invalidInput': '终端输入无效，或粘贴内容超过 64 KiB。',
  'error.terminalUnavailable': '此终端已关闭或不可用。',
  'error.terminalStopped': '此终端已停止运行。',
  'error.terminalLimit': '最多可打开 {limit} 个终端，请先关闭不用的终端。',
}

const en = {
  terminal: 'Terminal',
  newTerminal: 'New Terminal',
  tabsOnLeft: 'Tabs on Left',
  tabsOnTop: 'Tabs on Top',
  connecting: 'Connecting to Terminal…',
  reconnecting: 'Reconnecting to Terminal…',
  opening: 'Opening terminal…',
  empty: 'No open terminals',
  tabs: 'Terminal tabs',
  exitedTab: '{title} (exited)',
  closeTab: 'Close {title}',
  input: 'Terminal input',
  closed: 'Terminal closed',
  disconnected: 'Terminal disconnected',
  exited: 'Process exited ({code})',
  'error.operationFailed': 'Unable to complete the terminal operation.',
  'error.unauthorized': 'This DSH session is not authorized to access Terminal.',
  'error.localOnly': 'Terminal is available in the local DSH desktop interface.',
  'error.invalidRequest': 'Invalid terminal request.',
  'error.inputBusy': 'Terminal input is busy. Wait before pasting again.',
  'error.invalidInput': 'Invalid terminal input or paste larger than 64 KiB.',
  'error.terminalUnavailable': 'This terminal was closed or is unavailable.',
  'error.terminalStopped': 'This terminal is no longer running.',
  'error.terminalLimit': 'Close a terminal before opening another. Up to {limit} terminals can be open.',
}

export const dictionaries = { zh, en }

export function translateError(t, error) {
  const key = `error.${error.code}`
  return Object.hasOwn(en, key) ? t(key, error.params) : t('error.operationFailed')
}
