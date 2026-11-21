import { BASE, terminalRoute } from './host/http.js'
import { TerminalRuntime } from './host/runtime.js'

export const name = 'dsh-terminal'
export const inject = ['webServer', 'connection', 'subprocess', 'profileContext']

export async function apply(ctx) {
  const runtime = new TerminalRuntime(ctx.subprocess, ctx.profileContext.dir, ctx.logger)
  const disposeRoute = ctx.webServer.register({
    kind: 'prefix', path: BASE, handler: terminalRoute(ctx.connection, runtime, ctx.logger),
  })
  ctx.effect(() => async () => {
    disposeRoute()
    await runtime.dispose()
  }, 'dsh-terminal: local sessions')
  await runtime.canvas.start().catch(error => ctx.logger.warn('Terminal canvas startup failed: %s', error.message))
}
