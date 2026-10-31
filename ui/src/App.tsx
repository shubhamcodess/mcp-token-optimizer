import { useEffect, useState } from 'preact/hooks'
import { ApiError, api, token, type Status } from './api'
import { Captures } from './Captures'
import { Config } from './Config'
import { Connections } from './Connections'
import { Doctor } from './Doctor'
import { Eval } from './Eval'
import { Drift } from './Drift'
import { Help } from './Help'
import { Moon, Mark, Sun } from './icons'
import { Overview } from './Overview'
import { Traffic } from './Traffic'

type Page = 'overview' | 'traffic' | 'connections' | 'config' | 'captures' | 'eval' | 'doctor' | 'help'
const PAGES: Array<[Page, string]> = [['overview', 'Overview'], ['traffic', 'Traffic'], ['connections', 'Connections'], ['config', 'Config'], ['captures', 'Captures'], ['eval', 'Eval'], ['doctor', 'Doctor'], ['help', 'Help']]

const pageFromHash = (): Page => {
  const h = location.hash.replace(/^#\/?/, '')
  return PAGES.some(([p]) => p === h) ? (h as Page) : 'overview'
}

export function App() {
  const [page, setPage] = useState<Page>(pageFromHash)
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') ?? 'light')

  useEffect(() => {
    const on = () => setPage(pageFromHash())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])

  useEffect(() => {
    if (!token()) return
    let stop = false
    const load = () =>
      api<Status>('/api/status')
        .then((s) => (!stop && (setStatus(s), setError(null))))
        .catch((e: unknown) => !stop && setError(e instanceof ApiError && e.status === 401 ? 'token' : 'down'))
    void load()
    const t = setInterval(load, 5000)
    return () => ((stop = true), clearInterval(t))
  }, [])

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem('mto-theme', next)
    } catch {
      /* storage can be unavailable; the theme still applies for this visit */
    }
  }

  const blocked = !token() || error === 'token'
  return (
    <>
      <header class="nav">
        <div class="nav__row">
          <a class="brand" href="#/overview" aria-label="mto dashboard">
            <Mark />
            mto
          </a>
          <nav class="tabs" aria-label="Main">
            {PAGES.filter(([p]) => p !== 'captures' || status?.capture).map(([p, label]) => (
              <a href={`#/${p}`} aria-current={page === p ? 'page' : undefined}>{label}</a>
            ))}
          </nav>
          <div class="nav__end">
            {status && (
              <span class="pill" title={`v${status.version} · pid ${status.pid}`}>
                <span class={`dot ${status.mode === 'active' ? 'dot--ok' : status.mode === 'shadow' ? 'dot--cut' : ''}`} />
                {status.mode}
              </span>
            )}
            <button class="icon-btn" onClick={toggle} aria-label="Toggle theme">{theme === 'dark' ? <Sun /> : <Moon />}</button>
          </div>
        </div>
      </header>
      <main class="page">
        {blocked ? (
          <div class="banner">
            This page needs the daemon's session token. Run <code>mto ui</code> in a terminal to open the dashboard with it.
          </div>
        ) : (
          <>
            {error === 'down' && <div class="banner" style="margin-bottom:16px">The daemon is not reachable. Start it with <code>mto serve</code>.</div>}
            {status && status.drift > 0 && <Drift count={status.drift} />}
            {page === 'overview' && <Overview status={status} />}
            {page === 'traffic' && <Traffic />}
            {page === 'connections' && <Connections />}
            {page === 'config' && <Config />}
            {page === 'captures' && (status?.capture ? <Captures enabled /> : <div class="banner">Capture is off, so this page is hidden. Turn it on from Doctor, or run <code>mto capture on</code>.</div>)}
            {page === 'eval' && <Eval />}
            {page === 'doctor' && <Doctor status={status} />}
            {page === 'help' && <Help />}
          </>
        )}
      </main>
    </>
  )
}
