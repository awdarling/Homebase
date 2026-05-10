'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompany } from '@/lib/hooks/useCompany'
import { useScheduleTemplate } from '@/lib/hooks/useScheduleTemplate'
import ScheduleRenderer from '@/components/schedule/ScheduleRenderer'
import ScheduleStats from '@/components/schedule/ScheduleStats'
import GapResolverPanel from '@/components/schedule/GapResolverPanel'
import TemplateEditorPanel from '@/components/schedule/TemplateEditorPanel'
import type { Schedule, ScheduleAssignment, ScheduleGap, ScheduleTemplate } from '@/lib/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateLong(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA')
}

function isCurrentWeek(s: Schedule): boolean {
  const today = todayISO()
  return today >= s.week_start && today <= s.week_end
}

function scheduleMatchesSearch(s: Schedule, query: string): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase()
  const label = `${formatDateLong(s.week_start)} ${formatDateLong(s.week_end)}`.toLowerCase()
  return label.includes(q)
}

function computeChangeCount(live: ScheduleAssignment[], snapshot: ScheduleAssignment[]): number {
  if (live.length !== snapshot.length) return Math.abs(live.length - snapshot.length)
  let changes = 0
  for (const a of live) {
    const found = snapshot.some(
      s => s.employee_id === a.employee_id && s.date === a.date && s.shift_name === a.shift_name
    )
    if (!found) changes++
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

// ── ReviewModal ───────────────────────────────────────────────────────────────

function ReviewModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          padding: '32px',
          maxWidth: 440,
          width: '100%',
        }}
      >
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16,
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: 12,
        }}>
          Review Changes
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 24 }}>
          Review is coming in the next update. Changes have been tracked and will be validated by Soteria.
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={onClose}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          Got it
        </button>
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const { company } = useCompany()
  const companyId = company?.id ?? ''
  const { template, saveTemplate } = useScheduleTemplate()

  const [allSchedules, setAllSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)

  // Edit mode
  const [editMode, setEditMode] = useState(false)
  const [snapshotAssignments, setSnapshotAssignments] = useState<ScheduleAssignment[]>([])
  const [liveAssignments, setLiveAssignments] = useState<ScheduleAssignment[]>([])

  // History
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Modals / panels
  const [reviewModalOpen, setReviewModalOpen] = useState(false)
  const [editTemplateMode, setEditTemplateMode] = useState(false)
  const [resolveGap, setResolveGap] = useState<ScheduleGap | null>(null)

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
      .limit(20)
    setAllSchedules((data as Schedule[]) ?? [])
    setLoading(false)
  }

  // Derive current week schedule
  const currentSchedule = allSchedules
    .filter(s => isCurrentWeek(s))
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0] ?? null

  const historySchedules = allSchedules.filter(s => !isCurrentWeek(s))
  const filteredHistory = historySchedules.filter(s => scheduleMatchesSearch(s, search))

  const changeCount = computeChangeCount(liveAssignments, snapshotAssignments)

  function enterEditMode() {
    const assignments = currentSchedule?.data?.assignments ?? []
    setSnapshotAssignments([...assignments])
    setLiveAssignments([...assignments])
    setEditMode(true)
  }

  function cancelEditMode() {
    setSnapshotAssignments([])
    setLiveAssignments([])
    setEditMode(false)
  }

  function handleGapResolved(updatedSchedule: Schedule) {
    setAllSchedules(prev => prev.map(s => s.id === updatedSchedule.id ? updatedSchedule : s))
    setResolveGap(null)
  }

  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading schedules...
      </div>
    )
  }

  const currentGaps = currentSchedule?.data?.gaps ?? []

  return (
    <div className="page-content">

      {/* ══ Active Schedule ══════════════════════════════════════════════════ */}
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

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {!editMode ? (
              <>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setEditTemplateMode(true)}
                >
                  Edit Template
                </button>
                <button className="btn btn-primary btn-sm" onClick={enterEditMode}>
                  Edit Schedule
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-secondary btn-sm" onClick={cancelEditMode}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={changeCount === 0}
                  onClick={() => setReviewModalOpen(true)}
                >
                  Review Changes ({changeCount})
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
              <div className="empty-state-title">No schedule yet for this week</div>
              <div className="empty-state-desc">
                Ask Aegis to build one by texting &ldquo;Build next week&rsquo;s schedule&rdquo;, or wait for the auto-schedule to run.
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ScheduleStats schedule={currentSchedule} />

            {/* Open gaps with Resolve buttons */}
            {!editMode && (
              <CurrentScheduleGaps
                gaps={currentGaps}
                onResolve={setResolveGap}
              />
            )}

            {template && (
              <ScheduleRenderer
                schedule={currentSchedule}
                template={template}
                mode={editMode ? 'edit' : 'view'}
                onAssignmentChange={setLiveAssignments}
              />
            )}
          </div>
        )}
      </div>

      {/* ══ History ══════════════════════════════════════════════════════════ */}
      {/* ── HISTORY SECTION — DO NOT REMOVE ────────────────────────────────── */}
      {historySchedules.length > 0 && (
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
          {filteredHistory.length === 0 ? (
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
                  expanded={expandedId === s.id}
                  onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ Review Modal ═════════════════════════════════════════════════════ */}
      {reviewModalOpen && <ReviewModal onClose={() => setReviewModalOpen(false)} />}

      {/* ══ Gap Resolver Panel ═══════════════════════════════════════════════ */}
      {resolveGap && currentSchedule && (
        <GapResolverPanel
          gap={resolveGap}
          schedule={currentSchedule}
          companyId={companyId}
          onClose={() => setResolveGap(null)}
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
