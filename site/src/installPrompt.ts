import guide from '../../docs/getting-started.md?raw'
import troubleshooting from '../../TROUBLESHOOTING.md?raw'
import { INSTALLERS, PACKAGE, REPO, VERSION } from './data'

const BLOB = `${REPO}/blob/main`

/** Relative links in a repo Markdown file become GitHub URLs, so they work outside the repo. */
function absolute(md: string, file: string) {
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : ''
  return md.replace(/\]\((?!https?:|mailto:)([^)\s]+)\)/g, (_m, target: string) => {
    if (target.startsWith('#')) return `](${BLOB}/${file}${target})`
    if (target.startsWith('../')) return `](${BLOB}/${target.slice(3)})`
    return `](${BLOB}/${dir}${target.replace(/^\.\//, '')})`
  })
}

const installCommands = INSTALLERS.filter((i) => i.id !== 'release')
  .map((i) => `   - ${i.id}: \`${i.cmd}\``)
  .join('\n')

/** The setup prompt, rebuilt from the repository's own docs on every site build. */
export const INSTALL_PROMPT = `# Install and set up mcp-token-optimizer (mto)

You are a coding agent helping me install mcp-token-optimizer on this machine. It is a local proxy between coding agents and their MCP servers that shrinks tool responses and keeps the originals recoverable. Current version: ${VERSION}. Repository: ${REPO}

Follow the steps in order. Show me what you find, and ask me before anything that changes my system.

## Rules

- Ask before the global install (step 2) and before \`mto init --apply\` (step 5).
- Never edit MCP config files by hand. \`mto init\` and \`mto uninstall\` do it safely and write a \`.mto.bak\` backup.
- Never run \`mto init --apply\` without \`--only\`. Without it, every MCP config found on this machine is changed.
- Never print, copy or log API keys, tokens or headers from my MCP configs.
- Install only the scoped package \`${PACKAGE}\`. The unscoped \`mcp-token-optimizer\` on npm is an unrelated project.
- Do not pull an Ollama model unless I ask (about 2.6 GB). It is optional; pruning and TOON work without it, so an Ollama warning from \`mto doctor\` is fine.
- If a step fails, stop and check the troubleshooting section below before trying something else.

## Steps

1. **Check the requirements.** Run \`node --version\`. Node 20+ is required and 22.15+ is recommended. Run \`mto --version\` to see whether mto is already installed.
2. **Install.** Use the package manager I already use (look for a lockfile or ask), defaulting to npm:
${installCommands}

   Confirm with \`mto --version\`.
3. **Configure in shadow mode.** Run \`mto config init\` (it refuses to overwrite an existing config) and \`mto doctor\`. Then run \`mto config set mode shadow\`, unless mto was already set up: in that case show me \`mto config get mode\` and ask first. In shadow mode, mto measures savings but my agent still receives the original responses, so nothing changes yet.
4. **Find my MCP servers.** Run \`mto discover\` (read-only) and show me the servers it finds. If it finds none, ask me where my MCP config is and use \`mto discover --file <path>\`. Ask which one or two servers to start with.
5. **Wrap those servers.** Run \`mto init --only <servers>\` (a dry run), show me what would change, and after I confirm run \`mto init --only <servers> --apply\`.
6. **Start the proxy if needed.** Servers with a URL (type \`http\`) go through the local proxy, so run \`mto ui\`, which starts it and opens the dashboard at http://127.0.0.1:8787/. Stdio servers don't need it.
7. **Restart and verify.** Tell me how to restart those MCP servers in my agent. After I've used one of their tools, run \`mto stats\` and report the projected savings.
8. **Finish.** Tell me how to go further and back:
   - Turn it on: \`mto config set mode active\`, then restart the servers (and \`mto serve\` if it is running).
   - Undo everything: \`mto uninstall --apply\`.

## Reference: getting started guide

From ${BLOB}/docs/getting-started.md. It writes \`node dist/cli.js …\` for clones; with a package-manager install, use \`mto …\`.

<guide>
${absolute(guide, 'docs/getting-started.md').trim()}
</guide>

## Reference: troubleshooting

From ${BLOB}/TROUBLESHOOTING.md.

<troubleshooting>
${absolute(troubleshooting, 'TROUBLESHOOTING.md').trim()}
</troubleshooting>

## More documentation

- How it works: ${BLOB}/docs/how-it-works.md
- Tuning (profiles, formats, summarization): ${BLOB}/docs/tuning.md
- Every config key and CLI command: ${BLOB}/docs/reference.md
- Security and privacy: ${BLOB}/SECURITY.md
`
