'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const COMPANY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

interface ActivityEntry {
  id: string
  actor: 'aegis' | 'manager' | 'soteria' | 'system'
  summary: string
  created_at: string
}

interface TORequest {
  id: string
  status: string
  employee: { name: string; primary_role: string } | null
  start_date: string
  end_date: string
}

interface Schedule {
  id: string
  week_start: string
  week_end: string
  status: string
  generated_by: string
  data: { gaps: { date: string }[] }
}

function timeAgo(dateString: string) {
  const diff = Date.now() - new Date(dateString).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const ACTOR_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  aegis:   { color: 'var(--accent)',     bg: 'var(--accent-dim)',     border: 'var(--accent-border)' },
  manager: { color: '#60a5fa',           bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.25)' },
  soteria: { color: '#a78bfa',           bg: 'rgba(167,139,250,0.1)',border: 'rgba(167,139,250,0.25)' },
  system:  { color: 'var(--text-muted)', bg: 'var(--bg-surface-3)',  border: 'var(--border-default)' },
}

export default function HomePage() {
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [pendingTO, setPendingTO] = useState<TORequest[]>([])
  const [currentSchedule, setCurrentSchedule] = useState<Schedule | null>(null)
  const [employeeCount, setEmployeeCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [actRes, toRes, schedRes, empRes] = await Promise.all([
      supabase
        .from('activity_log')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .order('created_at', { ascending: false })
        .limit(6),
      supabase
        .from('time_off_requests')
        .select('*, employee:employees(name, primary_role)')
        .eq('company_id', COMPANY_ID)
        .eq('status', 'pending')
        .order('requested_at', { ascending: false }),
      supabase
        .from('schedules')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .order('week_start', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('employees')
        .select('id', { count: 'exact' })
        .eq('company_id', COMPANY_ID)
        .eq('active', true),
    ])

    if (actRes.data) setActivity(actRes.data)
    if (toRes.data) setPendingTO(toRes.data as TORequest[])
    if (schedRes.data) setCurrentSchedule(schedRes.data)
    if (empRes.count !== null) setEmployeeCount(empRes.count)
    setLoading(false)
  }

  const gaps = currentSchedule?.data?.gaps?.length ?? 0
  const pendingCount = pendingTO.length

  let statusLabel = 'Ready'
  let statusClass = 'badge-ready'
  let statusDesc = 'All data is current. Aegis is ready to operate.'

  if (pendingCount > 0 && gaps > 0) {
    statusLabel = 'Action Required'
    statusClass = 'badge-action'
    statusDesc = `${pendingCount} pending time-off request${pendingCount > 1 ? 's' : ''} and ${gaps} schedule gap${gaps > 1 ? 's' : ''} need attention.`
  } else if (pendingCount > 0) {
    statusLabel = 'Action Required'
    statusClass = 'badge-action'
    statusDesc = `${pendingCount} pending time-off request${pendingCount > 1 ? 's' : ''} awaiting your decision.`
  } else if (gaps > 0) {
    statusLabel = 'Awaiting Review'
    statusClass = 'badge-review'
    statusDesc = `${gaps} schedule gap${gaps > 1 ? 's' : ''} in the current week.`
  }

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading...
    </div>
  )

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-title">Operations Home</div>
        <div className="page-subtitle">Current system state and recent Aegis activity</div>
      </div>

      <div style={{
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className={`badge ${statusClass}`}>
            <span className="badge-dot" />
            {statusLabel}
          </span>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {statusDesc}
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Watermark Country Club
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12,
        marginBottom: 32,
      }}>
        {[
          {
            label: 'Active Employees',
            value: String(employeeCount),
            sub: 'on record',
            accent: false,
          },
          {
            label: 'Current Schedule',
            value: currentSchedule ? formatDate(currentSchedule.week_start) : '—',
            sub: currentSchedule
              ? `${currentSchedule.status} · by ${currentSchedule.generated_by}`
              : 'No schedule yet',
            accent: false,
          },
          {
            label: 'Pending Time-Off',
            value: String(pendingCount),
            sub: pendingCount > 0 ? 'awaiting decision' : 'all clear',
            accent: pendingCount > 0,
          },
          {
            label: 'Schedule Gaps',
            value: String(gaps),
            sub: gaps > 0 ? 'unfilled shifts' : 'fully covered',
            accent: gaps > 0,
          },
        ].map((stat) => (
          <div key={stat.label} style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 18px',
          }}>
            <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'var(--font-body)' }}>
              {stat.label}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: stat.accent ? 'var(--accent)' : 'var(--text-primary)', lineHeight: 1, marginBottom: 6 }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stat.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
        <div>
          <div className="section-label">Outstanding</div>
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}>
            {pendingTO.length === 0 && gaps === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nothing outstanding</div>
              </div>
            ) : (
              <>
                {pendingTO.map((req) => (
                  <div key={req.id} style={{
                    padding: '14px 16px',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-action-text)', marginTop: 5, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>
                        Time-off request pending
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                        {req.employee?.name} · {formatDate(req.start_date)} – {formatDate(req.end_date)}
                      </div>
                    </div>
                  </div>
                ))}
                {gaps > 0 && (
                  <div style={{
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-review-text)', marginTop: 5, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>
                        {gaps} shift gap{gaps > 1 ? 's' : ''} this week
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                        Review the Schedule tab for details
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div>
          <div className="section-label">Recent Activity</div>
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}>
            {activity.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No activity yet</div>
              </div>
            ) : (
              activity.map((item, i) => {
                const style = ACTOR_STYLES[item.actor] ?? ACTOR_STYLES.system
                return (
                  <div key={item.id} style={{
                    display: 'flex',
                    gap: 12,
                    padding: '14px 16px',
                    borderBottom: i < activity.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    alignItems: 'flex-start',
                  }}>
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: 'var(--radius-sm)',
                      background: style.bg,
                      border: `1px solid ${style.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: 'var(--font-display)',
                      color: style.color,
                      flexShrink: 0,
                    }}>
                      {item.actor[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {item.summary}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 6 }}>
                        <span style={{ color: style.color, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                          {item.actor}
                        </span>
                        <span>·</span>
                        <span>{timeAgo(item.created_at)}</span>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}