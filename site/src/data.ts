export const REPO = 'https://github.com/shubhamcodess/mcp-token-optimizer'
export const VERSION: string = '0.2.1'
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
export const INSTALL_NPM = 'npm install -g @shubhamcodess/mcp-token-optimizer'




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
