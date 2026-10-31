import { useEffect, useState } from 'preact/hooks'
import { act, api, fmt, type CaptureItem } from './api'

interface Totals { tokensIn: number; tokensOut: number; savedPct: number; lossy: number; lossless: { ok: number; total: number; pct: number }; facts: { kept: number; total: number; pct: number | null } }
interface RunRow { key: string; n: number; tokensIn: number; tokensOut: number; savedPct: number; avgMs: number; verdict: string; dataDropped: { path: string; count: number }[] }
interface RunSummary { id: string; ts: string; label: string; source: string; candidate: Record<string, unknown>; samples: number; totals: Totals }
interface Run extends Omit<RunSummary, 'totals' | 'samples'> { result: { samples: number; totals: Totals; rows: RunRow[] } }
interface RunDiff { totals: { savedPctDelta: number; tokensOutDelta: number }; rows: { key: string; a?: number; b?: number; delta?: number; verdictA?: string; verdictB?: string }[] }
interface Fidelity { identical: boolean; originalBytes: number; givenBytes: number; firstDifference?: number; whitespaceOnly?: boolean }

const sign = (n: number) => (n > 0 ? `+${n}` : String(n))

export function Eval() {
  const [history, setHistory] = useState<RunSummary[]>([])
  const [run, setRun] = useState<Run | null>(null)
  const [pick, setPick] = useState<string[]>([])
  const [diff, setDiff] = useState<RunDiff | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ source: 'captures', profile: '', format: '', pretty: '', label: '' })
  const [caps, setCaps] = useState<CaptureItem[]>([])
  const [fid, setFid] = useState({ id: '', path: '', text: '' })
  const [fidRes, setFidRes] = useState<Fidelity | null>(null)

  const loadHistory = () => api<RunSummary[]>('/api/eval/history').then(setHistory).catch(() => undefined)
  useEffect(() => {
    void loadHistory()
    void api<{ items: CaptureItem[] }>('/api/captures').then((c) => setCaps(c.items)).catch(() => undefined)
  }, [])

  const start = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await act<Run>('eval-run', { source: f.source, profile: f.profile, format: f.format, prettyJsonAboveTokens: f.pretty, label: f.label })
      setRun(r)
      await loadHistory()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const toggle = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)))
  useEffect(() => {
    if (pick.length === 2) void api<RunDiff>(`/api/eval/diff?a=${pick[0]}&b=${pick[1]}`).then(setDiff).catch(() => setDiff(null))
    else setDiff(null)
  }, [pick])

  const sel = (k: 'profile' | 'format', opts: string[]) => (
    <select class="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: (e.target as HTMLSelectElement).value })}>{opts.map((o) => <option value={o}>{o || `current ${k}`}</option>)}</select>
  )
  const t = run?.result.totals

  return (
    <>
      <div class="head"><div><h1>Eval</h1><p>Replay recorded results through the optimizer, check nothing changed value, and compare runs. No LLM involved: results are deterministic.</p></div></div>

      <div class="card">
        <h2>New run <small>a candidate is tried in memory; your config file is not changed</small></h2>
        <div class="filters">
          <select class="input" value={f.source} onChange={(e) => setF({ ...f, source: (e.target as HTMLSelectElement).value })}><option value="captures">my captures</option><option value="examples">synthetic examples</option></select>
          {sel('profile', ['', 'conservative', 'balanced', 'aggressive'])}
          {sel('format', ['', 'auto', 'json', 'json-pretty', 'toon'])}
          <input class="input" placeholder="pretty JSON above (tokens)" inputMode="numeric" value={f.pretty} onInput={(e) => setF({ ...f, pretty: (e.target as HTMLInputElement).value })} />
          <input class="input" placeholder="label (optional)" value={f.label} onInput={(e) => setF({ ...f, label: (e.target as HTMLInputElement).value })} />
          <button class="btn btn--solid" disabled={busy} onClick={start}>{busy ? 'Running…' : 'Run'}</button>
        </div>
        {err && <p class="note cut">{err}</p>}
      </div>

      {run && t && (
        <div class="card" style="margin-top:14px">
          <h2>{run.label} <small>{run.result.samples} samples</small></h2>
          <div class="grid kpis" style="margin-bottom:12px">
            <div><div class="kpi__label">saved</div><div class="kpi__value kpi__value--cut">{t.savedPct}%</div><div class="kpi__sub">{fmt(t.tokensIn)} → {fmt(t.tokensOut)}</div></div>
            <div><div class="kpi__label">lossless</div><div class={`kpi__value ${t.lossless.ok === t.lossless.total ? 'ok' : 'cut'}`}>{t.lossless.ok}/{t.lossless.total}</div><div class="kpi__sub">no value changed</div></div>
            <div><div class="kpi__label">key facts kept</div><div class="kpi__value">{t.facts.pct === null ? '–' : `${t.facts.pct}%`}</div><div class="kpi__sub">text results only</div></div>
          </div>
          <div class="scroll"><table>
            <thead><tr><th>tool</th><th class="num">n</th><th class="num">in</th><th class="num">out</th><th class="num">saved</th><th>verdict</th></tr></thead>
            <tbody>{run.result.rows.map((r) => (
              <tr><td class="mono">{r.key}</td><td class="num">{r.n}</td><td class="num">{fmt(r.tokensIn)}</td><td class="num">{fmt(r.tokensOut)}</td><td class="num cut">{r.savedPct}%</td>
                <td class="muted">{r.verdict}{r.dataDropped.length ? ` · ${r.dataDropped.slice(0, 3).map((d) => `${d.count}× ${d.path}`).join(', ')}` : ''}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      <div class="card" style="margin-top:14px">
        <h2>History <small>pick two runs to compare · kept across restarts</small></h2>
        {history.length ? (
          <div class="scroll"><table>
            <thead><tr><th></th><th>run</th><th>when</th><th class="num">saved</th><th class="num">lossless</th><th class="num">facts</th></tr></thead>
            <tbody>{history.map((h) => (
              <tr class={pick.includes(h.id) ? 'sel' : ''}>
                <td><input type="checkbox" checked={pick.includes(h.id)} onChange={() => toggle(h.id)} aria-label={`Select ${h.label}`} /></td>
                <td>{h.label}<span class="muted mono"> {Object.entries(h.candidate).map(([k, v]) => `${k}=${v}`).join(' ')}</span></td>
                <td class="mono muted">{h.ts.slice(0, 16).replace('T', ' ')}</td>
                <td class="num cut">{h.totals.savedPct}%</td><td class="num">{h.totals.lossless.ok}/{h.totals.lossless.total}</td><td class="num">{h.totals.facts.pct === null ? '–' : `${h.totals.facts.pct}%`}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p class="empty">No runs yet.</p>}
        {diff && (
          <>
            <p class="note">Second minus first: total saving {sign(diff.totals.savedPctDelta)} points, {sign(diff.totals.tokensOutDelta)} tokens sent.</p>
            <div class="scroll"><table>
              <thead><tr><th>tool</th><th class="num">first</th><th class="num">second</th><th class="num">change</th><th>verdict</th></tr></thead>
              <tbody>{diff.rows.map((r) => (
                <tr><td class="mono">{r.key}</td><td class="num">{r.a ?? '–'}%</td><td class="num">{r.b ?? '–'}%</td><td class={`num ${r.delta ? (r.delta > 0 ? 'ok' : 'cut') : ''}`}>{r.delta === undefined ? '–' : sign(r.delta)}</td>
                  <td class="muted">{r.verdictA === r.verdictB ? r.verdictA : `${r.verdictA ?? '–'} → ${r.verdictB ?? '–'}`}</td></tr>
              ))}</tbody>
            </table></div>
          </>
        )}
      </div>

      <div class="card" style="margin-top:14px">
        <h2>Fidelity check <small>is what the agent wrote identical to the captured original?</small></h2>
        {caps.length ? (
          <>
            <div class="filters">
              <select class="input" style="width:auto;max-width:100%" value={fid.id} onChange={(e) => setFid({ ...fid, id: (e.target as HTMLSelectElement).value })}>
                <option value="">pick a capture</option>
                {caps.map((c) => <option value={c.id}>{c.ts.slice(0, 19).replace('T', ' ')} · {c.server}.{c.tool}</option>)}
              </select>
              <input class="input" style="width:260px" placeholder='JSON path, e.g. $.manifest.data["app.yaml"] (optional)' value={fid.path} onInput={(e) => setFid({ ...fid, path: (e.target as HTMLInputElement).value })} />
            </div>
            <textarea class="input mono" style="min-height:140px" spellcheck={false} placeholder="Paste the content the agent produced (up to 60 KB)" value={fid.text} onInput={(e) => setFid({ ...fid, text: (e.target as HTMLTextAreaElement).value })} />
            <div style="margin-top:10px"><button class="btn btn--line" disabled={!fid.id || !fid.text} onClick={() => act<Fidelity>('eval-fidelity', fid).then((r) => (setFidRes(r), setErr(null))).catch((e: Error) => setErr(e.message))}>Compare</button></div>
            {fidRes && <p class={`note ${fidRes.identical ? 'ok' : 'cut'}`}>{fidRes.identical ? 'IDENTICAL' : 'DIFFERENT'}: original {fidRes.originalBytes} B, yours {fidRes.givenBytes} B{fidRes.identical ? '' : `, first difference at byte ${fidRes.firstDifference}${fidRes.whitespaceOnly ? ' (whitespace only)' : ''}`}</p>}
          </>
        ) : <p class="empty">Needs captures: turn capture on and use your agent.</p>}
      </div>
    </>
  )
}
