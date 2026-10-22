import { useEffect } from 'react'
import { Footer, Nav } from './Chrome'
import { Field } from './Field'
import { Hero } from './Hero'
import { Benchmarks, Features, HowItWorks, Install, Logos, Maker, TestIt } from './Sections'

/** Adds .in to every .reveal element the first time it scrolls into view. */
export function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal')
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

export default function App() {
  useReveal()
  return (
    <>
      <Field />
      <Nav />
      <div className="frame">
        <main>
          <Hero />
          <Logos />
          <HowItWorks />
          <Features />
          <Benchmarks />
          <Install />
          <TestIt />
          <Maker />
        </main>
        <Footer />
      </div>
    </>
  )
}
