import { mkdir, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import manifest from './package.json' with { type: 'json' }

const bundle = await build({
  entryPoints: ['ui/client.jsx'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
  external: ['react'], loader: { '.css': 'text' }, write: false,
})
const code = `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {
  const module = { exports: {} };
  const exports = module.exports;
  ${bundle.outputFiles[0].text}
  return module.exports;
} });\n`
await mkdir('lib', { recursive: true })
await writeFile('lib/client.js', code)
