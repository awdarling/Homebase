'use client'
import { useCompany } from '@/lib/hooks/useCompany'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface ActivityEntry {
  id: string
  actor: 'aegis' | 'manager' | 'soteria' | 'system'
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

interface Schedule {
  id: string
  week_start: string
  week_end: string
  status: string
  generated_by: string
  approved_at: string | null
  distributed_at: string | null
  staffing_report: {
    totalHours: number
    totalEstimatedWages: number
    coverageRate: number
    topContributors: { name: string; hours: number }[]
    overtime: { name: string; hours: number }[]
    notes: string[]
  } | null
  data: {
    assignments: ScheduleAssignment[]
    gaps: ScheduleGap[]
    summary: string
  }
}

interface Employee {
  id: string
  name: string
  primary_role: string
  contact_email: string | null
  contact_phone: string | null
  individual_wage: number | null
}

interface WageRate {
  role: string
  hourly_rate: number
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

function isoDay(d: Date): string {
  return d.toLocaleDateString('en-CA')
}

function currentWeekRange(): { start: string; end: string } {
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() - today.getDay())
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start: isoDay(start), end: isoDay(end) }
}

function daysBetween(startISO: string, endISO: string): number {
  const s = new Date(startISO)
  const e = new Date(endISO)
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1)
}

function formatCurrency(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const ACTOR_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  aegis:   { color: 'var(--accent)',     bg: 'var(--accent-dim)',      border: 'var(--accent-border)' },
  manager: { color: '#60a5fa',           bg: 'rgba(96,165,250,0.1)',   border: 'rgba(96,165,250,0.25)' },
  soteria: { color: '#a78bfa',           bg: 'rgba(167,139,250,0.1)',  border: 'rgba(167,139,250,0.25)' },
  system:  { color: 'var(--text-muted)', bg: 'var(--bg-surface-3)',    border: 'var(--border-default)' },
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
  const [pendingTO, setPendingTO] = useState<TORequest[]>([])
  const [outThisWeek, setOutThisWeek] = useState<TORequest[]>([])
  const [currentSchedule, setCurrentSchedule] = useState<Schedule | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [wageRates, setWageRates] = useState<WageRate[]>([])
  const [loading, setLoading] = useState(true)
  const [missingEmail, setMissingEmail] = useState(0)
  const [missingPhone, setMissingPhone] = useState(0)
  const [pendingSwaps, setPendingSwaps] = useState(0)

  const weekRange = currentWeekRange()

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    if (!COMPANY_ID) return
    setLoading(true)

    const [actRes, toRes, outRes, schedRes, empRes, wageRes, swapRes] = await Promise.all([
      supabase.from('activity_log').select('*').eq('company_id', COMPANY_ID).order('created_at', { ascending: false }).limit(8),
      supabase.from('time_off_requests').select('*, employee:employees(name, primary_role)').eq('company_id', COMPANY_ID).eq('status', 'pending').order('requested_at', { ascending: false }),
      supabase.from('time_off_requests').select('*, employee:employees(id, name, primary_role)').eq('company_id', COMPANY_ID).eq('status', 'approved').lte('start_date', weekRange.end).gte('end_date', weekRange.start),
      supabase.from('schedules').select('*').eq('company_id', COMPANY_ID).order('week_start', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('employees').select('id, name, primary_role, contact_email, contact_phone, individual_wage').eq('company_id', COMPANY_ID).eq('active', true),
      supabase.from('wage_rates').select('role, hourly_rate').eq('company_id', COMPANY_ID),
      supabase.from('swap_requests').select('id', { count: 'exact' }).eq('company_id', COMPANY_ID).eq('status', 'pending_manager'),
    ])

    if (actRes.data) setActivity(actRes.data)
    if (toRes.data) setPendingTO(toRes.data as TORequest[])
    if (outRes.data) setOutThisWeek(outRes.data as TORequest[])
    if (schedRes.data) setCurrentSchedule(schedRes.data)
    if (empRes.data) {
      setEmployees(empRes.data)
      setMissingEmail(empRes.data.filter((e) => !e.contact_email).length)
      setMissingPhone(empRes.data.filter((e) => !e.contact_phone).length)
    }
    if (wageRes.data) setWageRates(wageRes.data)
    if (swapRes.count !== null) setPendingSwaps(swapRes.count)

    setLoading(false)
  }

  // ── Computed values ──────────────────────────────────────────────────────

  const gaps = currentSchedule?.data?.gaps?.length ?? 0
  const pendingCount = pendingTO.length
  const employeeCount = employees.length

  // Hours by role from current schedule
  const hoursByRole: Record<string, number> = {}
  if (currentSchedule?.data?.assignments) {
    for (const a of currentSchedule.data.assignments) {
      const start = new Date(`2000-01-01T${a.start_time}`)
      const end = new Date(`2000-01-01T${a.end_time}`)
      const hrs = (end.getTime() - start.getTime()) / 3600000
      hoursByRole[a.role] = (hoursByRole[a.role] ?? 0) + hrs
    }
  }

  // Hours by employee from current schedule
  const hoursByEmployee: Record<string, number> = {}
  if (currentSchedule?.data?.assignments) {
    for (const a of currentSchedule.data.assignments) {
      const start = new Date(`2000-01-01T${a.start_time}`)
      const end = new Date(`2000-01-01T${a.end_time}`)
      const hrs = (end.getTime() - start.getTime()) / 3600000
      hoursByEmployee[a.employee_name] = (hoursByEmployee[a.employee_name] ?? 0) + hrs
    }
  }

  // Estimated wages from current schedule
  function getWage(employeeName: string, role: string): number {
    const emp = employees.find((e) => e.name === employeeName)
    if (emp?.individual_wage) return emp.individual_wage
    const rate = wageRates.find((w) => w.role === role)
    return rate?.hourly_rate ?? 0
  }

  let estimatedWages = 0
  if (currentSchedule?.data?.assignments) {
    for (const a of currentSchedule.data.assignments) {
      const start = new Date(`2000-01-01T${a.start_time}`)
      const end = new Date(`2000-01-01T${a.end_time}`)
      const hrs = (end.getTime() - start.getTime()) / 3600000
      estimatedWages += hrs * getWage(a.employee_name, a.role)
    }
  }

  // Out-this-week employee names — exclude them from contributor rankings
  const outNames = new Set(outThisWeek.map((r) => r.employee?.name).filter(Boolean) as string[])

  // Build contributor rows for every active employee (zero hours included),
  // skipping anyone on approved time off this week
  const contributorRows = employees
    .filter((e) => !outNames.has(e.name))
    .map((e) => ({
      name: e.name,
      hours: Math.round((hoursByEmployee[e.name] ?? 0) * 10) / 10,
    }))

  const topContributors = [...contributorRows]
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 3)

  const bottomContributors = [...contributorRows]
    .sort((a, b) => a.hours - b.hours)
    .slice(0, 3)

  // Role breakdown for bar chart
  const roleChartData = Object.entries(hoursByRole)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([label, value]) => ({ label, value: Math.round(value) }))

  const maxRoleHours = Math.max(...roleChartData.map((d) => d.value), 1)

  // Gaps by day for gap chart
  const gapsByDay: Record<string, number> = {}
  if (currentSchedule?.data?.gaps) {
    for (const g of currentSchedule.data.gaps) {
      const day = new Date(g.date).toLocaleDateString('en-US', { weekday: 'short' })
      gapsByDay[day] = (gapsByDay[day] ?? 0) + 1
    }
  }
  const gapChartData = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .map((label) => ({ label, value: gapsByDay[label] ?? 0 }))

  // Coverage rate
  const totalRequired = currentSchedule?.data?.gaps?.reduce((acc, g) => acc + g.required, 0) ?? 0
  const totalFilled = currentSchedule?.data?.gaps?.reduce((acc, g) => acc + g.filled, 0) ?? 0
  const totalSlots = (currentSchedule?.data?.assignments?.length ?? 0) + totalRequired
  const coverageRate = totalSlots > 0
    ? Math.round(((currentSchedule?.data?.assignments?.length ?? 0) / totalSlots) * 100)
    : currentSchedule ? 100 : 0

  // Warnings
  const warnings: { label: string; desc: string; action: string; path: string; severity: 'high' | 'medium' | 'low' }[] = []
  if (pendingCount > 0) warnings.push({ label: `${pendingCount} pending time-off request${pendingCount > 1 ? 's' : ''}`, desc: 'Awaiting your decision', action: 'Review', path: '/data', severity: 'high' })
  if (pendingSwaps > 0) warnings.push({ label: `${pendingSwaps} swap${pendingSwaps > 1 ? 's' : ''} awaiting approval`, desc: 'Employees are waiting', action: 'Review', path: '/data', severity: 'high' })
  if (gaps > 0) warnings.push({ label: `${gaps} schedule gap${gaps > 1 ? 's' : ''}`, desc: 'Unfilled shifts this week', action: 'View Schedule', path: '/schedule', severity: 'medium' })
  if (missingEmail > 0) warnings.push({ label: `${missingEmail} employee${missingEmail > 1 ? 's' : ''} missing email`, desc: 'Aegis cannot distribute schedules to them', action: 'Fix in Data', path: '/data', severity: 'medium' })
  if (missingPhone > 0) warnings.push({ label: `${missingPhone} employee${missingPhone > 1 ? 's' : ''} missing phone`, desc: 'Aegis cannot send SMS notifications', action: 'Fix in Data', path: '/data', severity: 'low' })
  if (!currentSchedule) warnings.push({ label: 'No schedule yet', desc: 'Email or text Aegis to build this week\'s schedule', action: 'View Schedule', path: '/schedule', severity: 'low' })

  // System status
  let statusLabel = 'Ready'
  let statusClass = 'badge-ready'
  if (warnings.some((w) => w.severity === 'high')) { statusLabel = 'Action Required'; statusClass = 'badge-action' }
  else if (warnings.some((w) => w.severity === 'medium')) { statusLabel = 'Awaiting Review'; statusClass = 'badge-review' }

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
          <span className={`badge ${statusClass}`}>
            <span className="badge-dot" />
            {statusLabel}
          </span>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Active Employees', value: String(employeeCount), sub: 'on record', accent: false },
          { label: 'Est. Labor This Week', value: estimatedWages > 0 ? formatCurrency(estimatedWages) : '—', sub: currentSchedule ? 'from current schedule' : 'no schedule yet', accent: false },
          { label: 'Pending Time-Off', value: String(pendingCount), sub: pendingCount > 0 ? 'awaiting decision' : 'all clear', accent: pendingCount > 0 },
          { label: 'Schedule Gaps', value: String(gaps), sub: gaps > 0 ? 'unfilled shifts' : currentSchedule ? 'fully covered' : 'no schedule', accent: gaps > 0 },
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
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{currentSchedule?.data?.assignments?.length ?? 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                <span>Open gaps</span>
                <span style={{ color: gaps > 0 ? 'var(--status-blocked-text)' : 'var(--text-muted)', fontWeight: 500 }}>{gaps}</span>
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
                Will populate when Aegis builds a schedule
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
            {gaps === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', paddingBottom: 8 }}>
                {currentSchedule ? 'No gaps this week' : 'Will populate when Aegis builds a schedule'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Out This Week ── */}
      <OutThisWeekCard
        outRequests={outThisWeek}
        weekRange={weekRange}
        totalActive={employees.length}
      />

      {/* ── Contributors + Activity ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12 }}>

        <ContributorsCard
          title="Top Contributors This Week"
          rows={topContributors}
          color="var(--accent)"
          empty="Will populate when Aegis builds a schedule"
        />

        <ContributorsCard
          title="Bottom Contributors This Week"
          rows={bottomContributors}
          color="#f97316"
          empty="Will populate when Aegis builds a schedule"
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
                    borderRadius: 'var(--radius-sm)',
                    background: style.bg,
                    border: `1px solid ${style.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
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
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, display: 'flex', gap: 6 }}>
                      <span style={{ color: style.color, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        {item.actor}
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