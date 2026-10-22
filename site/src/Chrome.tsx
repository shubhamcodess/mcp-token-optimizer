import { useEffect, useState } from 'react'
import { REPO } from './data'
import { IconCheck, IconCopy, IconGithub, IconMoon, IconSun, Mark } from './Icons'

type Theme = 'light' | 'dark'

function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

export function Nav({ page = 'home' }: { page?: 'home' | 'docs' }) {
  const base = import.meta.env.BASE_URL
  const home = page === 'home' ? '' : base
  const [theme, setTheme] = useState<Theme>(currentTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem('mto-theme', next)
    } catch {
      /* storage can be unavailable; the theme still applies for this visit */
    }
  }

  return (
    <header className="nav">
      <div className="nav__row">
        <a className="brand" href={page === 'home' ? '#top' : base} aria-label="mcp-token-optimizer home">
          <Mark />
          mcp-token-optimizer
        </a>
        <nav className="nav__links" aria-label="Main">
          <span className="nav__anchors">
            <a href={`${home}#how`}>How it works</a>
            <a href={`${home}#features`}>Features</a>
            <a href={`${home}#benchmarks`}>Benchmarks</a>
            <a href={`${home}#install`}>Install</a>
          </span>
          <a href={`${base}docs/`} aria-current={page === 'docs' ? 'page' : undefined}>
            Docs
          </a>
          <span className="nav__sep" aria-hidden="true" />
          <a href={REPO} aria-label="GitHub repository">
            <IconGithub />
          </a>
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
        </nav>
      </div>
    </header>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setState('done')
    } catch {
      setState('failed')
    }
    window.setTimeout(() => setState('idle'), 1800)
  }

  return (
    <button type="button" className="copy" onClick={copy} data-done={state === 'done'} aria-live="polite">
      {state === 'done' ? <IconCheck /> : <IconCopy />}
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Select it' : label}
    </button>
  )
}

export function Footer() {
  return (
    <footer className="foot">
      <span>© mcp-token-optimizer · Apache-2.0 · runs on your machine, no telemetry</span>
      <ul>
        <li>
          <a href={REPO}>GitHub</a>
        </li>
        <li>
          <a href={`${import.meta.env.BASE_URL}docs/`}>Docs</a>
        </li>
        <li>
          <a href={`${REPO}/blob/main/CHANGELOG.md`}>Changelog</a>
        </li>
        <li>
          <a href={`${REPO}/blob/main/TESTING.md`}>Testing</a>
        </li>
        <li>
          <a href={`${REPO}/blob/main/SECURITY.md`}>Security</a>
        </li>
        <li>
          <a href={`${REPO}/blob/main/CONTRIBUTING.md`}>Contributing</a>
        </li>
      </ul>
    </footer>
  )
}
