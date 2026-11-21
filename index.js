import { BASE, terminalRoute } from './host/http.js'
import { TerminalRuntime } from './host/runtime.js'

export const name = 'dsh-terminal'
export const inject = ['webServer', 'connection', 'subprocess']

export function apply(ctx) {
  const runtime = new TerminalRuntime(ctx.subprocess)
  const disposeRoute = ctx.webServer.register({
    kind: 'prefix', path: BASE, handler: terminalRoute(ctx.connection, runtime, ctx.logger),
  })
  ctx.effect(() => async () => {
    disposeRoute()
    await runtime.dispose()
  }, 'dsh-terminal: local sessions')
}
