'use client'

import type { FlaggedIssue } from '@/lib/types'

// Renders the engine's concurrent sex_coverage flags as manager "review this"
// action items. Unlike a gap (an unfilled slot), a coverage flag is a satisfied
// schedule that nonetheless leaves a window with no guard of a required sex on
// the floor — there's no single shift to "fill", so it surfaces as a review item
// (date, time window, which sex is missing, who was on duty) rather than a gap.
// Consumes the Aegis `unsatisfied_sex_coverage` FlaggedIssue variant (no
// shift_name; time window in metadata).

type CoverageFlag = Extract<FlaggedIssue, { type: 'unsatisfied_sex_coverage' }>

function formatDateLong(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function hhmm(t: string | undefined): string {
  return (t ?? '').slice(0, 5)
}

export default function CoverageFlags({ flaggedIssues }: { flaggedIssues?: FlaggedIssue[] }) {
  const coverage = (flaggedIssues ?? []).filter(
    (f): f is CoverageFlag => f.type === 'unsatisfied_sex_coverage',
  )
  if (coverage.length === 0) return null

  return (
    <div>
      <div
        className="section-label"
        style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}
      >
        Coverage to review
        <span
          style={{
            padding: '1px 7px',
            background: 'rgba(234,179,8,0.12)',
            border: '1px solid rgba(234,179,8,0.3)',
            borderRadius: 'var(--radius-pill)',
            fontSize: 11,
            fontWeight: 600,
            color: '#ca8a04',
          }}
        >
          {coverage.length}
        </span>
      </div>
      <div
        style={{
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}
      >
        {coverage.map((f, i) => {
          const w = f.metadata?.time_window
          const missing = f.metadata?.missing_sex ?? 'required'
          const onDuty = f.metadata?.on_duty ?? []
          return (
            <div
              key={i}
              style={{
                padding: '10px 16px',
                borderBottom: i < coverage.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                  No {missing} guard on duty
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {formatDateLong(f.date)} · {hhmm(w?.start)}–{hhmm(w?.end)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  On duty:{' '}
                  {onDuty.length > 0
                    ? onDuty.map(d => `${d.name} (${d.role}, ${d.sex})`).join(', ')
                    : '—'}
                </div>
              </div>
              <div
                style={{
                  padding: '2px 8px',
                  background: 'rgba(234,179,8,0.12)',
                  border: '1px solid rgba(234,179,8,0.3)',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#ca8a04',
                  flexShrink: 0,
                }}
              >
                review
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
