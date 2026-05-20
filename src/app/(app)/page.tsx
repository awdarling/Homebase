'use client'
import { useCompany } from '@/lib/hooks/useCompany'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Schedule } from '@/lib/types'

interface ActivityEntry {
  id: string
  actor: 'aegis' | 'manager' | 'soteria' | 'system' | 'quria_admin'
  actor_name: string | null
  actor_avatar_url: string | null
  summary: string
  action: string
  entity_type: string | null
  created_at: string
}

interface TORequest {
  id: string
  status: string
  employee: { id?: string; name: string; primary_role: string } | null
  employee_id?: string
  start_date: string
  end_date: string
}

interface Employee {
  id: string
  name: string
  primary_role: string
  contact_email: string | null
  contact_phone: string | null
  individual_wage: number | null
}

function timeAgo(dateString: string) {
  const diff = Date.now() - new Date(dateString).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isoToday(): string {
  return new Date().toLocaleDateString('en-CA')
}

function enumerateDates(weekStart: string, weekEnd: string): { iso: string; weekday: string }[] {
  const out: { iso: string; weekday: string }[] = []
  const [sy, sm, sd] = weekStart.split('-').map(Number)
  const [ey, em, ed] = weekEnd.split('-').map(Number)
  const cur = new Date(sy, sm - 1, sd)
  const last = new Date(ey, em - 1, ed)
  while (cur <= last) {
    const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    out.push({ iso, weekday: cur.toLocaleDateString('en-US', { weekday: 'short' }) })
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function daysBetween(startISO: string, endISO: string): number {
  const s = new Date(startISO)
  const e = new Date(endISO)
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1)
}

function formatCurrency(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface ActorStyle {
  color: string
  bg: string
  border: string
  label: string
  initial: string
}

const ACTOR_STYLES: Record<string, ActorStyle> = {
  aegis:       { color: 'var(--accent)',     bg: 'var(--accent-dim)',         border: 'var(--accent-border)',      label: 'Aegis',   initial: 'A' },
  manager:     { color: '#60a5fa',           bg: 'rgba(96,165,250,0.1)',      border: 'rgba(96,165,250,0.25)',     label: 'Manager', initial: 'M' },
  soteria:     { color: '#a78bfa',           bg: 'rgba(167,139,250,0.1)',     border: 'rgba(167,139,250,0.25)',    label: 'Soteria', initial: 'S' },
  system:      { color: 'var(--text-muted)', bg: 'var(--bg-surface-3)',       border: 'var(--border-default)',     label: 'System',  initial: '·' },
  quria_admin: { color: 'var(--accent)',     bg: 'rgba(232, 89, 12, 0.15)',   border: 'var(--accent-border)',      label: 'Quria',   initial: 'Q' },
}

// Simple bar chart component
function BarChart({ data, maxValue, color = 'var(--accent)', height = 80 }: {
  data: { label: string; value: number }[]
  maxValue: number
  color?: string
  height?: number
}) {
  if (data.length === 0) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>No data</span>
    </div>
  )
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height, paddingTop: 8 }}>
      {data.map((d, i) => {
        const pct = maxValue > 0 ? (d.value / maxValue) * 100 : 0
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>
              {d.value > 0 ? d.value : ''}
            </div>
            <div style={{
              width: '100%',
              height: `${Math.max(pct, 2)}%`,
              background: color,
              borderRadius: '3px 3px 0 0',
              opacity: 0.85,
              minHeight: 3,
            }} />
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.2, maxWidth: 40, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Donut chart component
function DonutChart({ value, max, color = 'var(--accent)', label }: {
  value: number
  max: number
  color?: string
  label: string
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const r = 28
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ position: 'relative', width: 72, height: 72 }}>
        <svg width="72" height="72" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="36" cy="36" r={r} fill="none" stroke="var(--bg-surface-3)" strokeWidth="8" />
          <circle
            cx="36" cy="36" r={r} fill="none"
            stroke={color} strokeWidth="8"
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 800, color: 'var(--text-primary)'
        }}>
          {Math.round(pct)}%
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>{label}</div>
    </div>
  )
}

function OutThisWeekCard({
  outRequests,
  weekRange,
  totalActive,
}: {
  outRequests: TORequest[]
  weekRange: { start: string; end: string }
  totalActive: number
}) {
  const distinctOutNames = new Set(outRequests.map((r) => r.employee?.name).filter(Boolean) as string[])
  const outCount = distinctOutNames.size
  const outPercent = totalActive > 0 ? (outCount / totalActive) * 100 : 0
  const overThreshold = outPercent > 25

  return (
    <div style={{ marginBottom: 20 }}>
      <div className="section-label">
        Out This Week — {formatDate(weekRange.start)} – {formatDate(weekRange.end)}
      </div>
      <div style={{
        background: 'var(--bg-surface-1)',
        border: `1px solid ${overThreshold ? 'rgba(239,68,68,0.35)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {overThreshold && (
          <div style={{
            padding: '8px 16px',
            background: 'rgba(239,68,68,0.06)',
            borderBottom: '1px solid rgba(239,68,68,0.2)',
            fontSize: 11,
            fontWeight: 600,
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444' }} />
            {outCount} of {totalActive} staff out ({Math.round(outPercent)}%) — coverage at risk
          </div>
        )}
        {outRequests.length === 0 ? (
          <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            No approved time off this week
          </div>
        ) : (
          outRequests.map((r, i) => {
            const days = daysBetween(r.start_date, r.end_date)
            return (
              <div key={r.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 16px',
                borderBottom: i < outRequests.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {r.employee?.name ?? 'Unknown employee'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {r.employee?.primary_role ?? '—'}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {formatDate(r.start_date)}
                  {r.start_date !== r.end_date ? ` – ${formatDate(r.end_date)}` : ''}
                </div>
                <div style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-pill)',
                  background: 'var(--bg-surface-3)',
                  border: '1px solid var(--border-subtle)',
                  whiteSpace: 'nowrap',
                }}>
                  {days} {days === 1 ? 'day' : 'days'}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function ContributorsCard({
  title,
  rows,
  color,
  empty,
}: {
  title: string
  rows: { name: string; hours: number }[]
  color: string
  empty: string
}) {
  const maxHrs = rows.reduce((m, r) => Math.max(m, r.hours), 0)
  return (
    <div>
      <div className="section-label">{title}</div>
      <div style={{
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {rows.length === 0 ? (
          <div style={{ padding: '20px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{empty}</div>
          </div>
        ) : rows.map((c, i) => {
          const pct = maxHrs > 0 ? (c.hours / maxHrs) * 100 : 0
          return (
            <div key={i} style={{
              padding: '10px 16px',
              borderBottom: i < rows.length - 1 ? '1px solid var(--border-subtle)' : 'none',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{c.name}</span>
                <span style={{ fontSize: 12, color, fontWeight: 600 }}>{c.hours}h</span>
              </div>
              <div style={{ height: 3, background: 'var(--bg-surface-3)', borderRadius: 2 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2 }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function HomePage() {
  const { company } = useCompany()
  const COMPANY_ID = company?.id ?? ''
  const router = useRouter()
  const supabase = createClient()

  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [userAvatarByName, setUserAvatarByName] = useState<Record<string, string>>({})
  const [pendingTO, setPendingTO] = useState<TORequest[]>([])
  const [outThisWeek, setOutThisWeek] = useState<TORequest[]>([])
  const [currentSchedule, setCurrentSchedule] = useState<Schedule | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [missingEmail, setMissingEmail] = useState(0)
  const [missingPhone, setMissingPhone] = useState(0)
  const [pendingSwaps, setPendingSwaps] = useState(0)

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    if (!COMPANY_ID) return
    setLoading(true)

    const today = isoToday()

    // Phase 1: schedule (by date range) + everything that doesn't depend on it.
    const [schedRes, actRes, toRes, empRes, swapRes] = await Promise.all([
      supabase.from('schedules').select('*').eq('company_id', COMPANY_ID)
        .lte('week_start', today).gte('week_end', today)
        .order('generated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('activity_log').select('*').eq('company_id', COMPANY_ID).order('created_at', { ascending: false }).limit(8),
      supabase.from('time_off_requests').select('*, employee:employees(name, primary_role)').eq('company_id', COMPANY_ID).eq('status', 'pending').order('requested_at', { ascending: false }),
      supabase.from('employees').select('id, name, primary_role, contact_email, contact_phone, individual_wage').eq('company_id', COMPANY_ID).eq('active', true),
      supabase.from('swap_requests').select('id', { count: 'exact' }).eq('company_id', COMPANY_ID).eq('status', 'pending_manager'),
    ])

    const schedule = (schedRes.data as Schedule | null) ?? null
    setCurrentSchedule(schedule)

    if (actRes.data) {
      const cleaned = (actRes.data as ActivityEntry[]).filter(e =>
        !e.summary.includes('→ intent:') &&
        e.action !== 'message_received' &&
        e.action !== 'intent_classified'
      )
      setActivity(cleaned)

      const namesNeedingAvatars = Array.from(
        new Set(
          cleaned
            .filter((e) => (e.actor === 'manager' || e.actor === 'quria_admin') && !e.actor_avatar_url && e.actor_name)
            .map((e) => e.actor_name as string),
        ),
      )

      if (namesNeedingAvatars.length > 0) {
        const { data: userRows } = await supabase
          .from('users')
          .select('name, avatar_url')
          .in('name', namesNeedingAvatars)
        const map: Record<string, string> = {}
        ;(userRows ?? []).forEach((u: { name: string | null; avatar_url: string | null }) => {
          if (u.name && u.avatar_url) map[u.name] = u.avatar_url
        })
        setUserAvatarByName(map)
      } else {
        setUserAvatarByName({})
      }
    }
    if (toRes.data) setPendingTO(toRes.data as TORequest[])
    if (empRes.data) {
      setEmployees(empRes.data)
      setMissingEmail(empRes.data.filter((e) => !e.contact_email).length)
      setMissingPhone(empRes.data.filter((e) => !e.contact_phone).length)
    }
    if (swapRes.count !== null) setPendingSwaps(swapRes.count)

    // Phase 2: out-this-week uses the schedule's actual week range, not an
    // independently computed one. Skip if there's no current schedule.
    if (schedule) {
      const outRes = await supabase
        .from('time_off_requests')
        .select('*, employee:employees(id, name, primary_role)')
        .eq('company_id', COMPANY_ID)
        .eq('status', 'approved')
        .lte('start_date', schedule.week_end)
        .gte('end_date', schedule.week_start)
      setOutThisWeek((outRes.data ?? []) as TORequest[])
    } else {
      setOutThisWeek([])
    }

    setLoading(false)
  }

  // ── Schedule-derived values ─────────────────────────────────────────────
  // Everything below pulls from the current schedule record. If there is no
  // current schedule, fall back to neutral/empty values — never compute
  // "this week" independently of what the database says.

  const assignments = currentSchedule?.data?.assignments ?? []
  const gapList = currentSchedule?.data?.gaps ?? []
  const unfilledGaps = gapList.filter(g => g.filled_count < g.required_count)
  const unfilledGapsCount = unfilledGaps.length
  const unfilledSlotsTotal = unfilledGaps.reduce((sum, g) => sum + (g.required_count - g.filled_count), 0)
  const filledSlotsTotal = assignments.length

  const estimatedWages = currentSchedule?.staffing_report?.estimated_wages?.total_estimated ?? null
  const coverageRate = currentSchedule?.staffing_report?.coverage_rate
    ?? (currentSchedule
      ? (filledSlotsTotal + unfilledSlotsTotal > 0
        ? Math.round((filledSlotsTotal / (filledSlotsTotal + unfilledSlotsTotal)) * 100)
        : 100)
      : 0)

  // Hours by role from assignments (uses canonical `hours` field).
  const hoursByRole: Record<string, number> = {}
  for (const a of assignments) hoursByRole[a.role] = (hoursByRole[a.role] ?? 0) + (a.hours ?? 0)

  const roleChartData = Object.entries(hoursByRole)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([label, value]) => ({ label, value: Math.round(value) }))
  const maxRoleHours = Math.max(...roleChartData.map((d) => d.value), 1)

  // Gap chart — labels come from the schedule's actual week dates, not from
  // an independently computed Sun-Sat range.
  const weekDays = currentSchedule
    ? enumerateDates(currentSchedule.week_start, currentSchedule.week_end)
    : []
  const unfilledByDate: Record<string, number> = {}
  for (const g of unfilledGaps) {
    unfilledByDate[g.date] = (unfilledByDate[g.date] ?? 0) + (g.required_count - g.filled_count)
  }
  const gapChartData = weekDays.map(d => ({ label: d.weekday, value: unfilledByDate[d.iso] ?? 0 }))

  // Top / bottom contributors come straight from staffing_report. If absent,
  // compute from assignments.
  const reportTop = currentSchedule?.staffing_report?.top_contributors
  const reportBottom = currentSchedule?.staffing_report?.bottom_contributors
  const outNames = new Set(outThisWeek.map((r) => r.employee?.name).filter(Boolean) as string[])

  function computedContributorsFromAssignments() {
    const hoursByEmployee: Record<string, number> = {}
    for (const a of assignments) {
      hoursByEmployee[a.employee_name] = (hoursByEmployee[a.employee_name] ?? 0) + (a.hours ?? 0)
    }
    return employees
      .filter((e) => !outNames.has(e.name))
      .map((e) => ({ name: e.name, hours: Math.round((hoursByEmployee[e.name] ?? 0) * 10) / 10 }))
  }

  const topContributors: { name: string; hours: number }[] = !currentSchedule
    ? []
    : reportTop
      ? reportTop.slice(0, 3).map(c => ({ name: c.name, hours: Math.round(c.hours * 10) / 10 }))
      : [...computedContributorsFromAssignments()].sort((a, b) => b.hours - a.hours).slice(0, 3)

  const bottomContributors: { name: string; hours: number }[] = !currentSchedule
    ? []
    : reportBottom
      ? reportBottom.slice(0, 3).map(c => ({ name: c.name, hours: Math.round(c.hours * 10) / 10 }))
      : [...computedContributorsFromAssignments()].sort((a, b) => a.hours - b.hours).slice(0, 3)

  const pendingCount = pendingTO.length
  const employeeCount = employees.length

  // Warnings
  const warnings: { label: string; desc: string; action: string; path: string; severity: 'high' | 'medium' | 'low' }[] = []
  if (pendingCount > 0) warnings.push({ label: `${pendingCount} pending time-off request${pendingCount > 1 ? 's' : ''}`, desc: 'Awaiting your decision', action: 'Review', path: '/data', severity: 'high' })
  if (pendingSwaps > 0) warnings.push({ label: `${pendingSwaps} swap${pendingSwaps > 1 ? 's' : ''} awaiting approval`, desc: 'Employees are waiting', action: 'Review', path: '/data', severity: 'high' })
  if (unfilledGapsCount > 0) warnings.push({ label: `${unfilledGapsCount} schedule gap${unfilledGapsCount > 1 ? 's' : ''}`, desc: 'Unfilled shifts this week', action: 'View Schedule', path: '/schedule', severity: 'medium' })
  if (missingEmail > 0) warnings.push({ label: `${missingEmail} employee${missingEmail > 1 ? 's' : ''} missing email`, desc: 'Aegis cannot distribute schedules to them', action: 'Fix in Data', path: '/data', severity: 'medium' })
  if (missingPhone > 0) warnings.push({ label: `${missingPhone} employee${missingPhone > 1 ? 's' : ''} missing phone`, desc: 'Aegis cannot send SMS notifications', action: 'Fix in Data', path: '/data', severity: 'low' })
  if (!currentSchedule) warnings.push({ label: 'No schedule yet', desc: 'Email or text Aegis to build this week\'s schedule', action: 'View Schedule', path: '/schedule', severity: 'low' })

  // System status — reflects the current schedule's state, not the warning mix.
  let statusLabel: string
  let statusClass: string
  let statusStyle: React.CSSProperties | undefined
  if (!currentSchedule) {
    statusLabel = 'No Schedule'
    statusClass = 'badge'
    statusStyle = {
      background: 'var(--bg-surface-3)',
      color: 'var(--text-muted)',
      border: '1px solid var(--border-default)',
    }
  } else if ((currentSchedule.status === 'published' || currentSchedule.status === 'approved') && unfilledGapsCount > 0) {
    statusLabel = 'Coverage Gap'
    statusClass = 'badge badge-blocked'
  } else if (currentSchedule.status === 'published' || currentSchedule.status === 'approved') {
    statusLabel = 'Ready'
    statusClass = 'badge badge-ready'
  } else {
    // status === 'draft'
    statusLabel = 'Awaiting Review'
    statusClass = 'badge badge-review'
  }

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading...
    </div>
  )

  return (
    <div className="page-content">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="page-title">Operations Home</div>
            <div className="page-subtitle">Current system state and this week's schedule intelligence</div>
          </div>
          <span className={statusClass} style={statusStyle}>
            <span className="badge-dot" />
            {statusLabel}
          </span>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Active Employees', value: String(employeeCount), sub: 'on record', accent: false },
          { label: 'Est. Labor This Week', value: estimatedWages !== null ? formatCurrency(estimatedWages) : '—', sub: currentSchedule ? 'from current schedule' : 'no schedule yet', accent: false },
          { label: 'Pending Time-Off', value: String(pendingCount), sub: pendingCount > 0 ? 'awaiting decision' : 'all clear', accent: pendingCount > 0 },
          { label: 'Schedule Gaps', value: currentSchedule ? String(unfilledGapsCount) : '—', sub: !currentSchedule ? 'no schedule' : unfilledGapsCount > 0 ? 'unfilled shifts' : 'fully covered', accent: unfilledGapsCount > 0 },
          { label: 'Pending Swaps', value: String(pendingSwaps), sub: pendingSwaps > 0 ? 'need approval' : 'none pending', accent: pendingSwaps > 0 },
        ].map((stat) => (
          <div key={stat.label} style={{
            background: 'var(--bg-surface-1)',
            border: `1px solid ${stat.accent ? 'var(--accent-border)' : 'var(--border-subtle)'}`,
            borderRadius: 'var(--radius-lg)',
            padding: '14px 16px',
          }}>
            <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
              {stat.label}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: stat.label === 'Est. Labor This Week' ? 20 : 26, fontWeight: 800, color: stat.accent ? 'var(--accent)' : 'var(--text-primary)', lineHeight: 1, marginBottom: 5 }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Warnings + Coverage row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>

        {/* Warnings */}
        <div style={{ gridColumn: '1 / 3' }}>
          <div className="section-label">Warnings & Actions</div>
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}>
            {warnings.length === 0 ? (
              <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--status-ready-text)', fontWeight: 500 }}>✓ Nothing requires attention</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>All systems clear</div>
              </div>
            ) : warnings.map((w, i) => {
              const dotColor = w.severity === 'high'
                ? 'var(--status-blocked-text)'
                : w.severity === 'medium'
                  ? 'var(--accent)'
                  : 'var(--text-muted)'
              return (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  borderBottom: i < warnings.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{w.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{w.desc}</div>
                  </div>
                  <button
                    onClick={() => router.push(w.path)}
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: 11, padding: '4px 10px', flexShrink: 0 }}
                  >
                    {w.action}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Coverage donut */}
        <div>
          <div className="section-label">Coverage Rate</div>
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px 16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}>
            <DonutChart
              value={coverageRate}
              max={100}
              color={coverageRate >= 90 ? 'var(--status-ready-text)' : coverageRate >= 70 ? 'var(--accent)' : 'var(--status-blocked-text)'}
              label="this week"
            />
            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                <span>Filled slots</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{filledSlotsTotal}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                <span>Open gaps</span>
                <span style={{ color: unfilledSlotsTotal > 0 ? 'var(--status-blocked-text)' : 'var(--text-muted)', fontWeight: 500 }}>{unfilledSlotsTotal}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Charts row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>

        {/* Hours by role */}
        <div>
          <div className="section-label">Hours by Role This Week</div>
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px',
          }}>
            <BarChart
              data={roleChartData}
              maxValue={maxRoleHours}
              color="var(--accent)"
              height={100}
            />
            {roleChartData.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', paddingBottom: 8 }}>
                {currentSchedule ? 'No schedule this week' : "Ask Aegis to build this week's schedule"}
              </div>
            )}
          </div>
        </div>

        {/* Gaps by day */}
        <div>
          <div className="section-label">Schedule Gaps by Day</div>
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px',
          }}>
            <BarChart
              data={gapChartData}
              maxValue={Math.max(...gapChartData.map((d) => d.value), 1)}
              color="var(--status-blocked-text)"
              height={100}
            />
            {unfilledGapsCount === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', paddingBottom: 8 }}>
                {currentSchedule ? 'No gaps this week' : "Ask Aegis to build this week's schedule"}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Out This Week ── */}
      {currentSchedule && (
        <OutThisWeekCard
          outRequests={outThisWeek}
          weekRange={{ start: currentSchedule.week_start, end: currentSchedule.week_end }}
          totalActive={employees.length}
        />
      )}

      {/* ── Contributors + Activity ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12 }}>

        <ContributorsCard
          title="Top Contributors This Week"
          rows={topContributors}
          color="var(--accent)"
          empty={currentSchedule ? 'No contributor data this week' : "Ask Aegis to build this week's schedule"}
        />

        <ContributorsCard
          title="Bottom Contributors This Week"
          rows={bottomContributors}
          color="#f97316"
          empty={currentSchedule ? 'No contributor data this week' : "Ask Aegis to build this week's schedule"}
        />

        {/* Activity */}
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
            ) : activity.map((item, i) => {
              const style = ACTOR_STYLES[item.actor] ?? ACTOR_STYLES.system
              const iconUrl = item.actor === 'aegis'
                ? '/aegis-icon.jpg'
                : item.actor === 'soteria' || item.actor === 'system'
                  ? '/soteria-icon.png'
                : (item.actor === 'manager' || item.actor === 'quria_admin')
                  ? (item.actor_avatar_url || userAvatarByName[item.actor_name || ''] || null)
                  : null
              const displayLabel = item.actor_name && (item.actor === 'manager' || item.actor === 'quria_admin')
                ? item.actor_name
                : style.label
              const initial = (() => {
                if (item.actor === 'aegis' || item.actor === 'soteria' || item.actor === 'system') {
                  return style.initial
                }
                const name = item.actor_name || ''
                if (!name) return style.initial
                const parts = name.trim().split(/\s+/)
                if (parts.length >= 2) {
                  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
                }
                return parts[0][0].toUpperCase()
              })()
              return (
                <div key={item.id} style={{
                  display: 'flex',
                  gap: 12,
                  padding: '12px 16px',
                  borderBottom: i < activity.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  alignItems: 'flex-start',
                }}>
                  <div style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: iconUrl ? 'transparent' : style.bg,
                    border: `1px solid ${style.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: 'var(--font-display)',
                    color: style.color,
                    flexShrink: 0,
                    overflow: 'hidden',
                  }}>
                    {iconUrl ? (
                      <img
                        src={iconUrl}
                        alt={style.label}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                      />
                    ) : (
                      initial
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {item.summary}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, display: 'flex', gap: 6 }}>
                      <span style={{ color: style.color, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        {displayLabel}
                      </span>
                      <span>·</span>
                      <span>{timeAgo(item.created_at)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}