// Renders the social cards from one template, in the site's own look (dark theme, Geist, JetBrains Mono):
//   docs/social-preview.{svg,png}  1280×640  GitHub repo Settings → Social preview
//   site/public/og.png             1200×630  Open Graph / Twitter card
//   site/public/icon-{180,512}.png           apple-touch-icon and web manifest icons
// Usage: node site/scripts/make-social.mjs   (needs Google Chrome for the PNGs)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(site, '..')
const font = (p) => readFileSync(join(site, 'node_modules', p)).toString('base64')
const geist = font('@fontsource-variable/geist/files/geist-latin-wght-normal.woff2')
const mono = font('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2')
const { version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const GH =
  'M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49l-.01-1.7c-2.78.62-3.37-1.21-3.37-1.21-.46-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.56 2.35 1.11 2.92.85.09-.66.35-1.11.64-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.4 9.4 0 0 1 12 6.98c.85 0 1.71.12 2.51.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.64 1.03 2.76 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9l-.01 2.82c0 .27.18.6.69.49A10.24 10.24 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z'
const NPM =
  'M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z'

function card(w, h) {
  const s = w / 1280 // everything is laid out for 1280 and scaled
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<foreignObject x="0" y="0" width="${w}" height="${h}">
<div xmlns="http://www.w3.org/1999/xhtml" class="c">
<style>
@font-face{font-family:G;src:url(data:font/woff2;base64,${geist}) format('woff2');font-weight:100 900}
@font-face{font-family:M;src:url(data:font/woff2;base64,${mono}) format('woff2');font-weight:100 800}
*{box-sizing:border-box;margin:0}
.c{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:#0c0c0b;color:#edece8;font-family:G,sans-serif;
  padding:${60 * s}px ${80 * s}px ${64 * s}px;display:flex;flex-direction:column;justify-content:space-between}
.c::before{content:'';position:absolute;inset:0;background-image:radial-gradient(rgba(237,236,232,.13) 1px,transparent 1.2px);
  background-size:${22 * s}px ${22 * s}px;mask-image:radial-gradient(ellipse 80% 90% at 70% 40%,#000 10%,transparent 75%)}
.c::after{content:'';position:absolute;left:45%;top:5%;width:110%;height:110%;background:radial-gradient(closest-side,rgba(247,112,63,.12),transparent)}
.c>*{position:relative;z-index:1}
.top{display:flex;align-items:center;justify-content:space-between;font-family:M;font-size:${22 * s}px;color:#a8a7a1}
.repo{display:flex;align-items:center;gap:${12 * s}px}.repo b{color:#edece8;font-weight:600}
.top svg{width:${26 * s}px;height:${26 * s}px;fill:#edece8}
.ver{border:1px solid rgba(237,236,232,.15);border-radius:99px;padding:${6 * s}px ${16 * s}px;font-size:${18 * s}px}
.id{display:flex;align-items:center;gap:${22 * s}px;margin-bottom:${26 * s}px}
.logo{position:absolute;right:${96 * s}px;top:50%;transform:translateY(-46%) rotate(-6deg);width:${232 * s}px;height:${232 * s}px;
  filter:drop-shadow(0 ${30 * s}px ${60 * s}px rgba(0,0,0,.6)) drop-shadow(0 0 ${80 * s}px rgba(247,112,63,.18))}
.logo svg{width:100%;height:100%}
.name{font-family:M;font-weight:600;font-size:${30 * s}px;letter-spacing:-.01em}
.name i{font-style:normal;color:#85847e}
h1{font-size:${72 * s}px;font-weight:560;line-height:1.02;letter-spacing:-.045em;max-width:${820 * s}px}
.cut{position:relative;color:#85847e;white-space:nowrap}
.cut::after{content:'';position:absolute;left:-2%;right:-2%;top:55%;height:.06em;background:#f7703f}
.sub{margin-top:${20 * s}px;font-size:${25 * s}px;line-height:1.4;color:#a8a7a1;letter-spacing:-.015em;max-width:${740 * s}px}
.cmd{display:inline-flex;align-items:center;gap:${14 * s}px;align-self:flex-start;padding:${16 * s}px ${22 * s}px;border-radius:${14 * s}px;
  border:1px solid rgba(237,236,232,.15);background:rgba(20,20,19,.9);font-family:M;font-size:${24 * s}px}
.cmd svg{width:${26 * s}px;height:${26 * s}px;fill:#cb3837}.cmd .p{color:#85847e}
</style>
<div class="top">
  <span class="repo"><svg viewBox="0 0 24 24"><path d="${GH}"/></svg>shubhamcodess / <b>mcp-token-optimizer</b></span>
  <span class="ver">v${version} · Apache-2.0</span>
</div>
<div>
  <div class="id"><span class="name">mto <i>· mcp-token-optimizer</i></span></div>
  <h1>Stop paying for<br/>tool&#8209;response <span class="cut">noise</span>.</h1>
  <p class="sub">A local proxy between your AI agent and its MCP servers. Shrinks every tool response, keeps the original, cuts token cost.</p>
</div>
<div class="logo"><svg viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#edece8"/><path d="M6 8.5h12M6 12h8M6 15.5h10" stroke="#0c0c0b" stroke-width="1.8" stroke-linecap="round"/><path d="M4.5 12.2h15" stroke="#f7703f" stroke-width="1.6" stroke-linecap="round"/></svg></div>
<div class="cmd"><svg viewBox="0 0 24 24"><path d="${NPM}"/></svg><span><span class="p">$ </span>npm install -g @shubhamcodess/mcp-token-optimizer</span></div>
</div>
</foreignObject>
</svg>
`
}

const tmp = mkdtempSync(join(tmpdir(), 'mto-social-'))
for (const [w, h, out] of [
  [1280, 640, join(repo, 'docs/social-preview')],
  [1200, 630, join(site, 'public/og')],
]) {
  const svg = card(w, h)
  if (w === 1280) writeFileSync(`${out}.svg`, svg)
  const html = join(tmp, `${w}.html`)
  writeFileSync(html, `<!doctype html><style>html,body{margin:0;background:#0c0c0b}</style>${svg}`)
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${w},${h}`, `--screenshot=${out}.png`, '--virtual-time-budget=2000', `file://${html}`,
  ], { stdio: 'ignore' })
  console.log(`${out}.png  ${w}×${h}`)
}

// App icons: the brand mark on the page background, with breathing room for maskable crops
for (const size of [180, 512]) {
  const out = join(site, `public/icon-${size}.png`)
  const html = join(tmp, `icon-${size}.html`)
  const m = Math.round(size * 0.64)
  writeFileSync(
    html,
    `<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;background:#0c0c0b;display:grid;place-items:center}</style>
<svg width="${m}" height="${m}" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#edece8"/><path d="M6 8.5h12M6 12h8M6 15.5h10" stroke="#0c0c0b" stroke-width="1.8" stroke-linecap="round"/><path d="M4.5 12.2h15" stroke="#f7703f" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  )
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${size},${size}`, `--screenshot=${out}`, `file://${html}`], { stdio: 'ignore' })
  console.log(`${out}  ${size}×${size}`)
}
