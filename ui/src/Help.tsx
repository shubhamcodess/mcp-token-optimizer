const REPO = 'https://github.com/shubhamcodess/mcp-token-optimizer'
const CMDS: Array<[string, string]> = [
  ['mto status', 'daemon state, connected proxies, 24h savings'],
  ['mto ui', 'open this dashboard'],
  ['mto doctor', 'check config, Ollama and model'],
  ['mto discover', 'list MCP servers found (read-only)'],
  ['mto init --only x --apply', 'wrap one server; undo with uninstall'],
  ['mto config get|set', 'read or change config, validated'],
  ['mto models', 'list, use, test, pull Ollama models'],
  ['mto try <file>', 'optimize a saved response'],
  ['mto capture on|off', 'record redacted results locally'],
  ['mto bench / compare', 'replay captures, compare with originals'],
  ['mto stats', 'token savings report'],
  ['mto help <command>', 'details and examples'],
]
const DOCS: Array<[string, string]> = [
  ['Quick start', 'quick-start'], ['How it works', '3-how-it-works'], ['Modes', '4-operating-modes-off--shadow--active'], ['Profiles', '6-optimization-profiles'],
  ['mto_expand', '9-getting-the-original-back-mto_expand'], ['Configuration', '12-configuration-reference'], ['Troubleshooting', '15-troubleshooting'], ['Security', '16-security-and-privacy'],
]

export function Help() {
  return (
    <>
      <div class="head">
        <div>
          <h1>Help</h1>
          <p>Everything here is also available from the terminal: <span class="mono">mto help</span>.</p>
        </div>
      </div>
      <div class="grid cmds">
        <div class="card">
          <h2>Commands</h2>
          {CMDS.map(([c, d]) => (
            <div class="cmd"><code>{c}</code><span>{d}</span></div>
          ))}
        </div>
        <div class="card">
          <h2>Docs</h2>
          <div class="links">
            {DOCS.map(([label, anchor]) => (
              <a href={`${REPO}#${anchor}`} target="_blank" rel="noreferrer noopener">{label}</a>
            ))}
          </div>
          <h2 style="margin-top:24px">Local only</h2>
          <p class="muted" style="font-size:0.9375rem">
            The dashboard talks only to this daemon on 127.0.0.1. The daemon talks only to your own MCP servers and your local Ollama. No telemetry, no cloud models, and the dashboard cannot run arbitrary commands: only the fixed actions on the Doctor page.
          </p>
        </div>
      </div>
    </>
  )
}
