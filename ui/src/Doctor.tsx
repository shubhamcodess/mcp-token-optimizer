import { useEffect, useState } from 'preact/hooks'
import { api, type Check, type Status } from './api'

interface ModelResult { ok: boolean; model: string; latencyMs?: number; tokensPerSec?: number; factsKept?: number; factsTotal: number; truncated?: boolean; error?: string }

export function Doctor({ status }: { status: Status | null }) {
  const [doc, setDoc] = useState<{ ok: boolean; checks: Check[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [mode, setMode] = useState<string | null>(null)
  const [capture, setCapture] = useState<boolean | null>(null)
  const [model, setModel] = useState('')
  const [test, setTest] = useState<ModelResult | null>(null)

  const run = async <T,>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(name)
    setMsg(null)
    try {
      return await fn()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const act = <T,>(name: string, body: object = {}) => api<T>(`/api/actions/${name}`, body)
  const check = () => run('doctor', async () => setDoc(await act('doctor')))

  useEffect(() => void check(), [])
  useEffect(() => {
    if (status) (setMode((m) => m ?? status.mode), setCapture((c) => c ?? status.capture), setModel((m) => m || status.model))
  }, [status])

  return (
    <>
      <div class="head">
        <div>
          <h1>Doctor</h1>
          <p>Health checks and the small set of actions the dashboard is allowed to run.</p>
        </div>
        <button class="btn btn--line" disabled={busy === 'doctor'} onClick={check}>{busy === 'doctor' ? 'Checking…' : 'Run checks'}</button>
      </div>

      <div class="grid two" style="margin-top:0">
        <div class="card">
          <h2>Checks <small>{doc ? (doc.ok ? 'all good' : 'needs attention') : ''}</small></h2>
          {doc ? (
            doc.checks.map((c) => (
              <div class="check">
                <span class={`check__mark ${c.ok ? 'ok' : 'cut'}`}>{c.ok ? '✓' : '✗'}</span>
                <span>{c.label}{c.detail && <small>{c.detail}</small>}</span>
              </div>
            ))
          ) : (
            <p class="empty">Running…</p>
          )}
        </div>

        <div class="card">
          <h2>Actions <small>fixed allowlist</small></h2>
          <div class="row-act">
            <p>Mode<small>off: untouched · shadow: measure only · active: optimize</small></p>
            <div class="seg" role="group" aria-label="Mode">
              {(['off', 'shadow', 'active'] as const).map((m) => (
                <button aria-pressed={mode === m} disabled={!!busy} onClick={() => run('mode', async () => { await act('set-mode', { mode: m }); setMode(m); setMsg(`mode set to ${m}`) })}>{m}</button>
              ))}
            </div>
          </div>
          <div class="row-act">
            <p>Capture<small>record redacted tool results locally for bench and compare</small></p>
            <div class="seg" role="group" aria-label="Capture">
              {([true, false] as const).map((on) => (
                <button aria-pressed={capture === on} disabled={!!busy} onClick={() => run('capture', async () => { await act('capture', { state: on ? 'on' : 'off' }); setCapture(on) })}>{on ? 'on' : 'off'}</button>
              ))}
            </div>
          </div>
          <div class="row-act">
            <p>Model test<small>fixed summarization with known facts</small></p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input class="input" value={model} onInput={(e) => setModel((e.target as HTMLInputElement).value)} aria-label="Model name" placeholder="qwen3:4b" />
              <button class="btn btn--solid" disabled={!!busy || !model} onClick={() => run('test', async () => setTest(await act<ModelResult>('model-test', { model })))}>{busy === 'test' ? 'Testing…' : 'Test'}</button>
            </div>
          </div>
          {test && (
            <p class="note mono">
              {test.ok ? `${test.model}: ${test.factsKept}/${test.factsTotal} facts · ${((test.latencyMs ?? 0) / 1000).toFixed(1)}s${test.tokensPerSec ? ` · ${test.tokensPerSec} tok/s` : ''}${test.truncated ? ' · truncated' : ''}` : `${test.model}: ${test.error}`}
            </p>
          )}
          {msg && <p class="note">{msg}</p>}
        </div>
      </div>
    </>
  )
}
