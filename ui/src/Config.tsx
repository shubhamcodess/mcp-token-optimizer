import { useEffect, useState } from 'preact/hooks'
import { act, api, type Field } from './api'

const show = (v: unknown): string => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''))

function FieldRow({ f, onSaved }: { f: Field; onSaved: () => void }) {
  const [val, setVal] = useState(f.kind === 'string-list' ? (f.value as string[]).join(', ') : f.kind === 'json' ? JSON.stringify(f.value) : String(f.value ?? ''))
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => setVal(f.kind === 'string-list' ? (f.value as string[]).join(', ') : f.kind === 'json' ? JSON.stringify(f.value) : String(f.value ?? '')), [f.value])
  const save = (v: unknown) =>
    act('config-set', { path: f.path, value: v })
      .then(() => (setErr(null), onSaved()))
      .catch((e: Error) => setErr(e.message))
  const same = show(f.value) === show(f.default)

  let input
  if (f.kind === 'boolean') input = <input type="checkbox" checked={f.value === true} disabled={f.readOnly} onChange={(e) => save((e.target as HTMLInputElement).checked)} />
  else if (f.kind === 'enum') input = <select class="input" value={String(f.value)} disabled={f.readOnly} onChange={(e) => save((e.target as HTMLSelectElement).value)}>{f.options!.map((o) => <option>{o}</option>)}</select>
  else {
    const commit = () => {
      if (f.kind === 'number') return save(Number(val))
      if (f.kind === 'string-list') return save(val.split(',').map((x) => x.trim()).filter(Boolean))
      if (f.kind === 'json') {
        try { return save(JSON.parse(val)) } catch { return setErr('Not valid JSON') }
      }
      return save(val)
    }
    input = (
      <>
        <input class="input" type="text" inputMode={f.kind === 'number' ? 'numeric' : undefined} value={val} disabled={f.readOnly} onInput={(e) => setVal((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && commit()} />
        {!f.readOnly && <button class="btn btn--line btn--sm" onClick={commit}>Save</button>}
      </>
    )
  }
  return (
    <div class="field">
      <div><code>{f.path}</code>{f.description && <small>{f.description}</small>}{!same && <small>default: {show(f.default) || '(empty)'}</small>}</div>
      <div class="field__in">{input}{f.readOnly && <span class="badge">read-only here</span>}</div>
      {err && <div class="err">{err}</div>}
    </div>
  )
}

export function Config() {
  const [data, setData] = useState<{ file: string; fields: Field[]; raw: string } | null>(null)
  const [tab, setTab] = useState<'form' | 'raw'>('form')
  const [raw, setRaw] = useState('')
  const [pre, setPre] = useState<{ ok: boolean; error?: string; diff?: string } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = () => api<NonNullable<typeof data>>('/api/config/form').then((d) => (setData(d), setRaw(d.raw))).catch(() => undefined)
  useEffect(() => void load(), [])

  const sections = data ? [...new Set(data.fields.map((f) => f.section))] : []
  return (
    <>
      <div class="head">
        <div><h1>Config</h1><p class="mono" style="font-size:0.8125rem">{data?.file}</p></div>
        <div class="seg" role="group" aria-label="View">
          <button aria-pressed={tab === 'form'} onClick={() => setTab('form')}>Form</button>
          <button aria-pressed={tab === 'raw'} onClick={() => setTab('raw')}>Raw YAML</button>
        </div>
      </div>
      {msg && <div class="banner" style="margin-bottom:14px">{msg}</div>}

      {tab === 'form' && data && (
        <div class="card">
          <p class="note" style="margin:0 0 4px">Every change is validated, written to the file with your comments kept, and applied live. Some keys (audit path, discovery, Ollama URL) stay in the file.</p>
          {sections.map((s) => (
            <div>
              <div class="sect"><h2>{s}</h2><button class="btn btn--line btn--sm" onClick={() => confirm(`Restore “${s}” to its defaults?`) && act('config-reset', { section: s }).then(() => (setMsg(`${s} restored to defaults`), load())).catch((e: Error) => setMsg(e.message))}>Restore defaults</button></div>
              {data.fields.filter((f) => f.section === s).map((f) => <FieldRow f={f} onSaved={load} />)}
            </div>
          ))}
        </div>
      )}

      {tab === 'raw' && data && (
        <div class="card">
          <textarea class="input mono" spellcheck={false} value={raw} onInput={(e) => (setRaw((e.target as HTMLTextAreaElement).value), setPre(null))} />
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn--line" onClick={() => act<typeof pre>('config-raw-preview', { yaml: raw }).then(setPre)}>Validate and show diff</button>
            <button class="btn btn--solid" disabled={!pre?.ok || !pre.diff} onClick={() => act('config-raw-save', { yaml: raw }).then(() => (setMsg('Saved and applied.'), setPre(null), load())).catch((e: Error) => setMsg(e.message))}>Save</button>
            <button class="btn btn--line" onClick={() => (setRaw(data.raw), setPre(null))}>Reset</button>
          </div>
          {pre && !pre.ok && <p class="note cut">{pre.error}</p>}
          {pre?.ok && (pre.diff ? <pre class="diff">{pre.diff.split('\n').map((l) => <div class={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}>{l || ' '}</div>)}</pre> : <p class="note">No changes.</p>)}
        </div>
      )}
    </>
  )
}
