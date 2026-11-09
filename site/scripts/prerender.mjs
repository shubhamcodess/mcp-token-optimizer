// Fills <div id="root"><!--app--></div> in the built pages with server-rendered HTML.
// Runs after `vite build` and `vite build --ssr src/entry-server.tsx --outDir dist-ssr`.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { render } = await import(pathToFileURL(join(site, 'dist-ssr/entry-server.js')).href)

for (const [page, file] of [
  ['home', 'dist/index.html'],
  ['docs', 'dist/docs/index.html'],
]) {
  const path = join(site, file)
  const html = readFileSync(path, 'utf8')
  if (!html.includes('<!--app-->')) throw new Error(`${file}: no <!--app--> placeholder`)
  const body = render(page)
  writeFileSync(path, html.replace('<!--app-->', () => body))
  console.log(`prerendered ${file} (${Math.round(body.length / 1024)} KB)`)
}
rmSync(join(site, 'dist-ssr'), { recursive: true, force: true })
