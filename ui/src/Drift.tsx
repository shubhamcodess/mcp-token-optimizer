import { useEffect, useState } from 'preact/hooks'
import { api, type Finding } from './api'

/** Banner for agent-config drift. Nothing is modified until the user presses a button. */
export function Drift({ count }: { count: number }) {
  const [findings, setFindings] = useState<Finding[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = () => api<{ findings: Finding[] }>('/api/drift').then((d) => setFindings(d.findings)).catch(() => undefined)
  useEffect(() => void load(), [count])
  if (!findings.length) return null

  const act = async (name: string, body: object, key: string) => {
    setBusy(key)
    setErr(null)
    try {
      await api(`/api/actions/${name}`, body)
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div class="banner" style="margin-bottom:16px">
      <strong>Your agent configs changed</strong>
      {findings.map((f) => (
        <div class="row-act" key={f.id}>
          <p>{f.message}</p>
          {f.kind !== 'dead-proxy' && (
            <button class="btn btn--line" disabled={!!busy} onClick={() => act('wrap-server', { server: f.server }, f.id)}>{busy === f.id ? 'Wrapping…' : 'Wrap it'}</button>
          )}
        </div>
      ))}
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
        <button class="btn btn--line" disabled={!!busy} onClick={() => act('drift-accept', {}, 'accept')}>Accept current state</button>
        {err && <span class="note">{err}</span>}
      </div>
    </div>
  )
}
