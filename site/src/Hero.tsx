import { useState, type KeyboardEvent } from 'react'
import { AgentMock } from './AgentMock'
import { CopyButton } from './Chrome'
import { INSTALL_NPM, INSTALL_ONE_LINER, LATEST_URL, REPO, VERSION } from './data'
import { IconDownload, IconGithub } from './Icons'

const TABS = ['release', 'npm'] as const
type Tab = (typeof TABS)[number]

export function Hero() {
  const [tab, setTab] = useState<Tab>('release')

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.indexOf(tab)
    let n: number
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length
    else return
    e.preventDefault()
    setTab(TABS[n])
    document.getElementById(`tab-${TABS[n]}`)?.focus()
  }

  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="hero__top">
        <div className="hero__title">
          <a className="pill" href={`${import.meta.env.BASE_URL}docs/`}>
            v{VERSION} · open source · self-hosted
            <em>Read the docs</em>
          </a>
          <h1 id="hero-title">
            Stop paying for tool&#8209;response <span className="cut">noise</span>.
          </h1>
        </div>
        <div className="hero__subwrap">
          <p className="hero__sub">
            A local proxy between your coding agent and its MCP servers. Cuts tool-response noise, keeps the
            original, and lowers your agent&rsquo;s token cost.
          </p>
        </div>

        <div className="hero__act">
          <div className="cmd">
            <div className="cmd__tabs" role="tablist" aria-label="Install method" onKeyDown={onKey}>
              {TABS.map((k) => (
                <button
                  key={k}
                  id={`tab-${k}`}
                  type="button"
                  role="tab"
                  className="cmd__tab"
                  aria-selected={tab === k}
                  aria-controls="install-panel"
                  tabIndex={tab === k ? 0 : -1}
                  onClick={() => setTab(k)}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="cmd__row" role="tabpanel" id="install-panel" aria-labelledby={`tab-${tab}`}>
              <code className="cmd__line">
                <span className="p">$ </span>
                {tab === 'release' ? INSTALL_ONE_LINER : INSTALL_NPM}
              </code>
              {tab === 'release' ? (
                <CopyButton text={INSTALL_ONE_LINER} />
              ) : (
                <span className="cmd__soon">coming in v3</span>
              )}
            </div>
          </div>
          <div className="hero__btns">
            <a className="btn btn--solid" href={LATEST_URL}>
              <IconDownload />
              Download latest
            </a>
            <a className="btn btn--line" href={REPO}>
              <IconGithub />
              View on GitHub
            </a>
          </div>
        </div>
      </div>

      <div className="hero__stage">
        <AgentMock />
      </div>
    </section>
  )
}
