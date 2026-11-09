// Launch review switch. Open the site with ?review to get a small panel that previews the Product
// Hunt states and the star counts before they are real. Visitors without ?review never see it,
// and nothing here changes the shipped defaults in data.ts.
import { useSyncExternalStore } from 'react'
import { PH_URL, PRODUCT_HUNT, STAR_MIN } from './data'

export type PhState = 'off' | 'badges' | 'live'
interface Review {
  ph: PhState
  stars: boolean
}

const KEY = 'mto-review'
const DEFAULT: Review = { ph: 'off', stars: false }
export const REVIEW_ON = typeof location !== 'undefined' && new URLSearchParams(location.search).has('review')

let state: Review = DEFAULT
if (REVIEW_ON) {
  try {
    state = { ...DEFAULT, ...(JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Partial<Review>) }
  } catch {
    /* storage unavailable: start from the defaults */
  }
}
const listeners = new Set<() => void>()

export function setReview(next: Partial<Review>) {
  state = { ...state, ...next }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

export function useReview(): Review {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
    () => DEFAULT,
  )
}

/** Product Hunt as the page should show it: the real config, or the review override. */
export function usePH() {
  const r = useReview()
  const real = Boolean(PH_URL)
  const previewing = REVIEW_ON && r.ph !== 'off'
  return {
    badges: real || previewing,
    live: (PRODUCT_HUNT.live && real) || (previewing && r.ph === 'live'),
    url: PH_URL || 'https://www.producthunt.com/',
  }
}

/** Whether star counts should show: the real threshold, or forced on while reviewing. */
export function useShowStars(stars: number | null): stars is number {
  const r = useReview()
  return stars !== null && (stars >= STAR_MIN || (REVIEW_ON && r.stars))
}
