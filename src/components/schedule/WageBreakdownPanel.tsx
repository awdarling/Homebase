'use client'

import { useMemo, useState } from 'react'
import { useWageBreakdown } from '@/lib/hooks/useWageBreakdown'
import type { ScheduleAssignment, WageRow } from '@/lib/types'

const COLS = '1.6fr 2.2fr 0.7fr 1fr 1fr'

function formatCurrency(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatHours(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function abbrevDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' })
}

function abbrevShifts(shifts: WageRow['shifts']): string {
  if (shifts.length === 0) return '—'
  return shifts.map(s => `${s.shift_name} ${abbrevDay(s.date)}`).join(', ')
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transition: 'transform 150ms',
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        flexShrink: 0,
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function RolePill({ role }: { role: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px',
      borderRadius: 'var(--radius-pill)',
      fontSize: 10,
      fontWeight: 500,
      background: 'var(--bg-surface-3)',
      color: 'var(--text-muted)',
      border: '1px solid var(--border-subtle)',
      marginLeft: 6,
    }}>
      {role}
    </span>
  )
}

function rateSourceLabel(source: WageRow['rate_source']): string | null {
  if (source === 'individual') return 'individual rate'
  if (source === 'role') return 'role rate'
  return null
}

function SkeletonTable() {
  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            height: 32,
            background: 'var(--bg-surface-2)',
            borderRadius: 4,
            opacity: 0.5,
          }}
        />
      ))}
    </div>
  )
}

interface WageBreakdownPanelProps {
  assignments: ScheduleAssignment[]
  companyId: string
  closedDates?: string[]
}

export default function WageBreakdownPanel({ assignments, companyId, closedDates }: WageBreakdownPanelProps) {
  const [open, setOpen] = useState(false)

  const closedDateSet = useMemo(() => new Set(closedDates ?? []), [closedDates])

  const effectiveAssignments = useMemo(
    () => closedDateSet.size === 0
      ? assignments
      : assignments.filter(a => !closedDateSet.has(a.date)),
    [assignments, closedDateSet],
  )

  const closedDayCount = useMemo(() => {
    if (closedDateSet.size === 0) return 0
    const assignmentDates = new Set(assignments.map(a => a.date))
    let count = 0
    closedDateSet.forEach(d => {
      if (assignmentDates.has(d)) count += 1
    })
    // Fall back to the raw closed-date count when no assignments overlap (still
    // surface the manager's closure decisions in the footer).
    return count > 0 ? count : closedDateSet.size
  }, [assignments, closedDateSet])

  const { rows, totals, loading } = useWageBreakdown({ assignments: effectiveAssignments, companyId })

  const hasUnknown = rows.some(r => r.rate_source === 'unknown')
  const employeeCount = rows.length

  const summary = effectiveAssignments.length === 0
    ? 'No assignments this week.'
    : `${employeeCount} employee${employeeCount === 1 ? '' : 's'} · ${formatHours(totals.hours)} total hours · Est. ${formatCurrency(totals.estimated_pay)} in wages${hasUnknown ? ' (partial)' : ''}`

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 4 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          padding: '12px 16px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-secondary)',
          textAlign: 'left',
        }}
      >
        <div style={{
          fontSize: 11,
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          flexShrink: 0,
        }}>
          Pay Breakdown
        </div>
        <div style={{
          flex: 1,
          fontSize: 11,
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}>
          {loading ? 'Loading wage data…' : summary}
        </div>
        <ChevronIcon open={open} />
      </button>

      {open && (
        loading ? (
          <SkeletonTable />
        ) : effectiveAssignments.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            {assignments.length === 0
              ? 'No assignments this week.'
              : 'No assignments after excluding closed days.'}
            {closedDayCount > 0 && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-disabled)' }}>
                {closedDayCount} day{closedDayCount === 1 ? '' : 's'} closed — excluded from estimates
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: '0 4px 8px' }}>
            {/* Header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: COLS,
              gap: 12,
              padding: '8px 12px',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--text-muted)',
              borderBottom: '1px solid var(--border-subtle)',
            }}>
              <div>Employee</div>
              <div>Shifts</div>
              <div style={{ textAlign: 'right' }}>Hours</div>
              <div>Rate</div>
              <div style={{ textAlign: 'right' }}>Est. Pay</div>
            </div>

            {/* Rows */}
            {rows.map((r, i) => {
              const sourceLabel = rateSourceLabel(r.rate_source)
              return (
                <div
                  key={r.employee_id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: COLS,
                    gap: 12,
                    padding: '8px 12px',
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    background: i % 2 === 0 ? 'transparent' : 'var(--bg-surface-2)',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.employee_name}
                    </span>
                    <RolePill role={r.primary_role} />
                  </div>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {abbrevShifts(r.shifts)}
                  </div>
                  <div style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {formatHours(r.total_hours)}
                  </div>
                  <div>
                    <div>{r.hourly_rate != null ? `${formatCurrency(r.hourly_rate)}/hr` : '—'}</div>
                    {sourceLabel && (
                      <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 1 }}>
                        {sourceLabel}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', fontWeight: 700, color: r.estimated_pay != null ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {r.estimated_pay != null ? formatCurrency(r.estimated_pay) : '—'}
                  </div>
                </div>
              )
            })}

            {/* Footer */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: COLS,
              gap: 12,
              padding: '10px 12px',
              fontSize: 12,
              color: 'var(--text-primary)',
              borderTop: '1px solid var(--border-default)',
              alignItems: 'center',
            }}>
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: 'var(--text-muted)',
              }}>
                TOTAL
              </div>
              <div />
              <div style={{ textAlign: 'right', fontWeight: 700 }}>{formatHours(totals.hours)}</div>
              <div />
              <div style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>
                {formatCurrency(totals.estimated_pay)}
                {hasUnknown && (
                  <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 500, color: 'var(--text-muted)' }}>
                    (partial)
                  </span>
                )}
              </div>
            </div>

            {closedDayCount > 0 && (
              <div style={{
                padding: '8px 12px',
                fontSize: 11,
                color: 'var(--text-muted)',
                fontStyle: 'italic',
              }}>
                {closedDayCount} day{closedDayCount === 1 ? '' : 's'} closed — excluded from estimates
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}
