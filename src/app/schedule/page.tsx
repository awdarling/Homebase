'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const COMPANY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Schedule {
  id: string
  week_start: string
  week_end: string
  generated_at: string
  generated_by: 'aegis' | 'manager'
  status: 'draft' | 'published'
  data: {
    assignments: {
      employee_id: string
      employee_name: string
      shift_name: string
      role: string
      date: string
      start_time: string
      end_time: string
    }[]
    gaps: {
      shift_name: string
      role: string
      date: string
      required: number
      filled: number
    }[]
    summary: string
  }
}

const ROLE_COLORS: Record<string, string> = {
  Greeter:      '#3b82f6',
  Lifeguard:    '#10b981',
  Headguard:    '#f97316',
  AsstManager:  '#8b5cf6',
  Manager:      '#ef4444',
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDateLong(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [selected, setSelected] = useState<Schedule | null>(null)
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
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

  // Build day columns from selected schedule
  const weekDays = selected ? Array.from({ length: 7 }, (_, i) => {
    const date = new Date(selected.week_start)
    date.setDate(date.getDate() + i)
    return date.toISOString().split('T')[0]
  }) : []

  const assignmentsByDay = weekDays.reduce((acc, date) => {
    acc[date] = selected?.data.assignments.filter((a) => a.date === date) ?? []
    return acc
  }, {} as Record<string, Schedule['data']['assignments']>)

  const gapsByDay = weekDays.reduce((acc, date) => {
    acc[date] = selected?.data.gaps.filter((g) => g.date === date) ?? []
    return acc
  }, {} as Record<string, Schedule['data']['gaps']>)

  const totalGaps = selected?.data.gaps.length ?? 0

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-title">Schedule</div>
        <div className="page-subtitle">Weekly schedules built by Aegis</div>
      </div>

      {/* Week selector + status */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, alignItems: 'center' }}>
        <select
          className="form-select"
          style={{ maxWidth: 260 }}
          value={selected?.id}
          onChange={(e) => {
            const s = schedules.find((x) => x.id === e.target.value)
            if (s) setSelected(s)
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
            <span className="badge-dot" style={{
              width: 5, height: 5, borderRadius: '50%',
              background: selected.status === 'published' ? 'var(--status-ready-text)' : 'var(--status-review-text)'
            }} />
            {selected.status === 'published' ? 'Published' : 'Draft'}
          </span>
        )}

        {selected && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Built by {selected.generated_by === 'aegis' ? 'Aegis' : 'Manager'} · {formatDateLong(selected.generated_at)}
          </span>
        )}

        {totalGaps > 0 && (
          <span className="badge badge-action" style={{ marginLeft: 'auto' }}>
            <span className="badge-dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />
            {totalGaps} gap{totalGaps !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Summary from Aegis */}
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
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: 8,
      }}>
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
              {/* Day header */}
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

              {/* Assignments */}
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
                      <div style={{ fontSize: 10, fontWeight: 600, color: color, fontFamily: 'var(--font-display)', lineHeight: 1.2 }}>
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
    </div>
  )
}