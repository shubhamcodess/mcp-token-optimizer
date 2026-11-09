import { STAR_MIN } from './data'
import { REVIEW_ON, setReview, useReview, type PhState } from './review'

/** Floating panel for ?review: flips the Product Hunt state and star counts. */
export function ReviewPanel() {
  const r = useReview()
  if (!REVIEW_ON) return null
  const opts: [PhState, string][] = [
    ['off', 'Off'],
    ['badges', 'Badges'],
    ['live', 'Launch day'],
  ]
  return (
    <aside className="review" aria-label="Launch review">
      <p className="review__title">Launch review</p>
      <div className="review__row">
        <span>Product Hunt</span>
        <div className="review__seg" role="radiogroup" aria-label="Product Hunt state">
          {opts.map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={r.ph === v} onClick={() => setReview({ ph: v })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="review__row">
        <span>Star counts (below {STAR_MIN})</span>
        <input type="checkbox" checked={r.stars} onChange={(e) => setReview({ stars: e.target.checked })} />
      </label>
      <p className="review__note">Preview only. Visible with ?review in the URL.</p>
    </aside>
  )
}
