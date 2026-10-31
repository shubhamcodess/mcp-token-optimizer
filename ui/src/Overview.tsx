import { useEffect, useState } from 'preact/hooks'
import { api, fmt, streamRows, type Advice, type Overview as Ov, type Row, type Status } from './api'
import { Trend } from './Chart'

export function Overview({ status }: { status: Status | null }) {
  const [ov, setOv] = useState<Ov | null>(null)
  const [feed, setFeed] = useState<Row[]>([])
  const [advice, setAdvice] = useState<Advice[]>([])
  const [applied, setApplied] = useState<string | null>(null)
  const loadAdvice = () => api<Advice[]>('/api/advice').then(setAdvice).catch(() => undefined)
  useEffect(() => void loadAdvice(), [])
  const apply = (id: string) =>
    api('/api/actions/apply-advice', { id })
      .then(() => (setApplied(id), loadAdvice()))
      .catch(() => undefined)

  useEffect(() => {
    let stop = false
    const load = () => api<Ov>('/api/overview').then((o) => !stop && setOv(o)).catch(() => undefined)
    void load()
    const t = setInterval(load, 10_000)
    return () => ((stop = true), clearInterval(t))
  }, [])

  useEffect(() => {
    const ctl = new AbortController()
    void streamRows((r) => setFeed((f) => [r, ...f].slice(0, 40)), ctl.signal)
    return () => ctl.abort()
  }, [])

  const t = ov?.totals
  return (
    <>
      <div class="head">
        <div>
          <h1>Overview</h1>
          <p>Last 7 days, active mode. Sizes only: no tool content is ever shown here.</p>
        </div>
      </div>

      <div class="grid kpis">
        <div class="card"><div class="kpi__label">ingress tokens</div><div class="kpi__value">{t ? fmt(t.tokensIn) : '–'}</div><div class="kpi__sub">what the tools returned</div></div>
        <div class="card"><div class="kpi__label">egress tokens</div><div class="kpi__value">{t ? fmt(t.tokensOut) : '–'}</div><div class="kpi__sub">what the agent received</div></div>
        <div class="card"><div class="kpi__label">saved</div><div class="kpi__value kpi__value--cut">{t ? `${t.savedPct}%` : '–'}</div><div class="kpi__sub">{t ? `${fmt(t.saved)} tokens` : ' '}</div></div>
        <div class="card"><div class="kpi__label">tool calls</div><div class="kpi__value">{t ? fmt(t.calls) : '–'}</div><div class="kpi__sub">{ov ? `${ov.expand.calls} mto_expand (${ov.expand.rate}% of optimized)` : ' '}</div></div>
      </div>

      <div class="grid two">
        <div class="card">
          <h2>Trend <small>tokens per day</small></h2>
          {ov && t && t.calls > 0 ? <Trend daily={ov.daily} /> : <p class="empty">No optimized calls yet. Run a wrapped server through your agent and numbers show up here.</p>}
        </div>
        <div class="card">
          <h2>Top tools <small>by tokens saved</small></h2>
          {ov && ov.topTools.length ? (
            <table>
              <thead><tr><th>tool</th><th class="num">calls</th><th class="num">saved</th></tr></thead>
              <tbody>
                {ov.topTools.map((x) => (
                  <tr><td class="mono">{x.tool}</td><td class="num">{x.calls}</td><td class="num cut">{fmt(x.saved)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p class="empty">Nothing yet.</p>
          )}
        </div>
      </div>

      <div class="grid two">
        <div class="card">
          <h2>Connected <small>{status ? `${status.proxies.length} proxies` : ''}</small></h2>
          {status && status.proxies.length ? (
            <div class="list">
              {status.proxies.map((p) => (
                <div>
                  <span><span class="mono">{p.server}</span> <span class="muted">· {p.kind}{p.client ? ` · ${p.client}` : ''}</span></span>
                  <span class="muted mono">{p.calls} calls</span>
                </div>
              ))}
            </div>
          ) : (
            <p class="empty">No wrapper or proxy session is connected right now.</p>
          )}
        </div>
        <div class="card">
          <h2>Live feed <small>newest first</small></h2>
          <div class="term" aria-live="off">
            {feed.length ? (
              feed.map((r) => (
                <div class="row">
                  <span class="muted">{r.ts.slice(11, 19)}</span>
                  <span>{r.server}.{r.tool}{r.mode === 'shadow' ? ' (shadow)' : ''}{r.profile ? ` · profile ${r.profile}` : ''}</span>
                  <span>{fmt(r.tokensIn)} → <span class="cut">{fmt(r.tokensOut)}</span></span>
                </div>
              ))
            ) : (
              <span class="muted">waiting for tool calls…</span>
            )}
          </div>
        </div>
      </div>

      <div class="grid two">
        <div class="card">
          <h2>Advisor <small>from your own measurements, advisory</small></h2>
          {advice.length ? (
            advice.map((a) => (
              <div class="row-act" key={a.id}>
                <p>
                  <span class={a.severity === 'warn' ? 'cut' : 'muted'}>{a.tool}</span>: {a.title}
                  <small class="mono">{Object.entries(a.numbers).map(([k, v]) => `${k}=${v}`).join('  ')}</small>
                </p>
                {a.apply && <button class="btn btn--line" disabled={applied === a.id} onClick={() => apply(a.id)}>{applied === a.id ? 'Applied' : a.apply.label}</button>}
              </div>
            ))
          ) : (
            <p class="empty">No recommendations. Needs a few calls per tool to say anything.</p>
          )}
        </div>
        <div class="card">
          <h2>Tool definitions <small>tokens per session, not modified</small></h2>
          {ov && ov.toolDefinitions.length ? (
            <div class="list">
              {ov.toolDefinitions.map((d) => (
                <div><span class="mono">{d.server}</span><span class="muted mono">{fmt(d.tokens)} tokens</span></div>
              ))}
            </div>
          ) : (
            <p class="empty">Recorded when an agent lists a server's tools.</p>
          )}
        </div>
      </div>
    </>
  )
}
