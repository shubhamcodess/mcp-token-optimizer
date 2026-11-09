import { useEffect, useState } from 'react'
import { AUTHOR, NPM_URL, REPO, compact } from './data'
import { useStats } from './hooks'
import { IconCheck, IconCopy, IconGithub, IconMoon, IconNpm, IconStar, IconSun, Mark } from './Icons'
import { usePH, useShowStars } from './review'

type Theme = 'light' | 'dark'

const YEAR = new Date().getFullYear()

function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
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
    <>
    <LaunchBar />
    <header className="nav">
      <div className="nav__row">
        <a className="brand" href={page === 'home' ? '#top' : base} aria-label="mcp-token-optimizer home">
          <Mark />
          <BrandName />
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
          <StarButton className="nav__star" />
          <a href={NPM_URL} aria-label="npm package" title="npm">
            <IconNpm />
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
    </>
  )
}

/**
 * Launch-day strip above the nav: the first thing a visitor from anywhere sees. Scrolls away with
 * the page; the hero, closing section and footer keep their Product Hunt buttons.
 */
function LaunchBar() {
  const ph = usePH()
  if (!ph.live) return null
  return (
    <a className="launch" href={ph.url}>
      <PhLogo />
      <span className="launch__text">
        <b>mto is live on Product Hunt today.</b>
        <span className="launch__more"> An upvote helps other developers find it.</span>
      </span>
      <span className="launch__cta">
        <IconUpvote />
        Upvote
      </span>
    </a>
  )
}

/**
 * "mto", spelled from the initials of the full name. Hovering (or focusing) the brand slides the
 * rest of each word in, so it reads mcp-token-optimizer.
 */
function BrandName() {
  return (
    <span className="brand__name" aria-hidden="true">
      m<span className="brand__x" style={{ ['--w' as string]: '3ch' }}>cp-</span>
      t<span className="brand__x" style={{ ['--w' as string]: '5ch' }}>oken-</span>
      o<span className="brand__x" style={{ ['--w' as string]: '8ch' }}>ptimizer</span>
    </span>
  )
}

/** GitHub star call to action. The live count shows once it reaches STAR_MIN. */
export function StarButton({
  className = '',
  label = 'Star',
  count = true,
}: {
  className?: string
  label?: string
  /** false where the star count is already shown nearby (the hero proof row) */
  count?: boolean
}) {
  const { stars } = useStats()
  const show = useShowStars(stars) && count
  return (
    <a
      className={`star ${className}`}
      href={REPO}
      aria-label={show ? `Star on GitHub, ${stars} stars` : 'Star on GitHub'}
      title="Star on GitHub"
    >
      <IconGithub />
      <span className="star__label">{label}</span>
      {show && (
        <span className="star__count">
          <IconStar />
          {compact(stars)}
        </span>
      )}
    </a>
  )
}

/** The Product Hunt mark: their orange circle and P. */
export function PhLogo() {
  return (
    <svg className="phb__logo" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="#ff6154" />
      <path d="M22.7 20h-5.7v-6h5.7a3 3 0 0 1 0 6Zm0-10H13v20h4v-6h5.7a7 7 0 0 0 0-14Z" fill="#fff" />
    </svg>
  )
}

const IconUpvote = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
    <path d="M12 4.5 21 17H3z" />
  </svg>
)

/**
 * Product Hunt button in the site's own style (not the stock badge image). Renders nothing until
 * PRODUCT_HUNT.slug is set, or while ?review previews it. "sm" drops the upvote chip, for the footer.
 */
export function ProductHuntBadge({ size = 'md', className = '' }: { size?: 'md' | 'sm'; className?: string }) {
  const ph = usePH()
  if (!ph.badges) return null
  return (
    <a className={`phb phb--${size} ${className}`} href={ph.url} aria-label="mcp-token-optimizer on Product Hunt">
      <PhLogo />
      <span className="phb__text">
        <small>{ph.live ? 'Live today on' : 'Featured on'}</small>
        <b>Product Hunt</b>
      </span>
      {size === 'md' && (
        <span className="phb__vote">
          <IconUpvote />
          Upvote
        </span>
      )}
    </a>
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
      <div className="foot__id">
        <span>
          © {YEAR} {AUTHOR} · mcp-token-optimizer · Apache-2.0 · runs on your machine, no telemetry
        </span>
        <ProductHuntBadge size="sm" />
      </div>
      <ul>
        <li>
          <a href={REPO}>GitHub</a>
        </li>
        <li>
          <a href={NPM_URL}>npm</a>
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
