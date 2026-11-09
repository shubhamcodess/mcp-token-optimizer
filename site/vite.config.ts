import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const root = resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

// The public site URL (absolute, trailing slash). Override with SITE_URL for a custom domain.
const { version: VERSION } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }
const SITE_URL = (process.env.SITE_URL ?? 'https://shubhamcodess.github.io/mcp-token-optimizer/').replace(/\/?$/, '/')

/** Release date, test and smoke-check counts, read from the repo so the page never goes stale. */
function buildFacts() {
  const { version } = JSON.parse(read('package.json')) as { version: string }
  const iso = read('CHANGELOG.md').match(new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - (\\d{4}-\\d{2}-\\d{2})`, 'm'))?.[1]
  const releaseDate = iso
    ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : ''
  const tests = readdirSync(resolve(root, 'tests'))
    .filter((f) => f.endsWith('.test.ts'))
    .reduce((n, f) => n + (read(`tests/${f}`).match(/^\s*(?:it|test)\(/gm)?.length ?? 0), 0)
  const smoke = read('scripts/smoke.mjs').match(/^\s*check\(/gm)?.length ?? 0
  return { releaseDate, tests, smoke }
}

/** robots.txt, sitemap.xml, llms.txt and llms-full.txt, plus %SITE_URL% in the HTML. */
function seo(): Plugin {
  const docs = ['README.md', 'docs/getting-started.md', 'docs/how-it-works.md', 'docs/reference.md', 'docs/tuning.md', 'docs/dashboard.md', 'TROUBLESHOOTING.md']
  const blob = 'https://github.com/shubhamcodess/mcp-token-optimizer/blob/main/'
  return {
    name: 'mto-seo',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE_URL).replaceAll('%VERSION%', VERSION),
    generateBundle(options) {
      if (options.format !== 'es' || this.environment?.name === 'ssr') return
      const emit = (fileName: string, source: string) => this.emitFile({ type: 'asset', fileName, source })
      const today = new Date().toISOString().slice(0, 10)
      emit('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`)
      emit(
        'sitemap.xml',
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          [SITE_URL, `${SITE_URL}docs/`].map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
          `\n</urlset>\n`,
      )
      emit(
        'llms.txt',
        `# mcp-token-optimizer (mto)

> A self-hosted proxy between an AI coding agent and its MCP servers. It shrinks every tool response (pruning, TOON encoding, optional local-LLM summarization through Ollama), keeps the original recoverable through the \`mto_expand\` tool, and fails open: on any error the original response is forwarded. Open source (Apache-2.0), runs on your machine, no telemetry.

Install: \`npm install -g @shubhamcodess/mcp-token-optimizer\` (Node 20+). The CLI is \`mto\`. Start in shadow mode, which measures savings while still forwarding the originals.

Works with any MCP-capable agent: VS Code Copilot, Claude Code, Cursor, Windsurf and others.

## Docs

- [Full documentation as one file](${SITE_URL}llms-full.txt): README plus every guide, plain Markdown
- [Docs page](${SITE_URL}docs/): install, modes, profiles, formats, HTTP proxy, mto_expand, CLI
- [Getting started](${blob}docs/getting-started.md)
- [How it works](${blob}docs/how-it-works.md)
- [Reference](${blob}docs/reference.md)
- [Tuning](${blob}docs/tuning.md)
- [Troubleshooting](${blob}TROUBLESHOOTING.md)

## Project

- [Source code](https://github.com/shubhamcodess/mcp-token-optimizer)
- [npm package](https://www.npmjs.com/package/@shubhamcodess/mcp-token-optimizer)
- [Changelog](${blob}CHANGELOG.md)
- [Testing and benchmarks](${blob}TESTING.md)
- [Security](${blob}SECURITY.md)
`,
      )
      emit(
        'llms-full.txt',
        `# mcp-token-optimizer: full documentation\n\nSource: https://github.com/shubhamcodess/mcp-token-optimizer\n\n` +
          docs.map((d) => `<!-- ${d} -->\n\n${read(d).trim()}\n`).join('\n---\n\n'),
      )
    },
  }
}

/**
 * Build-only head hardening and speed-ups that GitHub Pages cannot do with response headers:
 * - Content-Security-Policy as a <meta>, with the inline theme script allowed by its hash.
 *   (frame-ancestors, X-Frame-Options, nosniff and Permissions-Policy only work as real headers.)
 * - Referrer-Policy as a <meta>.
 * - Preload of the two Latin font files the first screen uses.
 */
function headHardening(): Plugin {
  let base = '/'
  return {
    name: 'mto-head',
    apply: 'build',
    configResolved(config) {
      base = config.base
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
          (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
        )
        const csp = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(' ')}`,
          // React style props (reveal delays, widths) are inline style attributes
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https:",
          "font-src 'self' data:",
          // live npm downloads and GitHub stars
          'connect-src https://api.npmjs.org https://api.github.com',
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'none'",
          'upgrade-insecure-requests',
        ].join('; ')
        const fonts = Object.keys(ctx.bundle ?? {})
          .filter((f) => /(geist|jetbrains-mono)-latin-wght-normal-[\w-]+\.woff2$/.test(f))
          .map((f) => `    <link rel="preload" href="${base}${f}" as="font" type="font/woff2" crossorigin />`)
        const head = [
          `    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
          '    <meta name="referrer" content="strict-origin-when-cross-origin" />',
          ...fonts,
        ].join('\n')
        return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n${head}`)
      },
    },
  }
}

// GitHub Pages serves project sites from /<repo>/. Override with BASE_PATH=/ for a custom domain.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/mcp-token-optimizer/',
  plugins: [react(), seo(), headHardening()],
  define: {
    __BUILD_FACTS__: JSON.stringify(buildFacts()),
    __SITE_URL__: JSON.stringify(SITE_URL),
  },
  // the docs page renders the repository README, one level up
  server: { fs: { allow: ['..'] } },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        docs: resolve(import.meta.dirname, 'docs/index.html'),
        404: resolve(import.meta.dirname, '404.html'),
      },
    },
  },
})
