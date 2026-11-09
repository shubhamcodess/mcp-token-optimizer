import { marked } from 'marked'
import { useEffect, useMemo, useState } from 'react'
import troubleshooting from '../../TROUBLESHOOTING.md?raw'
import readme from '../../README.md?raw'
import security from '../../SECURITY.md?raw'
import dashboard from '../../docs/dashboard.md?raw'
import gettingStarted from '../../docs/getting-started.md?raw'
import howItWorks from '../../docs/how-it-works.md?raw'
import reference from '../../docs/reference.md?raw'
import tuning from '../../docs/tuning.md?raw'
import { Footer, Nav } from './Chrome'
import { REPO } from './data'
import { ReviewPanel } from './ReviewPanel'
import { IconBook, IconCode, IconGithub } from './Icons'

const BLOB = `${REPO}/blob/main`

// Every guide the page is assembled from, by repository path. Numbered "## n." sections are taken
// from each, plus "Why" and "Results" from the README, then ordered by number.
const GUIDES: Record<string, string> = {
  'README.md': readme,
  'docs/getting-started.md': gettingStarted,
  'docs/how-it-works.md': howItWorks,
  'docs/tuning.md': tuning,
  'docs/reference.md': reference,
  'TROUBLESHOOTING.md': troubleshooting,
  'SECURITY.md': security,
  'docs/dashboard.md': dashboard,
}

// Source files behind each section, linked under its heading.
const SOURCES: Record<string, string[]> = {
  '1': ['src/cli.ts', 'src/installer.ts', 'src/config.ts'],
  '2': ['scripts/mcp-call.mjs', 'examples/fake-mcp-server.mjs'],
  '3': ['src/pipeline.ts', 'src/prune.ts', 'src/toon.ts'],
  '4': ['src/config.ts', 'src/session.ts'],
  '5': ['src/stdio.ts', 'src/http.ts', 'src/routes.ts'],
  '6': ['src/prune.ts'],
  '7': ['src/toon.ts', 'src/pipeline.ts'],
  '8': ['src/summarize.ts', 'src/llm.ts'],
  '9': ['src/session.ts', 'src/store.ts'],
  '10': ['src/redact.ts'],
  '11': ['src/capture.ts', 'src/bench.ts', 'src/compare.ts'],
  '12': ['src/config.ts', 'mto.config.example.yaml'],
  '13': ['src/cli.ts'],
  '14': ['src/config.ts', 'src/store.ts'],
  '16': ['SECURITY.md'],
  '17': ['TESTING.md'],
  '18': ['CONTRIBUTING.md'],
}

/** GitHub's heading anchor algorithm on plain text, so the README's own cross-links keep working. */
function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

/** Resolves a link relative to the guide's own folder into a repository path. */
function repoPath(from: string, href: string) {
  const parts = from.split('/').slice(0, -1)
  for (const seg of href.replace(/^\.\//, '').split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

/**
 * Relative links: to a section on this page → an in-page anchor; to a guide on this page → its first
 * section; to anything else in the repo (TESTING.md, LICENSE, a config file) → GitHub.
 */
function rewriteLinks(md: string, from: string, firstId: Record<string, string>) {
  return md.replace(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, (_m, href: string) => {
    const [path, hash] = href.split('#')
    const target = repoPath(from, path)
    if (target in GUIDES && (hash || firstId[target])) return `](#${hash ?? firstId[target]})`
    return `](${BLOB}/${target}${hash ? `#${hash}` : ''})`
  })
}

function highlight(html: string) {
  return html.replace(/<pre><code(?: class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/g, (_m, lang: string, body: string) => {
    const out = body
      .split('\n')
      .map((line) => {
        let l = line
        // strings
        l = l.replace(/(&quot;[^&]*?&quot;)/g, '<span class="s">$1</span>')
        if (lang === 'yaml' || lang === 'yml') l = l.replace(/^(\s*-?\s*)([\w.*"-]+)(:)/, '$1<span class="k">$2</span>$3')
        // comments (outside strings, roughly)
        const hash = l.search(/(^|\s)#(?![^<]*<\/span>)/)
        if (hash >= 0 && (lang === 'bash' || lang === 'sh' || lang === 'yaml' || lang === 'yml' || !lang)) {
          l = `${l.slice(0, hash)}<span class="c">${l.slice(hash)}</span>`
        }
        return l
      })
      .join('\n')
    return `<pre><code class="language-${lang ?? 'text'}">${out}</code></pre>`
  })
}

interface Section {
  num: string
  title: string
  id: string
  html: string
  file: string
}

function buildSections(): Section[] {
  const raw = Object.entries(GUIDES).flatMap(([file, md]) =>
    md
      .split(/\n(?=## )/)
      .filter((p) => /^## \d+\./.test(p) || (file === 'README.md' && /^## (Why|Results)\b/.test(p)))
      .map((p) => {
        const first = p.split('\n')[0].replace(/^## /, '')
        return { file, part: p, first, num: (first.match(/^(\d+)\./) ?? [])[1] ?? '', id: slug(first) }
      }),
  )
  const firstId: Record<string, string> = {}
  for (const r of raw) firstId[r.file] ??= r.id
  // README's Why and Results lead, then numbered sections in order
  raw.sort((a, b) => (a.num ? Number(a.num) : -1) - (b.num ? Number(b.num) : -1))
  return raw.map(({ file, part, first, num, id }) => {
    const body = rewriteLinks(part.split('\n').slice(1).join('\n').replace(/\n---\s*$/m, ''), file, firstId)
    const renderer = new marked.Renderer()
    renderer.heading = ({ tokens, depth, text: raw }) => {
      // anchor from the heading's plain text (markdown source minus formatting), never from rendered HTML
      const hid = slug(raw)
      return `<h${depth} id="${hid}">${marked.Parser.parseInline(tokens)}</h${depth}>`
    }
    const html = highlight(marked.parse(body, { renderer, async: false }) as string)
    return { num, title: first, id, html, file }
  })
}

export default function Docs() {
  const sections = useMemo(buildSections, [])
  const [on, setOn] = useState(sections[0]?.id)

  useEffect(() => {
    // scroll-spy: the active section is the last heading above the nav line
    const heads = [...document.querySelectorAll<HTMLElement>('.md h2')]
    const update = () => {
      let current = heads[0]?.id
      for (const h of heads) {
        if (h.getBoundingClientRect().top - 120 <= 0) current = h.id
        else break
      }
      setOn(current)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])

  useEffect(() => {
    // honour a deep link like docs/#9-getting-the-original-back-mto_expand once layout and fonts settle
    if (!location.hash) return
    const go = () => {
      document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ behavior: 'instant', block: 'start' })
      window.dispatchEvent(new Event('scroll')) // let the scroll-spy catch up with the jump
    }
    requestAnimationFrame(go)
    document.fonts?.ready.then(go)
    window.addEventListener('load', go, { once: true })
    return () => window.removeEventListener('load', go)
  }, [])

  const plain = (t: string) => t.replace(/`/g, '')

  return (
    <>
      <Nav page="docs" />
      <div className="frame">
        <div className="docs">
          <aside className="toc" aria-label="Documentation contents">
            <p>GET STARTED</p>
            {sections
              .filter((s) => !s.num || Number(s.num) <= 2)
              .map((s) => (
                <a key={s.id} href={`#${s.id}`} className={on === s.id ? 'on' : undefined}>
                  {plain(s.title)}
                </a>
              ))}
            <p>CONCEPTS AND CONFIG</p>
            {sections
              .filter((s) => Number(s.num) >= 3 && Number(s.num) <= 11)
              .map((s) => (
                <a key={s.id} href={`#${s.id}`} className={on === s.id ? 'on' : undefined}>
                  {plain(s.title)}
                </a>
              ))}
            <p>REFERENCE</p>
            {sections
              .filter((s) => Number(s.num) >= 12)
              .map((s) => (
                <a key={s.id} href={`#${s.id}`} className={on === s.id ? 'on' : undefined}>
                  {plain(s.title)}
                </a>
              ))}
          </aside>
          <main className="doc">
            <header className="doc__top">
              <h1>Documentation</h1>
              <p className="sub">
                Install it, wire your agent, choose a mode and profile, run the proxy, get originals back with
                mto_expand. Rendered from the guides in the repository, so it is always current.
              </p>
              <div className="doc__meta">
                <a href={`${REPO}/tree/main/docs`}>
                  <IconGithub />
                  docs/
                </a>
                <a href={`${BLOB}/TESTING.md`}>
                  <IconBook />
                  TESTING.md
                </a>
                <a href={`${REPO}/tree/main/src`}>
                  <IconCode />
                  src/
                </a>
              </div>
            </header>
            <article className="md">
              {sections.map((s) => (
                <section key={s.id} aria-labelledby={s.id}>
                  <h2 id={s.id} dangerouslySetInnerHTML={{ __html: marked.parseInline(s.title) as string }} />
                  <div className="src">
                    <a href={`${BLOB}/${s.file}#${s.id}`}>{s.file}</a>
                    {(SOURCES[s.num] ?? []).map((f) => (
                      <a key={f} href={`${BLOB}/${f}`}>
                        {f}
                      </a>
                    ))}
                  </div>
                  <div dangerouslySetInnerHTML={{ __html: s.html }} />
                </section>
              ))}
            </article>
          </main>
        </div>
        <Footer />
      </div>
      <ReviewPanel />
    </>
  )
}
