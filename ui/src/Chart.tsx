import { fmt, type Overview } from './api'

/** Seven days, ingress (what the tool returned) next to egress (what the agent received). */
export function Trend({ daily }: { daily: Overview['daily'] }) {
  const W = 560, H = 190, padL = 46, padB = 24, padT = 8
  const max = Math.max(1, ...daily.map((d) => d.tokensIn))
  const h = (v: number) => ((H - padB - padT) * v) / max
  const slot = (W - padL) / daily.length
  return (
    <>
      <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tokens in and out per day, last 7 days">
        {[0, 0.5, 1].map((t) => (
          <g>
            <line x1={padL} x2={W} y1={H - padB - (H - padB - padT) * t} y2={H - padB - (H - padB - padT) * t} stroke="var(--line)" />
            <text x={padL - 6} y={H - padB - (H - padB - padT) * t + 3} text-anchor="end">{fmt(Math.round(max * t))}</text>
          </g>
        ))}
        {daily.map((d, i) => {
          const x = padL + i * slot + slot * 0.18
          const w = slot * 0.3
          return (
            <g>
              <title>{`${d.day}: ${d.tokensIn.toLocaleString()} in, ${d.tokensOut.toLocaleString()} out, ${d.calls} calls`}</title>
              <rect class="in" x={x} y={H - padB - h(d.tokensIn)} width={w} height={h(d.tokensIn)} rx="2" />
              <rect class="out" x={x + w + 3} y={H - padB - h(d.tokensOut)} width={w} height={h(d.tokensOut)} rx="2" />
              <text x={x + w} y={H - 8} text-anchor="middle">{d.day.slice(5)}</text>
            </g>
          )
        })}
      </svg>
      <div class="legend">
        <span><i style="background:var(--line-2)" />ingress (tool result)</span>
        <span><i style="background:var(--cut)" />egress (sent to agent)</span>
      </div>
    </>
  )
}
