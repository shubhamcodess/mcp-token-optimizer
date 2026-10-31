import { useEffect, useMemo, useState } from 'preact/hooks'
import { act, api, fmt, streamRows, type Row, type ToolRow } from './api'

const FORMATS = ['', 'auto', 'json', 'json-pretty', 'toon']
const MODES = ['', 'active', 'shadow', 'off']
const PROFILES = ['', 'conservative', 'balanced', 'aggressive']

function RuleEditor({ t, onSaved }: { t: ToolRow; onSaved: () => void }) {
  const [err, setErr] = useState<string | null>(null)
  const [list, setList] = useState({ dropKeys: (t.rule.dropKeys ?? []).join(', '), keepKeys: (t.rule.keepKeys ?? []).join(', ') })
  const [max, setMax] = useState(t.rule.maxArrayItems === undefined ? '' : String(t.rule.maxArrayItems))
  useEffect(() => {
    setList({ dropKeys: (t.rule.dropKeys ?? []).join(', '), keepKeys: (t.rule.keepKeys ?? []).join(', ') })
    setMax(t.rule.maxArrayItems === undefined ? '' : String(t.rule.maxArrayItems))
    setErr(null)
  }, [t.tool])
  const save = (field: string, value: unknown) =>
    act('set-tool-rule', { tool: t.tool, field, value })
      .then(() => (setErr(null), onSaved()))
      .catch((e: Error) => setErr(e.message))
  const csv = (v: string) => (v.trim() ? v.split(',').map((x) => x.trim()).filter(Boolean) : null)
  const sel = (field: 'mode' | 'format' | 'profile', opts: string[]) => (
    <select class="input" value={t.rule[field] ?? ''} onChange={(e) => save(field, (e.target as HTMLSelectElement).value || null)}>
      {opts.map((o) => <option value={o}>{o || 'inherit'}</option>)}
    </select>
  )
  return (
    <div class="card" style="margin-top:14px">
      <h2>Rule for <span class="mono">{t.tool}</span> <small>{t.ruleKey ? `from tools."${t.ruleKey}"` : 'no rule yet: first edit creates one'}</small></h2>
      <div class="field"><div><code>mode</code></div><div class="field__in">{sel('mode', MODES)}</div></div>
      <div class="field"><div><code>format</code></div><div class="field__in">{sel('format', FORMATS)}</div></div>
      <div class="field"><div><code>profile</code></div><div class="field__in">{sel('profile', PROFILES)}</div></div>
      <div class="field"><div><code>summarize</code></div><div class="field__in">
        <select class="input" value={t.rule.summarize === undefined ? '' : String(t.rule.summarize)} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; void save('summarize', v === '' ? null : v === 'true') }}>
          <option value="">inherit</option><option value="true">true</option><option value="false">false</option>
        </select></div></div>
      <div class="field"><div><code>maxArrayItems</code></div><div class="field__in"><input class="input" type="number" min="0" value={max} onInput={(e) => setMax((e.target as HTMLInputElement).value)} placeholder="inherit" /><button class="btn btn--line btn--sm" onClick={() => save('maxArrayItems', max === '' ? null : Number(max))}>Save</button></div></div>
      {(['dropKeys', 'keepKeys'] as const).map((k) => (
        <div class="field"><div><code>{k}</code><small>comma-separated globs</small></div><div class="field__in"><input class="input" value={list[k]} onInput={(e) => setList({ ...list, [k]: (e.target as HTMLInputElement).value })} placeholder="inherit" /><button class="btn btn--line btn--sm" onClick={() => save(k, csv(list[k]))}>Save</button></div></div>
      ))}
      {err && <p class="note cut">{err}</p>}
      <p class="note">Edits are validated, written to the config file (comments kept) and applied live.</p>
    </div>
  )
}

export function Traffic() {
  const [rows, setRows] = useState<Row[]>([])
  const [tools, setTools] = useState<ToolRow[]>([])
  const [sel, setSel] = useState<Row | null>(null)
  const [tool, setTool] = useState<string | null>(null)
  const [f, setF] = useState({ client: '', server: '', tool: '', mode: '', stage: '', lossy: false })

  const loadTools = () => api<ToolRow[]>('/api/tools').then(setTools).catch(() => undefined)
  useEffect(() => {
    void api<Row[]>('/api/traffic?limit=200').then(setRows).catch(() => undefined)
    void loadTools()
    const ctl = new AbortController()
    void streamRows((r) => setRows((x) => [r, ...x].slice(0, 500)), ctl.signal)
    return () => ctl.abort()
  }, [])

  const has = (v: string | undefined, q: string) => !q || (v ?? '').toLowerCase().includes(q.toLowerCase())
  const shown = useMemo(
    () => rows.filter((r) => has(r.client, f.client) && has(r.server, f.server) && has(r.tool, f.tool) && (!f.mode || r.mode === f.mode) && (!f.stage || r.stages.some((s) => s.includes(f.stage))) && (!f.lossy || r.lossy)),
    [rows, f],
  )
  const bind = (k: 'client' | 'server' | 'tool' | 'stage') => ({ class: 'input', placeholder: k, value: f[k], onInput: (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value }) })
  const current = tools.find((t) => t.tool === tool)

  return (
    <>
      <div class="head"><div><h1>Traffic</h1><p>Sizes and decisions only. No tool content is shown on this page.</p></div></div>

      <div class="card">
        <h2>Live feed <small>{shown.length} of {rows.length}</small></h2>
        <div class="filters">
          <input {...bind('client')} /><input {...bind('server')} /><input {...bind('tool')} /><input {...bind('stage')} />
          <select class="input" value={f.mode} onChange={(e) => setF({ ...f, mode: (e.target as HTMLSelectElement).value })}>{['', 'active', 'shadow'].map((m) => <option value={m}>{m || 'any mode'}</option>)}</select>
          <label><input type="checkbox" checked={f.lossy} onChange={(e) => setF({ ...f, lossy: (e.target as HTMLInputElement).checked })} /> lossy only</label>
        </div>
        <div class="scroll">
          <table>
            <thead><tr><th>time</th><th>tool</th><th>client</th><th class="num">in</th><th class="num">out</th><th>stages</th></tr></thead>
            <tbody>
              {shown.slice(0, 200).map((r) => (
                <tr class={`click ${sel === r ? 'sel' : ''}`} onClick={() => setSel(r)}>
                  <td class="mono muted">{r.ts.slice(11, 19)}</td>
                  <td class="mono">{r.server}.{r.tool}{r.mode === 'shadow' ? ' (shadow)' : ''}</td>
                  <td class="muted">{r.client ?? '–'}</td>
                  <td class="num">{fmt(r.tokensIn)}</td><td class="num cut">{fmt(r.tokensOut)}</td>
                  <td class="muted mono">{r.stages.join(' › ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && <p class="empty">No calls match.</p>}
        </div>
        {sel && (
          <div class="list" style="margin-top:12px">
            <div><span>Call</span><span class="mono">{sel.server}.{sel.tool}</span></div>
            <div><span>Tokens</span><span class="mono">{sel.tokensIn.toLocaleString()} → {sel.tokensOut.toLocaleString()} ({sel.tokensIn ? Math.round(100 * (1 - sel.tokensOut / sel.tokensIn)) : 0}% saved)</span></div>
            <div><span>Stages</span><span class="mono">{sel.stages.join(' › ') || '–'}</span></div>
            <div><span>Latency</span><span class="mono">{sel.latencyMs} ms</span></div>
            <div><span>Lossy</span><span class="mono">{sel.lossy ? 'yes' : 'no'}</span></div>
            <div><span>mto_expand note issued</span><span class="mono">{sel.noted ? 'yes' : 'no'}</span></div>
            <div><span>Client / profile</span><span class="mono">{sel.client ?? '–'}{sel.profile ? ` · ${sel.profile}` : ''}</span></div>
          </div>
        )}
      </div>

      <div class="card" style="margin-top:14px">
        <h2>Per tool <small>last 7 days · click a row to edit its rule</small></h2>
        <div class="scroll">
          <table>
            <thead><tr><th>tool</th><th class="num">calls</th><th class="num">saved</th><th class="num">lossy</th><th class="num">avg ms</th><th class="num">expands</th><th>rule</th></tr></thead>
            <tbody>
              {tools.map((t) => (
                <tr class={`click ${tool === t.tool ? 'sel' : ''}`} onClick={() => setTool(t.tool)}>
                  <td class="mono">{t.tool}</td><td class="num">{t.calls}</td><td class="num cut">{fmt(t.saved)}</td><td class="num">{t.lossyPct}%</td><td class="num">{t.avgLatencyMs}</td><td class="num">{t.expands}</td>
                  <td class="muted mono">{Object.entries(t.rule).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : v}`).join(' ') || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tools.length && <p class="empty">No calls recorded yet.</p>}
        </div>
      </div>
      {current && <RuleEditor t={current} onSaved={loadTools} />}
    </>
  )
}
