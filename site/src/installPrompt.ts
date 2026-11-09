import { PACKAGE, REPO } from './data'

/**
 * The prompt "Install with AI" copies. Kept short on purpose: people read it before pasting it
 * into their agent, so every line is a step or a guardrail they can check.
 */
export const INSTALL_PROMPT = `Set up mcp-token-optimizer (mto) on this machine. It is a local proxy that shrinks MCP tool responses before they reach you. Docs: ${REPO}

Ask me before installing anything or changing any config.

1. Check \`node --version\` (needs 20 or newer).
2. Install with \`npm install -g ${PACKAGE}\`, or the pnpm / yarn / bun equivalent if I use one. Only this scoped package: the unscoped name on npm is a different project.
3. Run \`mto config init\`, then \`mto config set mode shadow\`, then \`mto doctor\`. Shadow mode only measures savings; I still get the original responses. An Ollama warning is fine.
4. Run \`mto discover\` and show me the MCP servers it finds. Ask which one to start with.
5. Run \`mto init --only <server>\` to preview the change, then add \`--apply\` once I confirm. Never edit MCP config files by hand, and never use \`--apply\` without \`--only\`.
6. If that server has a URL (HTTP), start the local proxy with \`mto ui\`. Tell me how to restart the server in my agent.
7. After I have used one of its tools, run \`mto stats\` and report the savings.

Later: \`mto config set mode active\` turns it on, \`mto uninstall --apply\` undoes everything.
If a step fails, check ${REPO}/blob/main/TROUBLESHOOTING.md. Never print tokens or API keys from my configs.
`
