'use client'

import { useEffect, useState } from 'react'
import type { FlaggedIssue } from '@/lib/types'
import { coverageFlagKey, loadDismissedFlags, saveDismissedFlags, filterDismissed } from '@/lib/schedule/coverageFlagDismiss'

// Renders the engine's concurrent sex_coverage flags as manager "review this"
// action items. Unlike a gap (an unfilled slot), a coverage flag is a satisfied
// schedule that nonetheless leaves a window with no guard of a required sex on
// the floor. A manager can dismiss a flag they've accepted (trash icon →
// confirm); dismissal persists per-browser and never alters the schedule data.

type CoverageFlag = Extract<FlaggedIssue, { type: 'unsatisfied_sex_coverage' }>

function formatDateLong(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function hhmm(t: string | undefined): string {
  return (t ?? '').slice(0, 5)
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

export default function CoverageFlags({ flaggedIssues, scheduleId }: { flaggedIssues?: FlaggedIssue[]; scheduleId?: string }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState<string | null>(null)

  useEffect(() => {
    if (scheduleId) setDismissed(loadDismissedFlags(scheduleId))
  }, [scheduleId])

  const allCoverage = (flaggedIssues ?? []).filter(
    (f): f is CoverageFlag => f.type === 'unsatisfied_sex_coverage',
  )
  const coverage = filterDismissed(allCoverage, dismissed)
  if (coverage.length === 0) return null

  function dismiss(key: string) {
    const next = new Set(dismissed)
    next.add(key)
    setDismissed(next)
    if (scheduleId) saveDismissedFlags(scheduleId, next)
    setConfirming(null)
  }

  return (
    <div>
      <div className="section-label" style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        Coverage to review
        <span style={{ padding: '1px 7px', background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 'var(--radius-pill)', fontSize: 11, fontWeight: 600, color: '#ca8a04' }}>
          {coverage.length}
        </span>
      </div>
      <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {coverage.map((f, i) => {
          const w = f.metadata?.time_window
          const missing = f.metadata?.missing_sex ?? 'required'
          const onDuty = f.metadata?.on_duty ?? []
          const key = coverageFlagKey(f)
          const isConfirming = confirming === key
          return (
            <div
              key={key}
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
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>No {missing} guard on duty</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {formatDateLong(f.date)} · {hhmm(w?.start)}–{hhmm(w?.end)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  On duty: {onDuty.length > 0 ? onDuty.map(d => `${d.name} (${d.role}, ${d.sex})`).join(', ') : '—'}
                </div>
              </div>

              {isConfirming ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Delete this coverage flag?</span>
                  <button
                    onClick={() => dismiss(key)}
                    style={{ padding: '2px 10px', fontSize: 11, fontWeight: 600, color: '#fff', background: '#dc2626', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    style={{ padding: '2px 10px', fontSize: 11, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <div style={{ padding: '2px 8px', background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 'var(--radius-pill)', fontSize: 11, fontWeight: 600, color: '#ca8a04' }}>
                    review
                  </div>
                  <button
                    onClick={() => setConfirming(key)}
                    title="Dismiss this coverage flag"
                    aria-label="Dismiss this coverage flag"
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      padding: 4, background: 'transparent', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', opacity: 0.4, transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4' }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
