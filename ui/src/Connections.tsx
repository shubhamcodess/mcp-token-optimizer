import { useEffect, useState } from 'preact/hooks'
import { act, api, type ConnFile, type ConnServer, type Preview } from './api'

const MODES = ['default', 'off', 'shadow', 'active'] as const
const BADGE: Record<ConnServer['status'], [string, string]> = {
  protected: ['protected', 'badge--ok'], unprotected: ['unprotected', 'badge--cut'], 'proxy-down': ['proxy down', 'badge--cut'], unsupported: ['not supported', ''],
}

function Diff({ text }: { text: string }) {
  return (
    <pre class="diff">
      {text.split('\n').map((l) => (
        <div class={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}>{l || ' '}</div>
      ))}
    </pre>
  )
}

export function Connections() {
  const [data, setData] = useState<{ files: ConnFile[]; unparsable: { agent: string; file: string }[] } | null>(null)
  const [plan, setPlan] = useState<{ op: 'wrap' | 'unwrap'; server: string; preview: Preview } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => api<typeof data>('/api/connections').then(setData).catch(() => undefined)
  useEffect(() => void load(), [])

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      if (ok) setMsg(ok)
      await load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div class="head">
        <div>
          <h1>Connections</h1>
          <p>Agents, their MCP servers and whether mto sits in front. Mode changes apply instantly; wrap and unwrap edit the agent's config.</p>
        </div>
        <button class="btn btn--line" onClick={load}>Refresh</button>
      </div>
      {msg && <div class="banner" style="margin-bottom:14px">{msg}</div>}

      {plan && (
        <div class="card" style="margin-bottom:14px">
          <h2>{plan.op === 'wrap' ? 'Wrap' : 'Unwrap'} “{plan.server}” <small>dry run, nothing written yet</small></h2>
          {plan.preview.changes.length ? plan.preview.changes.map((c) => <div class="list"><div><span class="mono">{c.action}</span><span class="muted mono">{c.file}</span></div></div>) : <p class="empty">Nothing to change.</p>}
          {plan.preview.diffs.map((d) => <Diff text={d.diff} />)}
          <p class="note">{plan.preview.note} A backup (.mto.bak) is made before the first edit of a file.</p>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn--solid" disabled={busy || !plan.preview.changes.length} onClick={() => run(async () => { await act('apply-connection', { op: plan.op, server: plan.server }); setPlan(null) }, 'Applied. Restart that server in your agent.')}>Apply</button>
            <button class="btn btn--line" onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </div>
      )}

      {!data ? <p class="empty">Loading…</p> : !data.files.length ? <div class="card"><p class="empty">No agent MCP configs found. Add one with <span class="mono">mto discover --file …</span>.</p></div> : (
        <div class="grid tree">
          {data.files.map((f) => (
            <div class="card">
              <h3>{f.agent}</h3>
              <div class="file">{f.file} <span class="muted">[{f.keyPath}]</span></div>
              {f.servers.map((s) => (
                <div class="srv" key={s.name}>
                  <div class="srv__name">
                    <span class="mono">{s.name}</span>
                    <span class="badge">{s.kind}</span>
                    <span class={`badge ${BADGE[s.status][1]}`}>{BADGE[s.status][0]}</span>
                  </div>
                  <div class="srv__ctl">
                    {s.wrapped && (
                      <div class="seg seg--sm" role="group" aria-label={`Mode for ${s.name}`} title="Soft disconnect: applies instantly">
                        {MODES.map((m) => <button aria-pressed={s.mode === m} disabled={busy} onClick={() => run(() => act('set-server-mode', { server: s.name, mode: m }))}>{m}</button>)}
                      </div>
                    )}
                    {s.status !== 'unsupported' && (
                      <button class="btn btn--line btn--sm" disabled={busy} onClick={() => run(async () => { const op = s.wrapped ? 'unwrap' : 'wrap'; setPlan({ op, server: s.name, preview: await act<Preview>('plan-connection', { op, server: s.name }) }) })}>{s.wrapped ? 'Unwrap…' : 'Wrap…'}</button>
                    )}
                  </div>
                </div>
              ))}
              {f.backup && (
                <div class="srv">
                  <span class="muted" style="font-size:0.8125rem">Backup from {f.backup.modifiedAt.slice(0, 16).replace('T', ' ')}</span>
                  <button class="btn btn--line btn--sm" disabled={busy} onClick={() => confirm('Restore this config from its backup? Edits made since are kept as .mto.pre-restore.') && run(() => act('restore-backup', { file: f.file }), 'Restored. Restart the agent’s MCP servers.')}>Restore…</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {data?.unparsable.length ? <p class="note">Could not parse: {data.unparsable.map((u) => u.file).join(', ')} (never modified).</p> : null}
    </>
  )
}
