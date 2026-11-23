import { BASE, terminalRoute } from './host/http.js'
import { TerminalRuntime } from './host/runtime.js'

export const name = 'dsh-terminal'
// `connection.admit()` verifies the request through the `connection.authentication`
// sub-service. Cordis resolves that inner read against this plugin's own fiber, so
// DSH requires the sub-service to be declared even though only `connection` is used.
export const inject = ['webServer', 'connection', 'connection.authentication', 'subprocess']

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
