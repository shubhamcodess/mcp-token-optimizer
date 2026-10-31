export const Mark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect width="24" height="24" rx="6" fill="var(--text)" />
    <path d="M6 8.5h12M6 12h8M6 15.5h10" stroke="var(--bg)" stroke-width="1.8" stroke-linecap="round" />
    <path d="M4.5 12.2h15" stroke="var(--cut)" stroke-width="1.6" stroke-linecap="round" />
  </svg>
)
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round' as const, 'stroke-linejoin': 'round' as const, 'aria-hidden': true }
export const Sun = () => (
  <svg {...base}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></svg>
)
export const Moon = () => (
  <svg {...base}><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" /></svg>
)
