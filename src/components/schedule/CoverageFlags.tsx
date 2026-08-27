'use client'

import { useEffect, useState } from 'react'
import type { FlaggedIssue } from '@/lib/types'
import { coverageFlagKey, loadDismissedFlags, saveDismissedFlags, filterDismissed } from '@/lib/schedule/coverageFlagDismiss'
import { reviewableFlags } from '@/lib/schedule/flagDisplay'

// Renders the engine's reviewable flags as manager "review this" action items:
// sex-coverage windows, W-3's zero-shift employees ("Mia: no shifts this
// week — …", the J-1d complaint), and double-bookings. Unlike a gap (an
// unfilled slot), a flag is a satisfied schedule that still deserves a human
// look. A manager can dismiss a flag they've accepted (trash icon → confirm);
// dismissal persists per-browser and never alters the schedule data. The
// per-type wording lives in lib/schedule/flagDisplay (pure, tested).

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

  const all = reviewableFlags(flaggedIssues)
  const visible = all.filter(({ flag }) => !dismissed.has(coverageFlagKey(flag)))
  if (visible.length === 0) return null

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
        To review
        <span style={{ padding: '1px 7px', background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 'var(--radius-pill)', fontSize: 11, fontWeight: 600, color: '#ca8a04' }}>
          {visible.length}
        </span>
      </div>
      <div style={{ background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {visible.map(({ flag, display }, i) => {
          const key = coverageFlagKey(flag)
          const isConfirming = confirming === key
          const toneFg = display.tone === 'red' ? '#dc2626' : '#ca8a04'
          const toneBg = display.tone === 'red' ? 'rgba(239,68,68,0.10)' : 'rgba(234,179,8,0.12)'
          const toneBorder = display.tone === 'red' ? 'rgba(239,68,68,0.30)' : 'rgba(234,179,8,0.3)'
          return (
            <div
              key={key}
              style={{
                padding: '10px 16px',
                borderBottom: i < visible.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{display.title}</div>
                {display.lines.map((line, li) => (
                  <div key={li} style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {line}
                  </div>
                ))}
              </div>

              {isConfirming ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Delete this flag?</span>
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
                  <div style={{ padding: '2px 8px', background: toneBg, border: `1px solid ${toneBorder}`, borderRadius: 'var(--radius-pill)', fontSize: 11, fontWeight: 600, color: toneFg }}>
                    review
                  </div>
                  <button
                    onClick={() => setConfirming(key)}
                    title="Dismiss this flag"
                    aria-label="Dismiss this flag"
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
