import { useEffect, useState, type RefObject } from 'react'

export function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** True once the element has been at least `threshold` visible. Stays true. */
export function useSeen(ref: RefObject<Element | null>, threshold = 0.4): boolean {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true)
          io.disconnect()
        }
      },
      { threshold },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, seen, threshold])
  return seen
}

/** Animates a number from `from` to `to` over `ms` with an exponential ease-out. */
export function animateNumber(
  from: number,
  to: number,
  ms: number,
  onFrame: (v: number) => void,
): () => void {
  let raf = 0
  const start = performance.now()
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
    onFrame(from + (to - from) * eased)
    if (t < 1) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}
