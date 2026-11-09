import { version } from '../../package.json'

export const REPO = 'https://github.com/shubhamcodess/mcp-token-optimizer'
export const VERSION: string = version
export const AUTHOR = 'Shubham Prakash'
export const GITHUB_USER = 'shubhamcodess'
// Set to the author's LinkedIn profile URL to show the link in the Maker section.
export const LINKEDIN = 'https://www.linkedin.com/in/shubham-prakash-dev/'
// 0.1.0 and 0.2.0 were attached as mcp-token-optimizer-<version>.tgz; from 0.2.1 the tarball is shubhamcodess-mcp-token-optimizer-<version>.tgz
export const TARBALL = ['0.1.0', '0.2.0'].includes(VERSION) ? `mcp-token-optimizer-${VERSION}.tgz` : `shubhamcodess-mcp-token-optimizer-${VERSION}.tgz`
export const TARBALL_URL = `${REPO}/releases/download/v${VERSION}/${TARBALL}`

export const LATEST_URL = `${REPO}/releases/latest`
// Resolves the newest release's .tgz through the GitHub API, so the command never goes stale.
export const DOWNLOAD_LATEST = `curl -fsSL https://api.github.com/repos/${GITHUB_USER}/mcp-token-optimizer/releases/latest | grep -o '"browser_download_url": *"[^"]*\\.tgz"' | cut -d'"' -f4 | xargs curl -fsSLO`
export const INSTALL_LATEST = 'npm install -g ./*mcp-token-optimizer-*.tgz' // matches the old (0.2.0) and scoped tarball names
export const INSTALL_ONE_LINER = `${DOWNLOAD_LATEST} && ${INSTALL_LATEST}`
// the unscoped name belongs to another project on npm: always use the scoped package
export const PACKAGE = '@shubhamcodess/mcp-token-optimizer'
export const NPM_URL = `https://www.npmjs.com/package/${PACKAGE}`

export const INSTALLERS = [
  { id: 'npm', cmd: `npm install -g ${PACKAGE}` },
  { id: 'pnpm', cmd: `pnpm add -g ${PACKAGE}`, hint: 'First global install? Run pnpm setup once.' },
  { id: 'yarn', cmd: `yarn global add ${PACKAGE}`, hint: 'Yarn 1 only. Yarn 2+ has no global install.' },
  { id: 'bun', cmd: `bun add -g ${PACKAGE}`, hint: 'Runs on Node, so Node 20+ must be installed.' },
  { id: 'release', cmd: INSTALL_ONE_LINER, hint: 'releases' },
] as const
export type InstallerId = (typeof INSTALLERS)[number]['id']




export interface Bench {
  name: string
  original: number
  sent: number
  saved: number
  note?: string
}

export const BENCHMARKS: Bench[] = [
  { name: 'CI build log', original: 4926, sent: 78, saved: 98.4 },
  { name: 'GitHub issue list, 40 issues', original: 37355, sent: 13244, saved: 64.5 },
  {
    name: 'Kubernetes ConfigMap, live MCP server',
    original: 24616,
    sent: 12617,
    saved: 48.7,
    note: 'Copilot A/B run. The three files the agent wrote were byte-identical to the original data.',
  },
  { name: 'Kubernetes describe + manifest', original: 3637, sent: 1935, saved: 46.8 },
  { name: 'HTML runbook page', original: 1198, sent: 863, saved: 28.0 },
]

export const fmt = (n: number) => n.toLocaleString('en-US')

/* ---------- Launch and social proof ---------- */

// The public site URL (set in vite.config.ts; SITE_URL env overrides it for a custom domain).
export const SITE_URL: string = __SITE_URL__
export const TITLE = 'mto: shrink MCP tool responses for AI agents and cut token cost'

// Derived from CHANGELOG.md, tests/ and scripts/smoke.mjs at build time (see vite.config.ts).
export const RELEASE_DATE: string = __BUILD_FACTS__.releaseDate
export const TEST_COUNT: number = __BUILD_FACTS__.tests
export const SMOKE_COUNT: number = __BUILD_FACTS__.smoke

// First day on npm; downloads are counted from here (npm caps a range at 18 months).
export const NPM_SINCE = '2026-10-01'
// Below this many stars the count is hidden and the button just says "Star".
export const STAR_MIN = 25

/**
 * Product Hunt. Fill slug once the post exists (the "upcoming" page is enough): that turns on
 * the Product Hunt buttons. Set live to true on launch day for the hero pill, then back.
 */
export const PRODUCT_HUNT = {
  slug: '',
  live: false,
}
export const PH_URL = PRODUCT_HUNT.slug
  ? `https://www.producthunt.com/posts/${PRODUCT_HUNT.slug}?utm_source=mto-site&utm_medium=button&utm_campaign=launch`
  : ''

/** 1234 → "1.2k" */
export const compact = (n: number) =>
  n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '')}k`
