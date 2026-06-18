// Shared veteran badge — the single source of truth for the "VET" marker so it
// looks identical everywhere it appears (schedule grid, employees/data tab, and
// anywhere added later). Brand orange (accent) pill. See DEV_ROADMAP item 15
// (consistent assets) — do not re-create a local copy of this badge.
export function VetBadge() {
  return (
    <span
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 6px',
        borderRadius: 'var(--radius-pill)',
        background: 'var(--accent-dim)',
        border: '1px solid var(--accent-border)',
        color: 'var(--accent)',
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: '0.06em',
        lineHeight: 1.3,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      VET
    </span>
  )
}
