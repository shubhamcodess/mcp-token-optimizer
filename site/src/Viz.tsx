import { useEffect, useState, type CSSProperties } from 'react'

/* Each visual is a small, looping scene. The parent tile sets data-play so they only run in view. */

export function ShadowViz({ play }: { play: boolean }) {
  const [mode, setMode] = useState<'shadow' | 'active'>('shadow')
  useEffect(() => {
    if (!play) return
    const id = window.setInterval(() => setMode((m) => (m === 'shadow' ? 'active' : 'shadow')), 2600)
    return () => window.clearInterval(id)
  }, [play])
  const shadow = mode === 'shadow'
  return (
    <div className="v-shadow">
      <div className="v-switch" aria-hidden="true">
        <span className={shadow ? 'on' : undefined}>mode: shadow</span>
        <span className={shadow ? undefined : 'on'}>mode: active</span>
      </div>
      <div className="v-row">
        <span className="lab">agent receives</span>
        <span className="v-bar">
          <i style={{ transform: `scaleX(${shadow ? 1 : 13244 / 37355})` }} />
        </span>
        <span className="val">{shadow ? '37,355' : '13,244'} tok</span>
      </div>
      <div className="v-row">
        <span className="lab">mto stats</span>
        <span className="v-bar v-bar--ghost">
          <i style={{ transform: `scaleX(${13244 / 37355})` }} />
        </span>
        <span className="val">{shadow ? 'would save' : 'saved'} 64.5%</span>
      </div>
    </div>
  )
}

export function FailViz() {
  return (
    <div className="v-fail" aria-hidden="true">
      <svg viewBox="0 0 300 160">
        <path className="w" d="M58 62 H242" />
        <path id="fail-path" className="w w-by" d="M242 62 C 220 132, 80 132, 58 62" />
        <rect className="nd" x="8" y="44" width="54" height="36" rx="8" />
        <text className="nd-t" x="35" y="66" textAnchor="middle">
          agent
        </text>
        <rect className="nd" x="122" y="44" width="56" height="36" rx="8" />
        <text className="nd-t" x="150" y="66" textAnchor="middle">
          mto
        </text>
        <rect className="nd" x="238" y="44" width="54" height="36" rx="8" />
        <text className="nd-t" x="265" y="66" textAnchor="middle">
          server
        </text>
        <path className="x" d="M141 30 l18 -14 M141 16 l18 14" />
        <text className="err" x="150" y="12" textAnchor="middle">
          timeout
        </text>
        <text className="fwd" x="150" y="146" textAnchor="middle">
          original forwarded
        </text>
        <circle
          className="pkt"
          r="4.5"
          style={{ offsetPath: "path('M242 62 C 220 132, 80 132, 58 62')" } as CSSProperties}
        />
      </svg>
    </div>
  )
}

const JSON_L = ['[', '  {"id":1,"name":"bug"},', '  {"id":2,"name":"docs"}', ']']
const TOON_L = ['[2]{id,name}:', '  1,bug', '  2,docs']

export function ToonViz() {
  return (
    <div className="v-toon" aria-hidden="true">
      <pre>
        {JSON_L.map((l) => (
          <span key={l} style={{ display: 'block' }}>
            {l}
          </span>
        ))}
      </pre>
      <span className="arrow">→</span>
      <pre>
        <span className="v-label">
          <span>json in</span>
          <span>toon out</span>
        </span>
        {TOON_L.map((l, i) => (
          <span key={l} className="tl" style={{ ['--i' as string]: i } as CSSProperties}>
            {i === 0 ? <span className="tk">{l}</span> : l}
          </span>
        ))}
      </pre>
      <div className="v-check">
        <span>decode(TOON) === input</span>
        <b>round-trip ok</b>
      </div>
    </div>
  )
}

export function ExpandViz() {
  return (
    <div className="v-term" aria-hidden="true">
      <p>
        <span className="ln dim" style={{ ['--at' as string]: '0s' } as CSSProperties}>
          [mto: pruned low-value fields: events_url×80, node_id×80, labels_url×40, avatar_url×40, …
        </span>
        <span className="ln dim" style={{ ['--at' as string]: '0.2s' } as CSSProperties}>
          {' '}Only if you need them: mto_expand {'{"id":"7b105335b224","path":...}'}]
        </span>
      </p>
      <p style={{ marginTop: 12 }}>
        <span className="ln hl" style={{ ['--at' as string]: '0.9s' } as CSSProperties}>
          <span className="p">› </span>mto_expand {'{"id":"7b105335b224","path":"$[3].user.avatar_url"}'}
        </span>
      </p>
      <p style={{ marginTop: 8 }}>
        <span className="ln res" style={{ ['--at' as string]: '1.8s' } as CSSProperties}>
          https://avatars.githubusercontent.com/u/103?v=4
        </span>
      </p>
    </div>
  )
}

export function LocalViz() {
  return (
    <div className="v-local" aria-hidden="true">
      <svg viewBox="0 0 300 196">
        <circle className="ring ring--dash" cx="150" cy="98" r="86" />
        <circle className="ring" cx="150" cy="98" r="54" />
        <circle className="orb" cx="150" cy="44" r="3.5" />
        <circle className="orb orb--b" cx="204" cy="98" r="3" />
        <circle className="probe" cx="160" cy="98" r="3.5" />
        <text x="150" y="102" textAnchor="middle">
          127.0.0.1
        </text>
        <text className="t-out" x="150" y="190" textAnchor="middle">
          no telemetry · nothing leaves the machine
        </text>
      </svg>
    </div>
  )
}

export function DiffViz() {
  return (
    <div className="v-diff" aria-hidden="true">
      <p className="file">
        <span>~/.claude.json · mcp.json · …</span>
        <span>mto init --apply</span>
      </p>
      <p className="ctx">{'"x": {'}</p>
      <p className="del">{'-  "command": "npx", "args": ["-y", "x"]'}</p>
      <p className="add">{'+  "command": "<node>", "args": ["…/cli.js", "wrap", "--name", "x", "--", "npx", "-y", "x"]'}</p>
      <p className="ctx">{'}'}</p>
      <p className="ctx" style={{ marginTop: 10 }}>
        {'# backup: <file>.mto.bak · undo: mto uninstall --apply'}
      </p>
    </div>
  )
}
