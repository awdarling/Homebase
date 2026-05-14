'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompany } from '@/lib/hooks/useCompany'
import { useScheduleTemplate } from '@/lib/hooks/useScheduleTemplate'
import ScheduleRenderer from '@/components/schedule/ScheduleRenderer'
import ScheduleStats from '@/components/schedule/ScheduleStats'
import GapResolverPanel from '@/components/schedule/GapResolverPanel'
import TemplateEditorPanel from '@/components/schedule/TemplateEditorPanel'
import ScheduleReviewPanel, { type ScheduleChange } from '@/components/schedule/ScheduleReviewPanel'
import AddShiftPanel from '@/components/schedule/AddShiftPanel'
import type { Schedule, ScheduleAssignment, ScheduleGap, ScheduleTemplate } from '@/lib/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateLong(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function isoToday(): string {
  return new Date().toLocaleDateString('en-CA')
}

function classifySchedule(s: Schedule): 'current' | 'upcoming' | 'past' {
  const today = isoToday()
  if (s.week_start <= today && s.week_end >= today) return 'current'
  if (s.week_start > today) return 'upcoming'
  return 'past'
}

function scheduleMatchesSearch(s: Schedule, query: string): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase()
  const label = `${formatDateLong(s.week_start)} ${formatDateLong(s.week_end)}`.toLowerCase()
  return label.includes(q)
}

function computeChanges(snapshot: ScheduleAssignment[], pending: ScheduleAssignment[]): ScheduleChange[] {
  const key = (a: ScheduleAssignment) => `${a.employee_id}|${a.shift_name}|${a.date}`

  const snapMap = new Map<string, ScheduleAssignment>()
  for (const s of snapshot) snapMap.set(key(s), s)
  const pendMap = new Map<string, ScheduleAssignment>()
  for (const p of pending) pendMap.set(key(p), p)

  const removed: ScheduleAssignment[] = []
  snapMap.forEach((s, k) => { if (!pendMap.has(k)) removed.push(s) })

  const added: ScheduleAssignment[] = []
  pendMap.forEach((p, k) => { if (!snapMap.has(k)) added.push(p) })

  // Match removed → added by employee_id (greedy) to detect moves
  const moves: Array<{ from: ScheduleAssignment; to: ScheduleAssignment }> = []
  for (let i = removed.length - 1; i >= 0; i--) {
    const r = removed[i]
    const aIdx = added.findIndex(a => a.employee_id === r.employee_id)
    if (aIdx >= 0) {
      moves.push({ from: r, to: added[aIdx] })
      added.splice(aIdx, 1)
      removed.splice(i, 1)
    }
  }

  const changes: ScheduleChange[] = []
  for (const m of moves) {
    changes.push({
      kind: 'moved',
      employee_id: m.from.employee_id,
      employee_name: m.from.employee_name,
      from: { shift_name: m.from.shift_name, date: m.from.date, role: m.from.role },
      to:   { shift_name: m.to.shift_name,   date: m.to.date,   role: m.to.role   },
    })
  }
  for (const a of added) {
    changes.push({
      kind: 'added',
      employee_id: a.employee_id,
      employee_name: a.employee_name,
      to: { shift_name: a.shift_name, date: a.date, role: a.role },
    })
  }
  for (const r of removed) {
    changes.push({
      kind: 'removed',
      employee_id: r.employee_id,
      employee_name: r.employee_name,
      from: { shift_name: r.shift_name, date: r.date, role: r.role },
    })
  }
  return changes
}

// ── ScaledContainer ───────────────────────────────────────────────────────────

function ScaledContainer({ children, scale = 0.7 }: { children: React.ReactNode; scale?: number }) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    if (innerRef.current) {
      const h = Math.round(innerRef.current.scrollHeight * scale)
      setContainerHeight(h)
    }
  })

  return (
    <div style={{ height: containerHeight ?? 'auto', overflow: 'hidden' }}>
      <div
        ref={innerRef}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width: `${(100 / scale).toFixed(2)}%`,
        }}
      >
        {children}
      </div>
    </div>
  )
}

// ── ContributorList ───────────────────────────────────────────────────────────

function ContributorList({
  title,
  rows,
  color,
}: {
  title: string
  rows: { employee_id: string; name: string; hours: number }[]
  color: string
}) {
  return (
    <div>
      <div className="section-label" style={{ margin: '0 0 8px' }}>{title}</div>
      <div style={{
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {rows.map((c, i) => (
          <div key={c.employee_id} style={{
            padding: '10px 16px',
            borderBottom: i < rows.length - 1 ? '1px solid var(--border-subtle)' : 'none',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{c.name}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color, fontFamily: 'var(--font-display)' }}>
              {c.hours}h
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── HistoryReportDetail ───────────────────────────────────────────────────────

function HistoryReportDetail({ schedule }: { schedule: Schedule }) {
  const report = schedule.staffing_report
  const gaps = schedule.data?.gaps ?? []

  if (!report && gaps.length === 0) {
    return (
      <div style={{ padding: '16px 0', fontSize: 12, color: 'var(--text-muted)' }}>
        No staffing report attached to this schedule.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 24 }}>

      {/* Summary stats */}
      {report && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            {
              label: 'Coverage',
              value: `${report.coverage_rate}%`,
              color: report.coverage_rate >= 90 ? '#16a34a' : report.coverage_rate >= 75 ? '#ca8a04' : '#ef4444',
            },
            {
              label: 'Gaps',
              value: String(gaps.length),
              color: gaps.length > 0 ? '#ef4444' : '#16a34a',
            },
            {
              label: 'Est. Wages',
              value: `$${report.estimated_wages.total_estimated.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
              color: 'var(--text-primary)',
            },
          ].map(stat => (
            <div key={stat.label} style={{
              padding: '10px 16px',
              background: 'var(--bg-surface-2)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
            }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3, lineHeight: 1 }}>
                {stat.label}
              </div>
              <div style={{ fontSize: 18, fontFamily: 'var(--font-display)', fontWeight: 800, color: stat.color, lineHeight: 1 }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Gaps list */}
      {gaps.length > 0 && (
        <div>
          <div className="section-label" style={{ margin: '0 0 8px' }}>Gaps</div>
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}>
            {gaps.map((g, i) => (
              <div key={i} style={{
                padding: '10px 16px',
                borderBottom: i < gaps.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                flexWrap: 'wrap',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {g.shift_name} — {g.role}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {formatDateLong(g.date)} · {g.filled_count}/{g.required_count} filled
                  </div>
                  {g.reason && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>
                      {g.reason}
                    </div>
                  )}
                </div>
                <div style={{
                  padding: '2px 8px',
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#ef4444',
                  flexShrink: 0,
                }}>
                  {g.required_count - g.filled_count} unfilled
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top + Bottom contributors */}
      {report && (report.top_contributors.length > 0 || (report.bottom_contributors?.length ?? 0) > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {report.top_contributors.length > 0 && (
            <ContributorList
              title="Top Contributors"
              rows={report.top_contributors.slice(0, 3)}
              color="var(--accent)"
            />
          )}
          {report.bottom_contributors && report.bottom_contributors.length > 0 && (
            <ContributorList
              title="Bottom Contributors"
              rows={report.bottom_contributors.slice(0, 3)}
              color="#f97316"
            />
          )}
        </div>
      )}

      {/* Wages by employee */}
      {report && report.estimated_wages.by_employee.length > 0 && (
        <div>
          <div className="section-label" style={{ margin: '0 0 8px' }}>Estimated Wages</div>
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 56px 80px 100px',
              padding: '8px 16px',
              borderBottom: '1px solid var(--border-default)',
            }}>
              {['Employee', 'Hours', 'Rate', 'Est. Pay'].map(h => (
                <div key={h} style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {h}
                </div>
              ))}
            </div>
            {report.estimated_wages.by_employee.map((e, i) => (
              <div key={e.employee_id} style={{
                display: 'grid',
                gridTemplateColumns: '1fr 56px 80px 100px',
                padding: '10px 16px',
                borderBottom: i < report.estimated_wages.by_employee.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{e.employee_name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{e.hours}h</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>${e.hourly_rate.toFixed(2)}/hr</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                  ${e.estimated_pay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            ))}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 56px 80px 100px',
              padding: '10px 16px',
              borderTop: '1px solid var(--border-default)',
              background: 'var(--bg-surface-2)',
            }}>
              <span style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-primary)',
                gridColumn: '1 / 4',
              }}>
                Total
              </span>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                ${report.estimated_wages.total_estimated.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ── HistoryCard ───────────────────────────────────────────────────────────────

function HistoryCard({
  schedule,
  template,
  expanded,
  onToggle,
}: {
  schedule: Schedule
  template: ScheduleTemplate
  expanded: boolean
  onToggle: () => void
}) {
  const weekLabel = `${formatDateLong(schedule.week_start)} – ${formatDateLong(schedule.week_end)}`

  const statusBadge =
    schedule.status === 'approved'
      ? { cls: 'badge badge-ready', label: 'Approved' }
      : schedule.status === 'published'
        ? { cls: 'badge badge-ready', label: 'Published' }
        : { cls: 'badge badge-review', label: 'Draft' }

  return (
    <div style={{
      background: 'var(--bg-surface-1)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      {/* Card header */}
      <div style={{
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
              {weekLabel}
            </span>
            <span className={statusBadge.cls}>{statusBadge.label}</span>
          </div>
          <ScheduleStats schedule={schedule} compact />
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={onToggle}
          style={{ flexShrink: 0 }}
        >
          {expanded ? 'Collapse' : 'View'}
        </button>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div style={{
          borderTop: '1px solid var(--border-subtle)',
          padding: '20px',
        }}>
          <ScaledContainer scale={0.7}>
            <ScheduleRenderer schedule={schedule} template={template} mode="view" />
          </ScaledContainer>
          <HistoryReportDetail schedule={schedule} />
        </div>
      )}
    </div>
  )
}

// ── CurrentScheduleGaps ───────────────────────────────────────────────────────

function CurrentScheduleGaps({
  gaps,
  onResolve,
}: {
  gaps: ScheduleGap[]
  onResolve: (gap: ScheduleGap) => void
}) {
  const openGaps = gaps.filter(g => g.required_count > g.filled_count)
  if (openGaps.length === 0) return null

  return (
    <div style={{
      background: 'var(--bg-surface-1)',
      border: '1px solid rgba(239,68,68,0.25)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(239,68,68,0.04)',
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: '#ef4444',
        }}>
          Open Gaps
        </div>
        <div style={{
          padding: '1px 7px',
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 'var(--radius-pill)',
          fontSize: 11,
          fontWeight: 700,
          color: '#ef4444',
        }}>
          {openGaps.length}
        </div>
      </div>
      {openGaps.map((g, i) => (
        <div key={`${g.shift_name}-${g.role}-${g.date}`} style={{
          padding: '10px 16px',
          borderBottom: i < openGaps.length - 1 ? '1px solid var(--border-subtle)' : 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
              {g.shift_name} — {g.role}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {formatDateLong(g.date)} · {g.filled_count}/{g.required_count} filled
              {g.reason ? ` · ${g.reason}` : ''}
            </div>
          </div>
          <div style={{
            padding: '2px 8px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: 'var(--radius-pill)',
            fontSize: 11,
            fontWeight: 600,
            color: '#ef4444',
            flexShrink: 0,
          }}>
            {g.required_count - g.filled_count} unfilled
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onResolve(g)}
            style={{ flexShrink: 0 }}
          >
            Resolve
          </button>
        </div>
      ))}
    </div>
  )
}

// ── UpcomingCard ──────────────────────────────────────────────────────────────

function ClockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

interface UpcomingCardProps {
  schedule: Schedule
  template: ScheduleTemplate
  expanded: boolean
  onToggle: () => void
  isEditing: boolean
  removeMode: boolean
  pendingAssignments: ScheduleAssignment[]
  changesCount: number
  canStartEdit: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onAddShift: () => void
  onToggleRemove: () => void
  onReview: () => void
  onAssignmentChange: (next: ScheduleAssignment[]) => void
  onResolveGap: (gap: ScheduleGap) => void
}

function UpcomingCard({
  schedule,
  template,
  expanded,
  onToggle,
  isEditing,
  removeMode,
  pendingAssignments,
  changesCount,
  canStartEdit,
  onStartEdit,
  onCancelEdit,
  onAddShift,
  onToggleRemove,
  onReview,
  onAssignmentChange,
  onResolveGap,
}: UpcomingCardProps) {
  const weekLabel = `${formatDateLong(schedule.week_start)} – ${formatDateLong(schedule.week_end)}`

  const statusBadge =
    schedule.status === 'approved'
      ? { cls: 'badge badge-ready', label: 'Approved' }
      : schedule.status === 'published'
        ? { cls: 'badge badge-ready', label: 'Published' }
        : { cls: 'badge badge-review', label: 'Draft' }

  const gaps = schedule.data?.gaps ?? []

  return (
    <div style={{
      background: 'var(--bg-surface-1)',
      border: '1px solid var(--border-default)',
      borderLeft: '3px solid var(--accent-border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      opacity: isEditing ? 1 : 0.95,
    }}>
      {/* Card header */}
      <div style={{
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--accent)',
              fontSize: 13,
              fontWeight: 600,
            }}>
              <ClockIcon />
              {weekLabel}
            </span>
            <span className={statusBadge.cls}>{statusBadge.label}</span>
          </div>
          <ScheduleStats schedule={schedule} compact />
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={onToggle}
          style={{ flexShrink: 0 }}
        >
          {expanded ? 'Collapse' : 'Preview & Edit'}
        </button>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div style={{
          borderTop: '1px solid var(--border-subtle)',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}>
          {/* Edit controls */}
          <div style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
          }}>
            {!isEditing ? (
              <button
                className="btn btn-primary btn-sm"
                onClick={onStartEdit}
                disabled={!canStartEdit}
                title={canStartEdit ? undefined : 'Finish editing the other schedule first'}
              >
                Edit Schedule
              </button>
            ) : (
              <>
                <button className="btn btn-secondary btn-sm" onClick={onAddShift}>
                  + Add Shift
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={onToggleRemove}
                  style={removeMode ? {
                    background: 'rgba(239,68,68,0.1)',
                    borderColor: 'rgba(239,68,68,0.3)',
                    color: '#ef4444',
                  } : undefined}
                >
                  {removeMode ? 'Done Removing' : 'Remove'}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={onCancelEdit}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={changesCount === 0}
                  onClick={onReview}
                >
                  Review Changes ({changesCount})
                </button>
              </>
            )}
          </div>

          {/* Open gaps */}
          {!isEditing && (
            <CurrentScheduleGaps gaps={gaps} onResolve={onResolveGap} />
          )}

          {/* Renderer */}
          <ScheduleRenderer
            schedule={schedule}
            template={template}
            mode={isEditing ? 'edit' : 'view'}
            removeMode={isEditing ? removeMode : undefined}
            pendingAssignments={isEditing ? pendingAssignments : undefined}
            onAssignmentChange={isEditing ? onAssignmentChange : undefined}
          />
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const { company } = useCompany()
  const companyId = company?.id ?? ''
  const { template, saveTemplate } = useScheduleTemplate()

  const [allSchedules, setAllSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)

  // Edit state — at most one schedule at a time, across all sections.
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null)
  const [editSnapshot, setEditSnapshot] = useState<ScheduleAssignment[]>([])
  const [pendingAssignments, setPendingAssignments] = useState<ScheduleAssignment[]>([])
  const [removeMode, setRemoveMode] = useState(false)

  // Expansion state
  const [expandedUpcomingId, setExpandedUpcomingId] = useState<string | null>(null)
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Modals / panels
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false)
  const [addShiftOpen, setAddShiftOpen] = useState(false)
  const [editTemplateMode, setEditTemplateMode] = useState(false)
  const [resolveTarget, setResolveTarget] = useState<{ gap: ScheduleGap; scheduleId: string } | null>(null)

  const supabase = createClient()

  useEffect(() => {
    if (!companyId) return
    fetchSchedules()
  }, [companyId])

  async function fetchSchedules() {
    setLoading(true)
    const { data } = await supabase
      .from('schedules')
      .select('*')
      .eq('company_id', companyId)
      .order('week_start', { ascending: false })
      .limit(40)
    setAllSchedules((data as Schedule[]) ?? [])
    setLoading(false)
  }

  // ── Categorize schedules ────────────────────────────────────────────────
  const currentSchedule = allSchedules
    .filter(s => classifySchedule(s) === 'current')
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0] ?? null
  const upcomingSchedules = allSchedules
    .filter(s => classifySchedule(s) === 'upcoming')
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
  const historySchedules = allSchedules
    .filter(s => classifySchedule(s) === 'past')
    .sort((a, b) => b.week_start.localeCompare(a.week_start))
  const filteredHistory = historySchedules.filter(s => scheduleMatchesSearch(s, search))

  // ── Derived edit state ──────────────────────────────────────────────────
  const editMode = editingScheduleId !== null
  const editingSchedule = editingScheduleId
    ? allSchedules.find(s => s.id === editingScheduleId) ?? null
    : null
  const isEditingCurrent = !!currentSchedule && editingScheduleId === currentSchedule.id
  const changes = editMode ? computeChanges(editSnapshot, pendingAssignments) : []
  const changesCount = changes.length

  const resolvingSchedule = resolveTarget
    ? allSchedules.find(s => s.id === resolveTarget.scheduleId) ?? null
    : null

  function enterEditMode(schedule: Schedule) {
    const assignments = schedule.data?.assignments ?? []
    setEditSnapshot([...assignments])
    setPendingAssignments([...assignments])
    setRemoveMode(false)
    setEditingScheduleId(schedule.id)
  }

  function cancelEditMode() {
    setEditSnapshot([])
    setPendingAssignments([])
    setRemoveMode(false)
    setAddShiftOpen(false)
    setReviewPanelOpen(false)
    setEditingScheduleId(null)
  }

  function handleGapResolved(updatedSchedule: Schedule) {
    setAllSchedules(prev => prev.map(s => s.id === updatedSchedule.id ? updatedSchedule : s))
    setResolveTarget(null)
  }

  function handleScheduleSaved(updatedSchedule: Schedule) {
    setAllSchedules(prev => prev.map(s => s.id === updatedSchedule.id ? updatedSchedule : s))
    setReviewPanelOpen(false)
    cancelEditMode()
  }

  function handleAddPending(newAssignment: ScheduleAssignment) {
    setPendingAssignments(prev => [...prev, newAssignment])
  }

  function toggleUpcomingExpanded(id: string) {
    if (expandedUpcomingId === id) {
      if (editingScheduleId === id) cancelEditMode()
      setExpandedUpcomingId(null)
    } else {
      setExpandedUpcomingId(id)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading schedules...
      </div>
    )
  }

  const currentGaps = currentSchedule?.data?.gaps ?? []
  const canStartNewEdit = editingScheduleId === null

  return (
    <div className="page-content">

      {/* ══ SECTION 1: THIS WEEK ════════════════════════════════════════════ */}
      <div>

        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}>
          <div>
            <div className="page-title">Schedule</div>
            <div className="page-subtitle">
              {currentSchedule
                ? `${formatDateLong(currentSchedule.week_start)} – ${formatDateLong(currentSchedule.week_end)}`
                : 'Weekly schedules built by Aegis'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
            {!isEditingCurrent ? (
              <>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setEditTemplateMode(true)}
                >
                  Edit Template
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!currentSchedule || !canStartNewEdit}
                  onClick={() => currentSchedule && enterEditMode(currentSchedule)}
                  title={canStartNewEdit ? undefined : 'Finish editing the other schedule first'}
                >
                  Edit Schedule
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setAddShiftOpen(true)}
                >
                  + Add Shift
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setRemoveMode(v => !v)}
                  style={removeMode ? {
                    background: 'rgba(239,68,68,0.1)',
                    borderColor: 'rgba(239,68,68,0.3)',
                    color: '#ef4444',
                  } : undefined}
                >
                  {removeMode ? 'Done Removing' : 'Remove'}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={cancelEditMode}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={changesCount === 0}
                  onClick={() => setReviewPanelOpen(true)}
                >
                  Review Changes ({changesCount})
                </button>
              </>
            )}
          </div>
        </div>

        {/* Body */}
        {!currentSchedule ? (
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
          }}>
            <div className="empty-state">
              <div className="empty-state-title">No schedule for this week yet</div>
              <div className="empty-state-desc">
                Ask Aegis to build one.
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ScheduleStats schedule={currentSchedule} />

            {/* Open gaps with Resolve buttons */}
            {!isEditingCurrent && (
              <CurrentScheduleGaps
                gaps={currentGaps}
                onResolve={gap => setResolveTarget({ gap, scheduleId: currentSchedule.id })}
              />
            )}

            {template && (
              <ScheduleRenderer
                schedule={currentSchedule}
                template={template}
                mode={isEditingCurrent ? 'edit' : 'view'}
                removeMode={isEditingCurrent ? removeMode : undefined}
                pendingAssignments={isEditingCurrent ? pendingAssignments : undefined}
                onAssignmentChange={isEditingCurrent ? setPendingAssignments : undefined}
              />
            )}
          </div>
        )}
      </div>

      {/* ══ SECTION 2: UPCOMING SCHEDULES ═══════════════════════════════════ */}
      {/* ── UPCOMING SCHEDULES — DO NOT REMOVE ───────────────────────────── */}
      {/* This section ALWAYS renders, regardless of whether upcoming schedules exist. */}
      <div style={{ marginTop: 48 }}>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div style={{ height: 1, background: 'var(--border-subtle)', flex: 1 }} />
          <div style={{
            fontSize: 11,
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            flexShrink: 0,
          }}>
            Upcoming Schedules
          </div>
          <div style={{ height: 1, background: 'var(--border-subtle)', flex: 1 }} />
        </div>

        {upcomingSchedules.length === 0 ? (
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
          }}>
            <div className="empty-state">
              <div className="empty-state-title">No upcoming schedules</div>
              <div className="empty-state-desc">
                Ask Aegis to build next week&rsquo;s schedule.
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {upcomingSchedules.map(s => template && (
              <UpcomingCard
                key={s.id}
                schedule={s}
                template={template}
                expanded={expandedUpcomingId === s.id}
                onToggle={() => toggleUpcomingExpanded(s.id)}
                isEditing={editingScheduleId === s.id}
                removeMode={removeMode}
                pendingAssignments={pendingAssignments}
                changesCount={editingScheduleId === s.id ? changesCount : 0}
                canStartEdit={canStartNewEdit}
                onStartEdit={() => enterEditMode(s)}
                onCancelEdit={cancelEditMode}
                onAddShift={() => setAddShiftOpen(true)}
                onToggleRemove={() => setRemoveMode(v => !v)}
                onReview={() => setReviewPanelOpen(true)}
                onAssignmentChange={setPendingAssignments}
                onResolveGap={gap => setResolveTarget({ gap, scheduleId: s.id })}
              />
            ))}
          </div>
        )}
      </div>

      {/* ══ SECTION 3: PAST SCHEDULES ═══════════════════════════════════════ */}
      {/* ── PAST SCHEDULES — DO NOT REMOVE ───────────────────────────────── */}
      {/* This section ALWAYS renders, regardless of whether past schedules exist. */}
      <div style={{ marginTop: 48 }}>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div style={{ height: 1, background: 'var(--border-subtle)', flex: 1 }} />
          <div style={{
            fontSize: 11,
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            flexShrink: 0,
          }}>
            Past Schedules
          </div>
          <div style={{ height: 1, background: 'var(--border-subtle)', flex: 1 }} />
        </div>

        {/* Search */}
        <div style={{ marginBottom: 16 }}>
          <input
            className="form-input"
            style={{ maxWidth: 320 }}
            placeholder="Search by week or date..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* List */}
        {historySchedules.length === 0 ? (
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
          }}>
            <div className="empty-state">
              <div className="empty-state-title">No past schedules yet</div>
              <div className="empty-state-desc">
                Past schedules will appear here after Aegis builds and publishes them each week.
              </div>
            </div>
          </div>
        ) : filteredHistory.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center' }}>
            No past schedules match your search.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filteredHistory.map(s => template && (
              <HistoryCard
                key={s.id}
                schedule={s}
                template={template}
                expanded={expandedHistoryId === s.id}
                onToggle={() => setExpandedHistoryId(expandedHistoryId === s.id ? null : s.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ══ Soteria Review Panel ═════════════════════════════════════════════ */}
      {reviewPanelOpen && editingSchedule && (
        <ScheduleReviewPanel
          schedule={editingSchedule}
          companyId={companyId}
          changes={changes}
          originalAssignments={editSnapshot}
          pendingAssignments={pendingAssignments}
          onClose={() => setReviewPanelOpen(false)}
          onSaved={handleScheduleSaved}
        />
      )}

      {/* ══ Add Shift Panel ══════════════════════════════════════════════════ */}
      {addShiftOpen && editingSchedule && template && (
        <AddShiftPanel
          companyId={companyId}
          weekStart={editingSchedule.week_start}
          weekEnd={editingSchedule.week_end}
          template={template}
          onClose={() => setAddShiftOpen(false)}
          onAdd={handleAddPending}
        />
      )}

      {/* ══ Gap Resolver Panel ═══════════════════════════════════════════════ */}
      {resolveTarget && resolvingSchedule && (
        <GapResolverPanel
          gap={resolveTarget.gap}
          schedule={resolvingSchedule}
          companyId={companyId}
          onClose={() => setResolveTarget(null)}
          onResolved={handleGapResolved}
        />
      )}

      {/* ══ Template Editor ══════════════════════════════════════════════════ */}
      {editTemplateMode && template && (
        <TemplateEditorPanel
          template={template}
          currentSchedule={currentSchedule}
          saveTemplate={saveTemplate}
          onClose={() => setEditTemplateMode(false)}
        />
      )}

    </div>
  )
}
