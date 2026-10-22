import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { IconCheck, IconPause, IconPlay, IconReplay } from './Icons'
import { usePrefersReducedMotion } from './hooks'

// Real sample: the first issue of examples/github-issues.json (synthetic acme/widgets data).
const RAW: { t: string; noise?: boolean }[] = [
  { t: '[' },
  { t: '  {' },
  { t: '    "url": "https://api.github.com/repos/acme/widgets/issues/1000",' },
  { t: '    "repository_url": "https://api.github.com/repos/acme/widgets",' },
  { t: '    "labels_url": "https://api.github.com/repos/acme/widgets/issues/1000/labels{/name}",', noise: true },
  { t: '    "comments_url": "https://api.github.com/repos/acme/widgets/issues/1000/comments",' },
  { t: '    "events_url": "https://api.github.com/repos/acme/widgets/issues/1000/events",', noise: true },
  { t: '    "html_url": "https://github.com/acme/widgets/issues/1000",' },
  { t: '    "id": 5000000,' },
  { t: '    "node_id": "I_kwDOAbCdEf0xYz",', noise: true },
  { t: '    "number": 1000,' },
  { t: '    "title": "Widget 0 fails when config key alpha is missing",' },
  { t: '    "user": {' },
  { t: '      "login": "octo",' },
  { t: '      "node_id": "MDQ6VXNlcjEw0",', noise: true },
  { t: '      "avatar_url": "https://avatars.githubusercontent.com/u/100?v=4",', noise: true },
  { t: '      "gravatar_id": "",', noise: true },
  { t: '      "followers_url": "https://api.github.com/users/octo/followers",', noise: true },
  { t: '      "following_url": "https://api.github.com/users/octo/following{/other_user}",', noise: true },
  { t: '      "gists_url": "https://api.github.com/users/octo/gists{/gist_id}",', noise: true },
  { t: '      "type": "User"' },
  { t: '    },' },
  { t: '    "state": "closed",' },
  { t: '    … 39 more issues' },
]

// Real output: what mto handed the agent for the same call (TOON), abridged.
const TOON = `[40]:
  - url: "https://api.github.com/repos/acme/widgets/issues/1000"
    repository_url: "https://api.github.com/repos/acme/widgets"
    comments_url: ".../issues/1000/comments"
    html_url: "https://github.com/acme/widgets/issues/1000"
    id: 5000000
    number: 1000
    title: Widget 0 fails when config key alpha is missing
    user:
      login: octo
      id: 100
      type: User
    labels[1]{id,name,color,default}:
      1,bug,d73a4a,true
    state: closed
  - url: "https://api.github.com/repos/acme/widgets/issues/1001"
  … 38 more`

const NOTE =
  '[mto: pruned low-value fields: events_url×80, node_id×80, labels_url×40, avatar_url×40, gravatar_id×40, followers_url×40. Only if you need them: mto_expand {"id":"7b105335b224","path":...}]'

const PROMPT = 'Triage the issues in acme/widgets and tell me what keeps breaking.'
const ANSWER =
  'Read all 40 issues in 13,244 tokens instead of 37,355. Every one fails on a missing config key. Want me to label them config?'

const ORIGINAL = 37355
const SENT = 13244

// Timeline in ms; one loop is CYCLE long.
const T = {
  promptStart: 400,
  promptEnd: 1900,
  send: 2100,
  agent: 2500,
  tool: 2800,
  rawStart: 3000,
  rawEnd: 4400,
  flag: 4700,
  strike: 5400,
  cut: 6500,
  toon: 7900,
  done: 8200,
  answerStart: 8700,
  answerEnd: 10600,
}
const CYCLE = 15500
const FINAL = 12000

const clamp = (v: number) => Math.min(1, Math.max(0, v))
const ease = (v: number) => (v >= 1 ? 1 : 1 - Math.pow(2, -10 * v))
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const typed = (s: string, t: number, a: number, b: number) =>
  s.slice(0, Math.round(clamp((t - a) / (b - a)) * s.length))

function Json({ line }: { line: string }) {
  const m = line.match(/^(\s*)("[^"]+")(:.*)$/)
  if (!m) return <>{line}</>
  return (
    <>
      {m[1]}
      <span className="k">{m[2]}</span>
      {m[3]}
    </>
  )
}

function Toon({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((l, i) => {
        const m = l.match(/^(\s*-?\s*)([\w[\]{},]+:)(.*)$/)
        return (
          <span key={i}>
            {m ? (
              <>
                {m[1]}
                <span className="k">{m[2]}</span>
                {m[3]}
              </>
            ) : (
              l
            )}
            {'\n'}
          </span>
        )
      })}
    </>
  )
}

export function AgentMock() {
  const reduced = usePrefersReducedMotion()
  const root = useRef<HTMLDivElement>(null)
  const [t, setT] = useState(reduced ? FINAL : 0)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(false)
  const clock = useRef({ base: 0, offset: 0 })

  useEffect(() => {
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.2 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (reduced) {
      setT(FINAL)
      return
    }
    if (!visible || paused) return
    let raf = 0
    let last = 0
    clock.current.base = performance.now() - clock.current.offset
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < 32) return
      last = now
      const elapsed = (now - clock.current.base) % CYCLE
      clock.current.offset = elapsed
      setT(elapsed)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [visible, paused, reduced])

  const replay = () => {
    clock.current.offset = 0
    clock.current.base = performance.now()
    setT(0)
    setPaused(false)
  }

  const prompt = t < T.send ? typed(PROMPT, t, T.promptStart, T.promptEnd) : PROMPT
  const sent = t >= T.send
  const rawShown = Math.round(clamp((t - T.rawStart) / (T.rawEnd - T.rawStart)) * RAW.length)
  const phase =
    t >= T.cut ? 'cut' : t >= T.strike ? 'strike' : t >= T.flag ? 'flag' : 'raw'
  const toon = t >= T.toon
  const done = t >= T.done

  let count = 0
  if (t >= T.rawStart && t < T.cut) count = ORIGINAL * ease(clamp((t - T.rawStart) / (T.rawEnd - T.rawStart)))
  else if (t >= T.cut) count = ORIGINAL - (ORIGINAL - SENT) * ease(clamp((t - T.cut) / 1300))

  const answer = typed(ANSWER, t, T.answerStart, T.answerEnd)
  const answering = t >= T.answerStart && t < T.answerEnd
  const fadeOut = !reduced && t > CYCLE - 500 ? 0 : 1

  let ni = 0
  const rawLines: ReactNode[] = RAW.map((l, i) => {
    const hidden = i >= rawShown
    const cls = ['jl']
    if (hidden) cls.push('jl--hidden')
    if (l.noise) {
      cls.push('jl--noise')
      if (phase !== 'raw') cls.push('is-flag')
      if (phase === 'strike' || phase === 'cut') cls.push('is-strike')
      if (phase === 'cut') cls.push('is-cut')
    }
    return (
      <div key={i} className={cls.join(' ')} style={l.noise ? ({ ['--i' as string]: ni++ } as CSSProperties) : undefined}>
        <span>
          <Json line={l.t} />
        </span>
      </div>
    )
  })

  return (
    <div ref={root}>
      <p className="sr-only">
        Animated example: a coding agent asks the GitHub MCP server for 40 issues. The response is 37,355 tokens;
        mto removes noise fields such as node_id, avatar_url and the *_url links, keeps the originals, and the
        agent receives 13,244 tokens, 64.5% fewer.
      </p>
      <div className="app" aria-hidden="true" style={{ opacity: fadeOut, transition: 'opacity 400ms' }}>
        <div className="app__bar">
          <span className="app__dots">
            <i />
            <i />
            <i />
          </span>
          <span className="app__title">acme/widgets · agent</span>
          <span className="app__status">
            mto <b>active</b>
          </span>
        </div>
        <div className="app__body">
          <aside className="app__side">
            <div>
              <p className="side__label">CHATS</p>
              <p className="side__item side__item--on">
                <span>Triage widget issues</span>
              </p>
              <p className="side__item">
                <span>Fix flaky CI test</span>
              </p>
              <p className="side__item">
                <span>Bump dependencies</span>
              </p>
            </div>
            <div>
              <p className="side__label">MCP SERVERS</p>
              <p className="side__item">
                <span>github</span>
                <small>via mto</small>
              </p>
              <p className="side__item">
                <span>kubernetes</span>
                <small>via mto</small>
              </p>
              <p className="side__item">
                <span>filesystem</span>
              </p>
            </div>
            <p className="side__foot">mto 0.1.0 · 127.0.0.1</p>
          </aside>

          <div className="app__chat">
            <div className="msg msg--user">
              {prompt}
              {!sent && t >= T.promptStart && <span className="caret" />}
            </div>
            {t >= T.agent && (
              <p className="msg msg--agent appear">
                Fetching issues from <b>github</b>.
              </p>
            )}
            {t >= T.tool && (
              <div className="tool appear">
                <div className="tool__head">
                  {done ? <IconCheck className="ok" /> : <span className="spin" />}
                  <span>github.list_issues</span>
                  <span className="via">via mto</span>
                </div>
                <div className="tool__args">{'{ "repo": "acme/widgets", "per_page": 40 }'}</div>
                {done && (
                  <div className="tool__meter appear">
                    <div className="row">
                      <span>{fmt(ORIGINAL)} from server</span>
                      <span>{fmt(SENT)} to model</span>
                    </div>
                    <div className="track">
                      <i style={{ transform: `scaleX(${SENT / ORIGINAL})` }} />
                    </div>
                    <div className="row">
                      <span>pruned · TOON · original kept</span>
                      <b>−64.5%</b>
                    </div>
                  </div>
                )}
              </div>
            )}
            {t >= T.answerStart && (
              <p className="msg msg--agent appear">
                {answer}
                {answering && <span className="caret" />}
              </p>
            )}
          </div>

          <div className="app__insp">
            <div className="insp__tabs">
              <span className={toon ? 'insp__tab' : 'insp__tab insp__tab--on'}>server response</span>
              <span className={toon ? 'insp__tab insp__tab--on' : 'insp__tab'}>sent to model</span>
              <span className="insp__count">
                {t >= T.cut && <s>{fmt(ORIGINAL)}</s>}
                {fmt(count)} tok
              </span>
            </div>
            <div className="insp__body">
              {toon ? (
                <div className="toon" key="toon">
                  <Toon text={TOON} />
                  <span className="note">{NOTE}</span>
                </div>
              ) : (
                rawLines
              )}
            </div>
          </div>
        </div>
        <div className="app__foot">
          <span>
            github · list_issues · <b>{done ? `${fmt(SENT)} tok` : t >= T.rawStart ? `${fmt(count)} tok` : 'idle'}</b>
          </span>
          <span>fail-open · originals kept for mto_expand</span>
        </div>
      </div>
      <div className="app-cap">
        <p className="cap">
          Replay of a real call: <b>npm run demo</b> on the repo&rsquo;s sample data. Agent wording is illustrative.
        </p>
        {!reduced && (
          <span className="ctl">
            <button type="button" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
              {paused ? <IconPlay /> : <IconPause />}
              {paused ? 'Play' : 'Pause'}
            </button>
            <button type="button" onClick={replay}>
              <IconReplay />
              Replay
            </button>
          </span>
        )}
      </div>
    </div>
  )
}
