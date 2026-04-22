'use client'
import { useCompany } from '@/lib/hooks/useCompany'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface ScheduleAssignment {
  employee_id: string
  employee_name: string
  shift_name: string
  role: string
  date: string
  start_time: string
  end_time: string
}

interface ScheduleGap {
  shift_name: string
  role: string
  date: string
  required: number
  filled: number
}

interface StaffingReport {
  topContributors: { name: string; hours: number }[]
  leastHours: { name: string; hours: number }[]
  overtime: { name: string; hours: number }[]
  totalHours: number
  totalEstimatedWages: number
  coverageRate: number
  notes: string[]
}

interface Schedule {
  id: string
  week_start: string
  week_end: string
  generated_at: string
  generated_by: 'aegis' | 'manager'
  status: 'draft' | 'published'
  approved_at: string | null
  distributed_at: string | null
  wages_file_url: string | null
  staffing_report: StaffingReport | null
  data: {
    assignments: ScheduleAssignment[]
    gaps: ScheduleGap[]
    summary: string
  }
}

const ROLE_COLORS: Record<string, string> = {
  Greeter:     '#3b82f6',
  Lifeguard:   '#10b981',
  Headguard:   '#f97316',
  AsstManager: '#8b5cf6',
  Manager:     '#ef4444',
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDateLong(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function SchedulePage() {
  const { company } = useCompany()
  const COMPANY_ID = company?.id ?? ''
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [selected, setSelected] = useState<Schedule | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'schedule' | 'report'>('schedule')

  const supabase = createClient()

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    if (!COMPANY_ID) return
    setLoading(true)
    const { data } = await supabase
      .from('schedules')
      .select('*')
      .eq('company_id', COMPANY_ID)
      .order('week_start', { ascending: false })
    if (data && data.length > 0) {
      setSchedules(data)
      setSelected(data[0])
    }
    setLoading(false)
  }

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading schedules...
    </div>
  )

  if (schedules.length === 0) {
    return (
      <div className="page-content">
        <div className="page-header">
          <div className="page-title">Schedule</div>
          <div className="page-subtitle">Weekly schedules built by Aegis</div>
        </div>
        <div style={{
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
        }}>
          <div className="empty-state">
            <div className="empty-state-title">No schedule yet</div>
            <div className="empty-state-desc">
              When Aegis builds a schedule it will appear here for your review. Email or text Aegis to get started.
            </div>
          </div>
        </div>
      </div>
    )
  }

  const weekDays = selected ? Array.from({ length: 7 }, (_, i) => {
    const date = new Date(selected.week_start)
    date.setDate(date.getDate() + i)
    return date.toISOString().split('T')[0]
  }) : []

  const assignmentsByDay = weekDays.reduce((acc, date) => {
    acc[date] = selected?.data.assignments.filter((a) => a.date === date) ?? []
    return acc
  }, {} as Record<string, ScheduleAssignment[]>)

  const gapsByDay = weekDays.reduce((acc, date) => {
    acc[date] = selected?.data.gaps.filter((g) => g.date === date) ?? []
    return acc
  }, {} as Record<string, ScheduleGap[]>)

  const totalGaps = selected?.data.gaps.length ?? 0
  const report = selected?.staffing_report ?? null

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-title">Schedule</div>
        <div className="page-subtitle">Weekly schedules built by Aegis</div>
      </div>

      {/* Week selector + meta */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          className="form-select"
          style={{ maxWidth: 260 }}
          value={selected?.id}
          onChange={(e) => {
            const s = schedules.find((x) => x.id === e.target.value)
            if (s) { setSelected(s); setActiveTab('schedule') }
          }}
        >
          {schedules.map((s) => (
            <option key={s.id} value={s.id}>
              Week of {formatDate(s.week_start)} – {formatDate(s.week_end)}
            </option>
          ))}
        </select>

        {selected && (
          <span className={`badge ${selected.status === 'published' ? 'badge-ready' : 'badge-review'}`}>
            {selected.status === 'published' ? 'Published' : 'Draft'}
          </span>
        )}

        {selected?.approved_at && (
          <span className="badge badge-ready">Approved</span>
        )}

        {selected?.distributed_at && (
          <span className="badge badge-ready">Distributed</span>
        )}

        {selected && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Built by {selected.generated_by === 'aegis' ? 'Aegis' : 'Manager'} · {formatDateLong(selected.generated_at)}
          </span>
        )}

        {totalGaps > 0 && (
          <span className="badge badge-action" style={{ marginLeft: 'auto' }}>
            {totalGaps} gap{totalGaps !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Tabs: Schedule / Staffing Report */}
      <div style={{
        display: 'flex',
        gap: 2,
        borderBottom: '1px solid var(--border-subtle)',
        marginBottom: 20,
      }}>
        {[
          { id: 'schedule', label: 'Schedule' },
          { id: 'report',   label: 'Staffing Report' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as 'schedule' | 'report')}
            style={{
              padding: '8px 18px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 500 : 400,
              cursor: 'pointer',
              marginBottom: -1,
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Schedule Tab ── */}
      {activeTab === 'schedule' && (
        <>
          {/* Aegis summary */}
          {selected?.data.summary && (
            <div style={{
              background: 'var(--bg-surface-1)',
              border: '1px solid var(--border-default)',
              borderLeft: '3px solid var(--accent)',
              borderRadius: 'var(--radius-lg)',
              padding: '14px 18px',
              marginBottom: 20,
            }}>
              <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 6 }}>
                Aegis Summary
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {selected.data.summary}
              </div>
            </div>
          )}

          {/* Weekly grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
            {weekDays.map((date, i) => {
              const assignments = assignmentsByDay[date] ?? []
              const gaps = gapsByDay[date] ?? []
              const dayDate = new Date(date)

              return (
                <div key={date} style={{
                  background: 'var(--bg-surface-1)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-lg)',
                  overflow: 'hidden',
                  minHeight: 200,
                }}>
                  <div style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid var(--border-subtle)',
                    background: 'var(--bg-surface-2)',
                  }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                      {DAYS_SHORT[i]}
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
                      {dayDate.getDate()}
                    </div>
                  </div>

                  <div style={{ padding: '8px' }}>
                    {assignments.length === 0 && gaps.length === 0 && (
                      <div style={{ fontSize: 10, color: 'var(--text-disabled)', textAlign: 'center', padding: '12px 0' }}>
                        No shifts
                      </div>
                    )}
                    {assignments.map((a, j) => {
                      const color = ROLE_COLORS[a.role] ?? '#666'
                      return (
                        <div key={j} style={{
                          background: color + '18',
                          border: `1px solid ${color}33`,
                          borderRadius: 'var(--radius-sm)',
                          padding: '5px 7px',
                          marginBottom: 4,
                        }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color, fontFamily: 'var(--font-display)', lineHeight: 1.2 }}>
                            {a.shift_name}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 1 }}>
                            {a.employee_name}
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>
                            {a.start_time} – {a.end_time}
                          </div>
                        </div>
                      )
                    })}
                    {gaps.map((g, j) => (
                      <div key={j} style={{
                        background: 'var(--status-blocked-bg)',
                        border: '1px solid var(--status-blocked-border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '5px 7px',
                        marginBottom: 4,
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--status-blocked-text)', fontFamily: 'var(--font-display)' }}>
                          GAP
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--status-blocked-text)', opacity: 0.8, marginTop: 1 }}>
                          {g.role} · {g.shift_name}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--status-blocked-text)', opacity: 0.6, marginTop: 1 }}>
                          {g.filled}/{g.required} filled
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── Staffing Report Tab ── */}
      {activeTab === 'report' && (
        <div>
          {!report ? (
            <div style={{
              background: 'var(--bg-surface-1)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
            }}>
              <div className="empty-state">
                <div className="empty-state-title">No staffing report</div>
                <div className="empty-state-desc">
                  Aegis attaches a staffing report to every schedule it generates. This schedule does not have one yet.
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {[
                  { label: 'Total Hours', value: `${report.totalHours}h` },
                  { label: 'Est. Wages', value: `$${Number(report.totalEstimatedWages).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
                  { label: 'Coverage Rate', value: `${report.coverageRate}%` },
                ].map((stat) => (
                  <div key={stat.label} style={{
                    background: 'var(--bg-surface-1)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '16px 20px',
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.05em' }}>
                      {stat.label}
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Top contributors + Least hours */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { title: 'Top Contributors', data: report.topContributors, color: 'var(--accent)' },
                  { title: 'Least Hours', data: report.leastHours, color: 'var(--text-muted)' },
                ].map(({ title, data, color }) => (
                  <div key={title} style={{
                    background: 'var(--bg-surface-1)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-lg)',
                    overflow: 'hidden',
                  }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.05em' }}>
                      {title}
                    </div>
                    <div style={{ padding: '8px 0' }}>
                      {data.length === 0 ? (
                        <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-disabled)' }}>None</div>
                      ) : data.map((item, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', borderBottom: i < data.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item.name}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color }}>{item.hours}h</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Overtime */}
              {report.overtime.length > 0 && (
                <div style={{
                  background: 'var(--bg-surface-1)',
                  border: '1px solid var(--status-blocked-border)',
                  borderRadius: 'var(--radius-lg)',
                  overflow: 'hidden',
                }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--status-blocked-text)', letterSpacing: '0.05em' }}>
                    Overtime Risk
                  </div>
                  <div style={{ padding: '8px 0' }}>
                    {report.overtime.map((item, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', borderBottom: i < report.overtime.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item.name}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--status-blocked-text)' }}>{item.hours}h</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes from Aegis */}
              {report.notes.length > 0 && (
                <div style={{
                  background: 'var(--bg-surface-1)',
                  border: '1px solid var(--border-default)',
                  borderLeft: '3px solid var(--accent)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '14px 18px',
                }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 10 }}>
                    Aegis Notes
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {report.notes.map((note, i) => (
                      <div key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        · {note}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Wages file download */}
              {selected?.wages_file_url && (
                <div style={{
                  background: 'var(--bg-surface-1)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>
                      Estimated Wages Spreadsheet
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Generated by Aegis · {formatDateLong(selected.generated_at)}
                    </div>
                  </div>
                  
                    href={selected.wages_file_url}
                    download
                    style={{
                      padding: '7px 16px',
                      background: 'var(--accent-dim)',
                      border: '1px solid var(--accent-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--accent)',
                      fontSize: 12,
                      fontFamily: 'var(--font-body)',
                      fontWeight: 500,
                      textDecoration: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    Download
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}