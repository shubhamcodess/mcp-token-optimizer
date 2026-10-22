import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AUTHOR, BENCHMARKS, DOWNLOAD_LATEST, GITHUB_USER, INSTALL_LATEST, LINKEDIN, REPO, fmt } from './data'
import { animateNumber, usePrefersReducedMotion, useSeen } from './hooks'
import {
  IconArrow,
  IconBook,
  IconBug,
  IconChat,
  IconCode,
  IconGithub,
  IconInfo,
  IconLinkedin,
  IconSpark,
} from './Icons'
import { AGENT_MARKS } from './logos'
import { Term, type TermTab } from './Term'
import { DiffViz, ExpandViz, FailViz, LocalViz, ShadowViz, ToonViz } from './Viz'

const BASE = import.meta.env.BASE_URL

function useInView<T extends Element>(threshold = 0.25) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])
  return [ref, inView] as const
}

/* ---------- Agent logos ---------- */
export function Logos() {
  const row = (hidden: boolean) =>
    AGENT_MARKS.map((a) => (
      <span className="logo" key={a.name + String(hidden)} aria-hidden={hidden || undefined}>
        {a.path && (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={a.path} />
          </svg>
        )}
        {a.name}
      </span>
    ))
  return (
    <section className="logos" aria-label="Works with">
      <p className="cap logos__cap">Works with every MCP-capable coding agent</p>
      <div className="marquee">
        <div className="marquee__track">
          {row(false)}
          {row(true)}
        </div>
      </div>
    </section>
  )
}

/* ---------- How it works: animated pipeline ---------- */
export function HowItWorks() {
  const [ref, play] = useInView<HTMLDivElement>(0.2)
  const tokens = Array.from({ length: 12 }, (_, i) => ({
    x: (i % 6) * 13,
    y: Math.floor(i / 6) * 13,
    keep: [1, 4, 6, 9].includes(i),
  }))
  return (
    <section className="sec" id="how" aria-labelledby="how-title">
      <div className="sec__head reveal">
        <h2 id="how-title">It sits on the wire. Nothing else changes.</h2>
        <p className="sub">One local process between your agent and its MCP servers. It only rewrites tool results.</p>
      </div>
      <div className="pipe reveal" ref={ref} data-play={play} style={{ ['--d' as string]: 1 }}>
        <svg viewBox="0 0 1000 250" role="img" aria-labelledby="pipe-desc">
          <desc id="pipe-desc">
            The agent&apos;s request passes through mto to the MCP server untouched. The large response comes back
            through mto, which removes noise and forwards a smaller result. On any error the original is forwarded.
          </desc>
          <path className="wire" d="M190 92 H810" />
          <path className="wire" d="M190 152 H810" />
          <path className="wire wire--bypass" d="M260 152 C 300 236, 700 236, 740 152" />
          <text className="lbl" x="500" y="244" textAnchor="middle">
            on any error: original forwarded
          </text>
          <text className="lbl" x="300" y="80" textAnchor="middle">
            tools/call, untouched
          </text>
          <text className="lbl" x="690" y="140" textAnchor="middle">
            37,355 tokens
          </text>
          <text className="lbl" x="300" y="140" textAnchor="middle">
            13,244 tokens
          </text>
          <g className="node">
            <rect x="20" y="62" width="170" height="120" rx="14" />
            <text x="105" y="118" textAnchor="middle">
              Your agent
            </text>
            <text className="small" x="105" y="140" textAnchor="middle">
              Copilot, Claude…
            </text>
          </g>
          <g className="node node--mto">
            <rect x="420" y="52" width="160" height="140" rx="14" />
            <text x="500" y="110" textAnchor="middle">
              mto
            </text>
            <text className="small" x="500" y="132" textAnchor="middle">
              127.0.0.1
            </text>
          </g>
          <g className="node">
            <rect x="810" y="62" width="170" height="120" rx="14" />
            <text x="895" y="118" textAnchor="middle">
              MCP server
            </text>
            <text className="small" x="895" y="140" textAnchor="middle">
              github, k8s, …
            </text>
          </g>
          <g className="chip">
            <rect x="372" y="6" width="76" height="26" rx="13" />
            <text x="410" y="23" textAnchor="middle">
              prune
            </text>
            <rect x="462" y="6" width="76" height="26" rx="13" />
            <text x="500" y="23" textAnchor="middle">
              TOON
            </text>
            <rect x="552" y="6" width="76" height="26" rx="13" />
            <text x="590" y="23" textAnchor="middle">
              keep
            </text>
          </g>
          <circle className="pk-req" cx="196" cy="92" r="6" />
          <g className="pk-res">
            <g transform="translate(818 140)">
              {tokens.map((tk, i) => (
                <circle key={i} className={tk.keep ? 'keep' : 'drop'} cx={tk.x} cy={tk.y} r="4.5" />
              ))}
            </g>
          </g>
        </svg>
        <ol className="pipe__steps">
          <li>
            <span className="n">01</span>
            <h3>Request passes through</h3>
            <p>Untouched. Credentials are forwarded, never stored.</p>
          </li>
          <li>
            <span className="n">02</span>
            <h3>Noise is cut</h3>
            <p>Nulls, *_url links, ids and repeats go. JSON becomes TOON.</p>
          </li>
          <li>
            <span className="n">03</span>
            <h3>Nothing is lost</h3>
            <p>Originals stay on disk, one mto_expand call away.</p>
          </li>
        </ol>
      </div>
    </section>
  )
}

/* ---------- Features bento ---------- */
function Tile({
  wide,
  viz,
  title,
  children,
  d,
}: {
  wide?: boolean
  viz: (play: boolean) => ReactNode
  title: string
  children: ReactNode
  d: number
}) {
  const [ref, play] = useInView<HTMLElement>(0.35)
  return (
    <article
      ref={ref}
      className={`tile reveal${wide ? ' tile--wide' : ''}`}
      data-play={play}
      style={{ ['--d' as string]: d }}
    >
      <div className="tile__viz">{viz(play)}</div>
      <div className="tile__txt">
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </article>
  )
}

export function Features() {
  return (
    <section className="sec" id="features" aria-labelledby="features-title">
      <div className="sec__head reveal">
        <h2 id="features-title">Cuts what the model doesn&rsquo;t need. Never what it can&rsquo;t get back.</h2>
      </div>
      <div className="bento">
        <Tile wide d={0} title="Shadow mode" viz={(p) => <ShadowViz play={p} />}>
          Measure real savings while your agent still gets the original. Flip to <code>active</code> when the numbers
          convince you.
        </Tile>
        <Tile d={1} title="Fail-open, never bigger" viz={() => <FailViz />}>
          Any error, timeout or Ollama outage forwards the original. A result ships only if it is cheaper.
        </Tile>
        <Tile d={0} title="Lossless first" viz={() => <ToonViz />}>
          TOON is used only when decoding it reproduces the input exactly. Duplicates become pointers.
        </Tile>
        <Tile wide d={1} title="mto_expand" viz={() => <ExpandViz />}>
          Every cut is named in a note. One call returns the exact original, by outline, JSON path or grep.
        </Tile>
        <Tile d={0} title="Local and private" viz={() => <LocalViz />}>
          Binds to 127.0.0.1. No telemetry. Credentials pass through and are never stored.
        </Tile>
        <Tile wide d={1} title="Any MCP client, reversible" viz={() => <DiffViz />}>
          <code>mto init</code> wraps stdio servers and routes HTTP ones in your agent&rsquo;s config, with a backup.
          One command undoes it.
        </Tile>
      </div>
    </section>
  )
}

/* ---------- Benchmarks: shrinking bars ---------- */
function BenchRow({ b, i, seen, reduced }: { b: (typeof BENCHMARKS)[number]; i: number; seen: boolean; reduced: boolean }) {
  const [n, setN] = useState(reduced ? b.sent : b.original)
  useEffect(() => {
    if (reduced) {
      setN(b.sent)
      return
    }
    if (!seen) return
    let stop = () => {}
    const t = window.setTimeout(() => {
      stop = animateNumber(b.original, b.sent, 1600, (v) => setN(Math.round(v)))
    }, i * 120 + 200)
    return () => {
      window.clearTimeout(t)
      stop()
    }
  }, [seen, reduced, b.original, b.sent, i])
  return (
    <div className="bench__row">
      <p className="bench__name">
        {b.name}
        <small>{b.note ? 'live Copilot A/B run' : 'npm run smoke · no LLM'}</small>
      </p>
      <div className="bench__bars">
        <div className="bench__track" aria-hidden="true" style={{ ['--k' as string]: b.sent / b.original, ['--d' as string]: i }}>
          <i />
        </div>
        <div className="bench__nums">
          <span>{fmt(b.original)} tokens in</span>
          <span>
            <b>{fmt(n)}</b> to the model
          </span>
        </div>
      </div>
      <p className="bench__pct" aria-label={`${b.saved.toFixed(1)} percent saved`}>
        −{b.saved.toFixed(1)}%
      </p>
      {b.note && <p className="bench__note">{b.note}</p>}
    </div>
  )
}

export function Benchmarks() {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()
  const seen = useSeen(ref, 0.25) || reduced
  return (
    <section className="sec" id="benchmarks" aria-labelledby="bench-title">
      <div className="sec__head reveal">
        <h2 id="bench-title">Measured, not promised</h2>
        <p className="sub">Real tool responses, before and after. Reproduce every row on your own machine.</p>
      </div>
      <div className="bench reveal" ref={ref} data-seen={seen} style={{ ['--d' as string]: 1 }}>
        <div className="bench__head">
          <span>tool response</span>
          <span>sent to the model, of the original</span>
          <span>saved</span>
        </div>
        {BENCHMARKS.map((b, i) => (
          <BenchRow key={b.name} b={b} i={i} seen={seen} reduced={reduced} />
        ))}
        <div className="bench__foot cap">
          <span className="key">
            <i /> reaches the model
          </span>
          <span className="key">
            <i className="cut" /> cut by mto, kept on disk
          </span>
          <span>token counts are a model-agnostic estimate</span>
        </div>
      </div>
    </section>
  )
}

/* ---------- Install ---------- */
const INSTALL_TABS: TermTab[] = [
  {
    id: 'install',
    label: 'install',
    foot: 'latest release',
    lines: [
      { k: 'com', t: '# download the latest release tarball' },
      { k: 'cmd', t: DOWNLOAD_LATEST },
      { k: 'cmd', t: INSTALL_LATEST },
      { k: 'cmd', t: 'mto --version' },
      { k: 'out', t: '0.1.0' },
      { k: 'gap' },
      { k: 'com', t: '# npm install -g mcp-token-optimizer  (coming in v3)' },
    ],
  },
  {
    id: 'setup',
    label: 'set up',
    lines: [
      { k: 'cmd', t: 'mto config init' },
      { k: 'com', t: '# wrote ~/.mcp-token-optimizer/config.yaml with all defaults' },
      { k: 'cmd', t: 'mto doctor' },
      { k: 'ok', t: '✓ config: /Users/you/.mcp-token-optimizer/config.yaml' },
      { k: 'out', t: '  mode=active profile=balanced redaction=detect retrieval=true' },
      { k: 'ok', t: '✓ ollama http://127.0.0.1:11434 model qwen3:4b ready' },
      { k: 'cmd', t: 'mto discover' },
      { k: 'hi', t: 'GitHub Copilot / VS Code (user: Code)' },
      { k: 'out', t: '  ~/Library/Application Support/Code/User/mcp.json  [servers]' },
      { k: 'out', t: '    · plain    stdio shadcn' },
      { k: 'out', t: '    · plain    http  github' },
    ],
  },
  {
    id: 'wire',
    label: 'wire your agent',
    lines: [
      { k: 'com', t: '# dry run: prints what would change' },
      { k: 'cmd', t: 'mto init --only shadcn,github' },
      { k: 'cmd', t: 'mto init --only shadcn,github --apply' },
      { k: 'com', t: '# backup saved as <file>.mto.bak · then restart those servers in your agent' },
      { k: 'cmd', t: 'mto stats' },
      { k: 'hi', t: 'server.tool                    calls  tokens_in tokens_out   saved' },
      { k: 'out', t: 'k8s.kube_list_resources            2       9978       4464   55.3%' },
    ],
  },
  {
    id: 'undo',
    label: 'undo',
    lines: [
      { k: 'com', t: '# restore every agent config exactly as it was' },
      { k: 'cmd', t: 'mto uninstall --apply' },
      { k: 'gap' },
      { k: 'com', t: '# or keep it installed and switch it off:' },
      { k: 'com', t: '#   mode: off   in ~/.mcp-token-optimizer/config.yaml' },
      { k: 'gap' },
      { k: 'com', t: '# remove all local state' },
      { k: 'cmd', t: 'rm -rf ~/.mcp-token-optimizer' },
    ],
  },
  {
    id: 'source',
    label: 'from source',
    lines: [
      { k: 'cmd', t: `git clone ${REPO}.git && cd mcp-token-optimizer` },
      { k: 'cmd', t: 'npm install && npm run build' },
      { k: 'cmd', t: 'node dist/cli.js --version' },
      { k: 'out', t: '0.1.0' },
    ],
  },
]

export function Install() {
  return (
    <section className="sec" id="install" aria-labelledby="install-title">
      <div className="split">
        <div className="reveal">
          <div className="sec__head" style={{ marginBottom: 0 }}>
            <h2 id="install-title">Install in a minute. Undo in one line.</h2>
            <p className="sub">Wrap one server, watch the numbers, roll back any time.</p>
          </div>
          <ul className="notes">
            <li>
              <IconInfo />
              <span>
                <b>Start in shadow mode.</b> It measures savings and still forwards the originals.
              </span>
            </li>
            <li>
              <IconInfo />
              <span>
                <b>Live-tested</b> with VS Code Copilot on macOS. Other agents: config handling is unit-tested.
              </span>
            </li>
            <li>
              <IconInfo />
              <span>
                <b>Node 22.15+</b> (20+ works). Ollama is optional, only for summarization.
              </span>
            </li>
          </ul>
          <a className="btn btn--line" href={`${BASE}docs/`} style={{ marginTop: 28 }}>
            <IconBook />
            Read the docs
          </a>
        </div>
        <div className="reveal" style={{ ['--d' as string]: 1 }}>
          <Term tabs={INSTALL_TABS} />
        </div>
      </div>
    </section>
  )
}

/* ---------- Test it: real output ---------- */
const SMOKE = [
  'active: list_issues shrinks >60% (37,355 → ~13k tokens)  (13244 tok)',
  'active: TOON table returned',
  'active: pruned-field note present with expandable id',
  'shadow: agent receives the ORIGINAL (37,355 tokens)  (37355 tok)',
  'off: transparent pass-through',
  'per-tool override: list_issues active, describe_configmap stays shadow',
  'conservative keeps more than balanced (~28k tokens)  (28144 tok)',
  'aggressive shrinks more than balanced (~9.6k tokens)',
  'json-pretty: agent receives valid JSON',
  'structuredContent + outputSchema tool is not altered',
  'k8s dedupe: describeText replaced by pointer',
  'read_file: code is never rewritten (≈ same size)',
  'build_log: repeated lines collapse (>95% saved)',
  'mto_expand path returns the exact pruned value  (7b105335b224)',
  'mto_expand id-only returns an outline, not a dump',
  'mto_expand unknown id → error, not crash',
  'redact mode: secrets replaced',
  'detect mode (default): text untouched',
  'Ollama down: request still succeeds (fail-open, deterministic stages only)  (1489 tok)',
  'http proxy: JSON response optimized, API-key header forwarded',
  'http proxy: SSE response optimized',
  'http proxy: non-loopback Host rejected (403)  (403)',
  'http proxy: unknown route → 404',
  'http proxy: upstream down → 502 with reason',
]
const UNIT = [
  'stdio wrapper: optimizes tool results, injects mto_expand, answers it locally',
  'end to end: prune -> agent calls mto_expand with a path -> gets the exact pruned field',
  'http proxy: forwards headers, optimizes JSON + SSE, injects mto_expand, guards host',
  'init wraps stdio servers, wraps stdio + http, backs up; uninstall restores exactly',
  'JSONC (VS Code mcp.json): comments + trailing commas survive wrap and unwrap',
  'unparsable files are reported and never modified',
  'JSON is pruned and re-encoded as TOON when cheaper, semantics intact',
  'structuredContent is never touched',
  'never returns something bigger than the input',
  'summary that drops critical facts is repaired or rejected, never silently lossy',
  'code and file reads are never summarized',
  'LLM failure falls back to deterministic cleanup',
  'cross-field dedupe: echoed content is replaced by a pointer, canonical copy untouched',
  'pruned results carry an expandable note; original is recoverable byte-for-byte',
  'fuzz: random JSON round-trips',
]

const TEST_TABS: TermTab[] = [
  {
    id: 'smoke',
    label: 'npm run smoke',
    foot: 'real output · 24 checks',
    lines: [
      { k: 'cmd', t: 'npm run smoke' },
      ...SMOKE.map((t) => ({ k: 'ok' as const, t: `PASS  ${t}` })),
      { k: 'gap' },
      { k: 'hi', t: 'All checks passed' },
    ],
  },
  {
    id: 'test',
    label: 'npm test',
    foot: 'real output, abridged · 42 tests',
    lines: [
      { k: 'cmd', t: 'npm test' },
      ...UNIT.map((t, i) => ({ k: 'out' as const, t: `ok ${i + 1} - ${t}` })),
      { k: 'out', t: '…' },
      { k: 'gap' },
      { k: 'hi', t: '# tests 42' },
      { k: 'ok', t: '# pass 42' },
      { k: 'out', t: '# fail 0' },
    ],
  },
  {
    id: 'demo',
    label: 'npm run demo',
    foot: 'real output, abridged · no agent needed',
    lines: [
      { k: 'cmd', t: 'npm run demo' },
      { k: 'out', t: 'tools: list_issues, describe_configmap, fetch_guide, build_log, get_secrets, get_page, read_file, get_rows, mto_expand' },
      { k: 'hi', t: '[40]:' },
      { k: 'out', t: '  - url: "https://api.github.com/repos/acme/widgets/issues/1000"' },
      { k: 'out', t: '    html_url: "https://github.com/acme/widgets/issues/1000"' },
      { k: 'out', t: '    number: 1000' },
      { k: 'out', t: '    title: Widget 0 fails when config key alpha is missing' },
      { k: 'out', t: '    labels[1]{id,name,color,default}:' },
      { k: 'out', t: '      1,bug,d73a4a,true' },
      { k: 'out', t: '    state: closed' },
      { k: 'out', t: '  …' },
      { k: 'cut', t: '[mto: pruned low-value fields: events_url×80, node_id×80, labels_url×40, avatar_url×40, gravatar_id×40, followers_url×40. Only if you need them: mto_expand {"id":"7b105335b224","path":...}]' },
      { k: 'gap' },
      { k: 'ok', t: '── agent received: 35386 chars, ~13244 tokens' },
    ],
  },
]

export function TestIt() {
  return (
    <section className="sec" id="test" aria-labelledby="test-title">
      <div className="split">
        <div className="reveal">
          <div className="sec__head" style={{ marginBottom: 0 }}>
            <h2 id="test-title">Don&rsquo;t trust us. Run it.</h2>
            <p className="sub">Clone the repo. These need Node and nothing else: no agent, no network, no LLM.</p>
          </div>
          <p className="cap" style={{ marginTop: 22 }}>
            The full six-layer guide, including a live A/B test with your own agent, is in{' '}
            <a className="link" href={`${REPO}/blob/main/TESTING.md`}>
              TESTING.md
            </a>
            .
          </p>
        </div>
        <div className="reveal" style={{ ['--d' as string]: 1 }}>
          <Term tabs={TEST_TABS} />
        </div>
      </div>
    </section>
  )
}

/* ---------- Maker + contribute ---------- */
/** A card that tilts toward the pointer with eased (lerped) motion and a following glare. */
function TiltCard({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()
  useEffect(() => {
    const el = ref.current
    if (!el || reduced || !window.matchMedia('(hover: hover)').matches) return
    let raf = 0
    const cur = { x: 0, y: 0 }
    const tgt = { x: 0, y: 0 }
    const tick = () => {
      cur.x += (tgt.x - cur.x) * 0.12
      cur.y += (tgt.y - cur.y) * 0.12
      el.style.transform = `perspective(900px) rotateX(${cur.y * -7}deg) rotateY(${cur.x * 9}deg)`
      if (Math.abs(tgt.x - cur.x) > 0.001 || Math.abs(tgt.y - cur.y) > 0.001) raf = requestAnimationFrame(tick)
      else raf = 0
    }
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick)
    }
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width
      const py = (e.clientY - r.top) / r.height
      tgt.x = px - 0.5
      tgt.y = py - 0.5
      el.style.setProperty('--gx', `${px * 100}%`)
      el.style.setProperty('--gy', `${py * 100}%`)
      kick()
    }
    const leave = () => {
      tgt.x = 0
      tgt.y = 0
      kick()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  }, [reduced])
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}

const CONTRIB = [
  {
    icon: IconBug,
    title: 'Report a bug',
    body: 'Something broke in your setup? The template asks for doctor output and your agent.',
    href: `${REPO}/issues/new?template=bug_report.yml`,
    go: 'bug_report.yml',
  },
  {
    icon: IconSpark,
    title: 'Request an enhancement',
    body: 'A tool it should handle, a format, an agent. Describe the problem first.',
    href: `${REPO}/issues/new?template=feature_request.yml`,
    go: 'feature_request.yml',
  },
  {
    icon: IconCode,
    title: 'Contribute code',
    body: 'Small, tested PRs are welcome. Start with the contributing guide.',
    href: `${REPO}/blob/main/CONTRIBUTING.md`,
    go: 'CONTRIBUTING.md',
  },
  {
    icon: IconChat,
    title: 'Share feedback',
    body: 'Anything else: a question, an idea, how it went on your machine.',
    href: `${REPO}/issues/new?template=feedback.yml`,
    go: 'feedback.yml',
  },
]

export function Maker() {
  return (
    <section className="sec" id="contribute" aria-labelledby="maker-title">
      <div className="sec__head reveal">
        <h2 id="maker-title">Built in the open</h2>
        <p className="sub">One maintainer, Apache-2.0, issues read by a human.</p>
      </div>
      <div className="maker">
        <TiltCard className="dev reveal">
          <div className="dev__id">
            <img
              src={`https://github.com/${GITHUB_USER}.png?size=160`}
              alt={AUTHOR}
              width="64"
              height="64"
              loading="lazy"
            />
            <div>
              <h3>{AUTHOR}</h3>
              <p className="dev__role">Full Stack Developer · AI</p>
              <p className="dev__made">maker of mcp-token-optimizer</p>
            </div>
          </div>
          <p className="dev__quote">
            Built to stop agents paying for tool noise from MCP responses.
          </p>
          <dl className="dev__facts">
            <div>
              <dt>latest release</dt>
              <dd>
                <a href={`${REPO}/releases/latest`}>v0.1.0</a> · Sep 21, 2026
              </dd>
            </div>
            <div>
              <dt>tested</dt>
              <dd>42 tests · 24 smoke checks</dd>
            </div>
            <div>
              <dt>stack</dt>
              <dd>TypeScript · Node 20+ · MCP</dd>
            </div>
            <div>
              <dt>license</dt>
              <dd>Apache-2.0, self-hosted</dd>
            </div>
          </dl>
          <div className="dev__links">
            <a className="btn btn--solid" href={`https://github.com/${GITHUB_USER}`}>
              <IconGithub />@{GITHUB_USER}
            </a>
            {LINKEDIN && (
              <a className="btn btn--line" href={LINKEDIN}>
                <IconLinkedin />
                LinkedIn
              </a>
            )}
          </div>
        </TiltCard>
        <div className="contrib">
          {CONTRIB.map((c, i) => (
            <a className="card reveal" key={c.title} href={c.href} style={{ ['--d' as string]: i }}>
              <c.icon />
              <h3>{c.title}</h3>
              <p>{c.body}</p>
              <span className="go">
                {c.go}
                <IconArrow />
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
