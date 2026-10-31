import { useEffect, useState } from 'preact/hooks'
import { act, api, fmt, type CaptureItem } from './api'

interface Detail { ts: string; server: string; tool: string; original: string; received: string | null; verdict: string | null; tokensIn: number | null; tokensOut: number | null; dataDropped: { path: string; count: number }[] }

export function Captures({ enabled }: { enabled: boolean }) {
  const [list, setList] = useState<{ total: number; items: CaptureItem[]; dir: string } | null>(null)
  const [d, setD] = useState<Detail | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const load = () => api<NonNullable<typeof list>>('/api/captures').then(setList).catch(() => undefined)
  useEffect(() => void load(), [])

  return (
    <>
      <div class="head"><div><h1>Captures</h1><p>Recorded tool results, for tuning with bench and compare.</p></div>
        <button class="btn btn--line" disabled={!list?.total} onClick={() => confirm(`Delete all ${list?.total} captures from disk? This cannot be undone.`) && act<{ deleted: number }>('delete-captures').then((r) => (setMsg(`Deleted ${r.deleted} capture file(s).`), setD(null), load()))}>Delete all captures</button>
      </div>
      <div class="warn"><strong>Captures contain real tool output.</strong> Common secret patterns are redacted, but treat this as sensitive. It stays on this computer and is shown only in this browser. {enabled ? 'Capture is ON.' : 'Capture is off: turn it on from Doctor to record new samples.'}</div>
      {msg && <div class="banner" style="margin-bottom:14px">{msg}</div>}
      <div class="card">
        <h2>Samples <small>{list ? `${list.total} total · ${list.dir}` : ''}</small></h2>
        {list?.items.length ? (
          <div class="scroll"><table>
            <thead><tr><th>time</th><th>tool</th><th class="num">original</th><th class="num">received</th></tr></thead>
            <tbody>{list.items.map((c) => (
              <tr class={`click ${d && d.ts === c.ts && d.tool === c.tool ? 'sel' : ''}`} onClick={() => api<Detail>(`/api/captures/${c.id}`).then(setD)}>
                <td class="mono muted">{c.ts.slice(0, 19).replace('T', ' ')}</td><td class="mono">{c.server}.{c.tool}</td><td class="num">{fmt(c.originalTokens)}</td><td class="num cut">{c.receivedTokens === undefined ? '–' : fmt(c.receivedTokens)}</td>
              </tr>))}</tbody>
          </table></div>
        ) : <p class="empty">No captures.</p>}
      </div>
      {d && (
        <div class="card" style="margin-top:14px">
          <h2><span class="mono">{d.server}.{d.tool}</span> <small>verdict: {d.verdict ?? 'n/a (shadow or not recorded)'}{d.tokensIn !== null ? ` · ${fmt(d.tokensIn)} → ${fmt(d.tokensOut ?? 0)} tokens` : ''}</small></h2>
          {d.dataDropped.length > 0 && <p class="note">Named data dropped: {d.dataDropped.map((x) => `${x.count}× ${x.path}`).join(', ')}</p>}
          <div class="cols">
            <div><div class="kpi__label" style="margin-bottom:6px">original (first 20k chars)</div><pre>{d.original}</pre></div>
            <div><div class="kpi__label" style="margin-bottom:6px">what the agent received</div><pre>{d.received ?? '(not recorded: shadow mode)'}</pre></div>
          </div>
        </div>
      )}
    </>
  )
}
