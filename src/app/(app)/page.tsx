'use client'
import { useCompany } from '@/lib/hooks/useCompany'
import { useWageBreakdown } from '@/lib/hooks/useWageBreakdown'
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
  reason?: string | null
}

interface Employee {
  id: string
  name: string
  primary_role: string
  contact_email: string | null
  contact_phone: string | null
  individual_wage: number | null
}

interface OutRow {
  id: string
  name: string
  role: string
  days: number
  span: string
  scope: 'full' | 'most' | 'partial' | 'one'
  scopeLabel: string
  reason: string
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
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isoToday(): string {
  return new Date().toLocaleDateString('en-CA')
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  c.setDate(c.getDate() + n)
  return c
}

// Monday=1 / Sunday=0 week window containing `anchor`, honoring the company's
// week_start_day policy. Out-of-office is a pure date-range question, so this is
// computed independently of whether a schedule exists for the week.
function getWeekRange(anchor: Date, weekStartDay: number): { start: string; end: string } {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  const diff = (d.getDay() - weekStartDay + 7) % 7
  const start = new Date(d)
  start.setDate(d.getDate() - diff)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start: toYMD(start), end: toYMD(end) }
}

function enumerateISO(startISO: string, endISO: string): string[] {
  const out: string[] = []
  const [sy, sm, sd] = startISO.split('-').map(Number)
  const [ey, em, ed] = endISO.split('-').map(Number)
  const cur = new Date(sy, sm - 1, sd)
  const last = new Date(ey, em - 1, ed)
  while (cur <= last) {
    out.push(toYMD(cur))
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
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Collapse all approved time-off rows overlapping [rs, re] into one row per
// employee: distinct days off within the window drive the extent label.
function buildOutRows(reqs: TORequest[], rs: string, re: string): OutRow[] {
  const byEmp = new Map<string, { id: string; name: string; role: string; days: Set<string>; reason: string; reasonLen: number }>()
  for (const r of reqs) {
    if (!(r.start_date <= re && r.end_date >= rs)) continue
    const key = r.employee?.id ?? r.employee_id ?? r.employee?.name ?? r.id
    let e = byEmp.get(key)
    if (!e) {
      e = { id: key, name: r.employee?.name ?? 'Unknown employee', role: r.employee?.primary_role ?? '—', days: new Set<string>(), reason: r.reason ?? '', reasonLen: 0 }
      byEmp.set(key, e)
    }
    const s = r.start_date < rs ? rs : r.start_date
    const en = r.end_date > re ? re : r.end_date
    for (const iso of enumerateISO(s, en)) e.days.add(iso)
    const len = daysBetween(r.start_date, r.end_date)
    if (len > e.reasonLen && r.reason) { e.reasonLen = len; e.reason = r.reason }
  }
  return Array.from(byEmp.values()).map((e) => {
    const dayList = Array.from(e.days).sort()
    const n = dayList.length
    const span = n > 0 ? `${formatDate(dayList[0])}${n > 1 ? ` – ${formatDate(dayList[n - 1])}` : ''}` : ''
    const scope: OutRow['scope'] = n >= 7 ? 'full' : n >= 4 ? 'most' : n === 1 ? 'one' : 'partial'
    const scopeLabel = n >= 7 ? 'Full week' : n >= 4 ? 'Most of week' : n === 1 ? '1 day' : `${n} days`
    return { id: e.id, name: e.name, role: e.role, days: n, span, scope, scopeLabel, reason: e.reason || '—' }
  }).sort((a, b) => b.days - a.days || a.name.localeCompare(b.name))
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

function roleColor(role: string): React.CSSProperties {
  if (role === 'Headguard') return { color: '#fbbf24', borderColor: 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.08)' }
  if (role === 'Manager' || role === 'Assistant Manager') return { color: '#818cf8', borderColor: 'rgba(129,140,248,0.3)', background: 'rgba(129,140,248,0.08)' }
  return { color: 'var(--text-secondary)', borderColor: 'var(--border-default)', background: 'var(--bg-surface-3)' }
}

function scopeStyle(scope: OutRow['scope']): React.CSSProperties {
  if (scope === 'full') return { color: 'var(--status-blocked-text)', borderColor: 'var(--status-blocked-border)', background: 'var(--status-blocked-bg)' }
  if (scope === 'most') return { color: 'var(--accent)', borderColor: 'var(--accent-border)', background: 'rgba(249,115,22,0.10)' }
  return { color: 'var(--text-secondary)', borderColor: 'var(--border-default)', background: 'var(--bg-surface-3)' }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return (parts[0]?.[0] ?? '?').toUpperCase()
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.map((d, i) => {
        const pct = maxValue > 0 ? (d.value / maxValue) * 100 : 0
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 48px', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.label}</span>
            <div style={{ height: 10, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.max(pct, 2)}%`, background: color, borderRadius: 'var(--radius-pill)' }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, textAlign: 'right', fontFamily: 'var(--font-display)' }}>{d.value}</span>
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

const CARD: React.CSSProperties = {
  background: 'var(--bg-surface-1)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
}

export default function HomePage() {
  const { company } = useCompany()
  const COMPANY_ID = company?.id ?? ''
  const router = useRouter()
  const supabase = createClient()

  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [userAvatarByName, setUserAvatarByName] = useState<Record<string, string>>({})
  const [pendingTO, setPendingTO] = useState<TORequest[]>([])
  const [approvedTO, setApprovedTO] = useState<TORequest[]>([])
  const [currentSchedule, setCurrentSchedule] = useState<Schedule | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [weekStartDay, setWeekStartDay] = useState<number>(1)
  const [outWeek, setOutWeek] = useState<'this' | 'next'>('this')
  const [loading, setLoading] = useState(true)
  const [missingEmail, setMissingEmail] = useState(0)
  const [missingPhone, setMissingPhone] = useState(0)
  const [pendingSwaps, setPendingSwaps] = useState(0)

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    if (!COMPANY_ID) return
    setLoading(true)

    const today = isoToday()

    // week_start_day drives the this-week / next-week windows for the Out toggle.
    const polRes = await supabase
      .from('policies')
      .select('policy_value, policy_value_json')
      .eq('company_id', COMPANY_ID)
      .in('policy_key', ['week_start_day', 'first_day_of_week'])
      .limit(1)
      .maybeSingle()
    const rawWSD = JSON.stringify(polRes.data?.policy_value_json ?? polRes.data?.policy_value ?? '').toLowerCase()
    const wsd = rawWSD.includes('sun') ? 0 : 1
    setWeekStartDay(wsd)

    const now = new Date()
    const thisRange = getWeekRange(now, wsd)
    const nextRange = getWeekRange(addDays(now, 7), wsd)

    const [schedRes, actRes, toRes, empRes, swapRes, apprRes] = await Promise.all([
      supabase.from('schedules').select('*').eq('company_id', COMPANY_ID).is('deleted_at', null)
        .lte('week_start', today).gte('week_end', today)
        .order('generated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('activity_log').select('*').eq('company_id', COMPANY_ID).order('created_at', { ascending: false }).limit(8),
      supabase.from('time_off_requests').select('*, employee:employees(name, primary_role)').eq('company_id', COMPANY_ID).eq('status', 'pending').order('requested_at', { ascending: false }),
      supabase.from('employees').select('id, name, primary_role, contact_email, contact_phone, individual_wage').eq('company_id', COMPANY_ID).eq('active', true),
      supabase.from('swap_requests').select('id', { count: 'exact' }).eq('company_id', COMPANY_ID).eq('status', 'pending_manager'),
      supabase.from('time_off_requests').select('*, employee:employees(id, name, primary_role)').eq('company_id', COMPANY_ID).eq('status', 'approved')
        .lte('start_date', nextRange.end).gte('end_date', thisRange.start),
    ])

    setCurrentSchedule((schedRes.data as Schedule | null) ?? null)

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
    if (apprRes.data) setApprovedTO(apprRes.data as TORequest[])
    if (empRes.data) {
      setEmployees(empRes.data)
      setMissingEmail(empRes.data.filter((e) => !e.contact_email).length)
      setMissingPhone(empRes.data.filter((e) => !e.contact_phone).length)
    }
    if (swapRes.count !== null) setPendingSwaps(swapRes.count)

    setLoading(false)
  }

  // ── Week windows for the Out toggle (schedule-independent) ────────────────
  const now = new Date()
  const thisRange = getWeekRange(now, weekStartDay)
  const nextRange = getWeekRange(addDays(now, 7), weekStartDay)
  const selRange = outWeek === 'this' ? thisRange : nextRange
  const outRows = buildOutRows(approvedTO, selRange.start, selRange.end)
  const outNextCount = buildOutRows(approvedTO, nextRange.start, nextRange.end).length
  const employeeCount = employees.length
  const outPercent = employeeCount > 0 ? (outRows.length / employeeCount) * 100 : 0
  const roleTally = outRows.reduce<Record<string, number>>((acc, r) => { acc[r.role] = (acc[r.role] ?? 0) + 1; return acc }, {})
  const roleBreak = Object.entries(roleTally).sort(([, a], [, b]) => b - a).map(([role, n]) => `${n} ${role}${n === 1 ? '' : 's'}`)

  // employee ids out THIS week — used to separate "on leave" from "unscheduled & free"
  const outThisIds = new Set(
    approvedTO.filter(r => r.employee?.id && r.start_date <= thisRange.end && r.end_date >= thisRange.start).map(r => r.employee!.id as string),
  )

  // ── Schedule-derived values (this week) ───────────────────────────────────
  const assignments = currentSchedule?.data?.assignments ?? []
  const gapList = currentSchedule?.data?.gaps ?? []
  const unfilledGaps = gapList.filter(g => g.filled_count < g.required_count)
  const unfilledGapsCount = unfilledGaps.length
  const unfilledSlotsTotal = unfilledGaps.reduce((sum, g) => sum + (g.required_count - g.filled_count), 0)
  const filledSlotsTotal = assignments.length

  const { totals: wageTotals, loading: wagesLoading } = useWageBreakdown({ assignments, companyId: COMPANY_ID })
  const estimatedWages = currentSchedule && !wagesLoading ? wageTotals.estimated_pay : null
  const coverageRate = currentSchedule?.staffing_report?.coverage_rate
    ?? (currentSchedule
      ? (filledSlotsTotal + unfilledSlotsTotal > 0
        ? Math.round((filledSlotsTotal / (filledSlotsTotal + unfilledSlotsTotal)) * 100)
        : 100)
      : 0)

  // Hours by role.
  const hoursByRole: Record<string, number> = {}
  for (const a of assignments) hoursByRole[a.role] = (hoursByRole[a.role] ?? 0) + (a.hours ?? 0)
  const roleChartData = Object.entries(hoursByRole)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([label, value]) => ({ label, value: Math.round(value) }))
  const maxRoleHours = Math.max(...roleChartData.map((d) => d.value), 1)

  // ── Hours Fairness (this week) ────────────────────────────────────────────
  const hoursById: Record<string, number> = {}
  for (const a of assignments) hoursById[a.employee_id] = (hoursById[a.employee_id] ?? 0) + (a.hours ?? 0)
  const scheduledVals = employees.map(e => hoursById[e.id] ?? 0).filter(h => h > 0)
  const maxHrs = scheduledVals.length ? Math.max(...scheduledVals) : 0
  const minHrs = scheduledVals.length ? Math.min(...scheduledVals) : 0
  const spread = round1(maxHrs - minHrs)
  const med = median(scheduledVals)
  const topVsMedian = med > 0 ? Math.round((maxHrs / med) * 10) / 10 : 0

  const overtimeRisk = currentSchedule?.staffing_report?.overtime_risk ?? []
  const otByName = new Map(overtimeRisk.map(o => [o.name, o]))

  const reportTop = currentSchedule?.staffing_report?.top_contributors
  const computedTop = employees
    .map(e => ({ name: e.name, hours: round1(hoursById[e.id] ?? 0) }))
    .filter(x => !outThisIds.has(employees.find(e => e.name === x.name)?.id ?? ''))
    .sort((a, b) => b.hours - a.hours)
  const topContributors: { name: string; hours: number }[] = !currentSchedule
    ? []
    : reportTop && reportTop.length
      ? reportTop.slice(0, 3).map(c => ({ name: c.name, hours: round1(c.hours) }))
      : computedTop.slice(0, 3)

  const isTest = (n: string) => /test/i.test(n)
  const unscheduledAvail = currentSchedule
    ? employees.filter(e => (hoursById[e.id] ?? 0) === 0 && !outThisIds.has(e.id) && !isTest(e.name))
    : []
  const onLeaveZero = currentSchedule
    ? employees.filter(e => (hoursById[e.id] ?? 0) === 0 && outThisIds.has(e.id) && !isTest(e.name))
    : []

  const pendingCount = pendingTO.length

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings: { label: string; desc: string; action: string; path: string; severity: 'high' | 'medium' | 'low' }[] = []
  if (pendingCount > 0) warnings.push({ label: `${pendingCount} pending time-off request${pendingCount > 1 ? 's' : ''}`, desc: 'Awaiting your decision', action: 'Review', path: '/data', severity: 'high' })
  if (pendingSwaps > 0) warnings.push({ label: `${pendingSwaps} swap${pendingSwaps > 1 ? 's' : ''} awaiting approval`, desc: 'Employees are waiting', action: 'Review', path: '/data', severity: 'high' })
  if (unscheduledAvail.length > 0) warnings.push({
    label: unscheduledAvail.length === 1
      ? `${unscheduledAvail[0].name} available but scheduled 0 hours`
      : `${unscheduledAvail.length} available staff scheduled 0 hours`,
    desc: unscheduledAvail.length === 1 ? `${unscheduledAvail[0].primary_role}, no time off — possible eligibility miss` : 'Not on leave — possible eligibility miss',
    action: 'Review', path: '/schedule', severity: 'high',
  })
  const topOT = overtimeRisk.filter(o => o.max_hours > 0 && o.hours / o.max_hours >= 0.8).sort((a, b) => (b.hours / b.max_hours) - (a.hours / a.max_hours))[0]
  if (topOT) warnings.push({ label: `${topOT.name} at ${round1(topOT.hours)}h — ${Math.round((topOT.hours / topOT.max_hours) * 100)}% of cap`, desc: 'Overtime risk this week', action: 'View', path: '/schedule', severity: 'medium' })
  if (unfilledGapsCount > 0) warnings.push({ label: `${unfilledGapsCount} schedule gap${unfilledGapsCount > 1 ? 's' : ''}`, desc: 'Unfilled shifts this week', action: 'View Schedule', path: '/schedule', severity: 'medium' })
  if (outNextCount >= 8) warnings.push({ label: `${outNextCount} staff out next week`, desc: 'Plan coverage ahead — check the Next Week view', action: 'Next Week', path: '/schedule', severity: 'medium' })
  if (missingEmail > 0) warnings.push({ label: `${missingEmail} employee${missingEmail > 1 ? 's' : ''} missing email`, desc: 'Aegis cannot distribute schedules to them', action: 'Fix in Data', path: '/data', severity: 'medium' })
  if (missingPhone > 0) warnings.push({ label: `${missingPhone} employee${missingPhone > 1 ? 's' : ''} missing phone`, desc: 'Aegis cannot send SMS notifications', action: 'Fix in Data', path: '/data', severity: 'low' })
  if (!currentSchedule) warnings.push({ label: 'No schedule yet', desc: 'Email or text Aegis to build this week\'s schedule', action: 'View Schedule', path: '/schedule', severity: 'low' })

  // System status.
  let statusLabel: string
  let statusClass: string
  let statusStyle: React.CSSProperties | undefined
  if (!currentSchedule) {
    statusLabel = 'No Schedule'
    statusClass = 'badge'
    statusStyle = { background: 'var(--bg-surface-3)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }
  } else if ((currentSchedule.status === 'published' || currentSchedule.status === 'approved') && unfilledGapsCount > 0) {
    statusLabel = 'Coverage Gap'
    statusClass = 'badge badge-blocked'
  } else if (currentSchedule.status === 'published' || currentSchedule.status === 'approved') {
    statusLabel = 'Ready'
    statusClass = 'badge badge-ready'
  } else {
    statusLabel = 'Awaiting Review'
    statusClass = 'badge badge-review'
  }

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading...
    </div>
  )

  const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 9 }

  return (
    <div className="page-content">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div className="page-title">Operations Home</div>
            <div className="page-subtitle">{company?.name ? `${company.name} — ` : ''}live system state &amp; scheduling intelligence</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <span className={statusClass} style={statusStyle}>
              <span className="badge-dot" />
              {statusLabel}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              <img src="/aegis-icon.jpg" alt="Aegis" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' }} />
              {currentSchedule ? `Aegis is managing this week · updated ${timeAgo(currentSchedule.generated_at)}` : 'Aegis is standing by'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Active Employees', value: String(employeeCount), sub: 'on record', accent: false, small: false },
          { label: 'Est. Labor · This Week', value: estimatedWages !== null ? formatCurrency(estimatedWages) : '—', sub: currentSchedule ? 'pretax · planned' : 'no schedule yet', accent: false, small: true },
          { label: 'Pending Time-Off', value: String(pendingCount), sub: pendingCount > 0 ? 'awaiting decision' : 'all clear', accent: pendingCount > 0, small: false },
          { label: 'Schedule Gaps', value: currentSchedule ? String(unfilledGapsCount) : '—', sub: !currentSchedule ? 'no schedule' : unfilledGapsCount > 0 ? 'unfilled shifts' : 'fully covered', accent: unfilledGapsCount > 0, small: false },
          { label: 'Pending Swaps', value: String(pendingSwaps), sub: pendingSwaps > 0 ? 'need approval' : 'none pending', accent: pendingSwaps > 0, small: false },
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
            <div style={{ fontFamily: 'var(--font-display)', fontSize: stat.small ? 20 : 26, fontWeight: 800, color: stat.accent ? 'var(--accent)' : 'var(--text-primary)', lineHeight: 1, marginBottom: 5 }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Who's Out (toggle) + Coverage/Activity ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 20, alignItems: 'start' }}>

        {/* Who's Out */}
        <div style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>Who&apos;s Out</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{formatDate(selRange.start)} – {formatDate(selRange.end)}</span>
            </div>
            <div style={{ display: 'inline-flex', background: 'var(--bg-surface-3)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-pill)', padding: 3 }}>
              {(['this', 'next'] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => setOutWeek(w)}
                  style={{
                    fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: 'none', padding: '6px 15px', borderRadius: 'var(--radius-pill)',
                    background: outWeek === w ? 'var(--accent)' : 'transparent',
                    color: outWeek === w ? '#0d0d0d' : 'var(--text-secondary)',
                  }}
                >
                  {w === 'this' ? 'This Week' : 'Next Week'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', background: 'var(--bg-surface-2)', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>{outRows.length}</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>of {employeeCount} staff out</span>
            </div>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 'var(--radius-pill)',
              color: outPercent > 25 ? 'var(--status-blocked-text)' : 'var(--accent)',
              background: outPercent > 25 ? 'var(--status-blocked-bg)' : 'var(--accent-dim)',
              border: `1px solid ${outPercent > 25 ? 'var(--status-blocked-border)' : 'var(--accent-border)'}`,
            }}>
              {Math.round(outPercent)}% out
            </span>
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
              {roleBreak.map((rb, i) => (
                <span key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-surface-3)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-pill)', padding: '3px 10px' }}>{rb} out</span>
              ))}
            </div>
          </div>

          {outRows.length === 0 ? (
            <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              No approved time off {outWeek === 'this' ? 'this week' : 'next week'}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Employee', 'Role', 'Dates off', 'Extent', 'Reason'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, padding: '9px 16px', borderBottom: '1px solid var(--border-subtle)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {outRows.map((r, i) => (
                  <tr key={r.id}>
                    <td style={{ padding: '10px 16px', borderBottom: i < outRows.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-surface-3)', border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>{initialsOf(r.name)}</span>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{r.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 16px', borderBottom: i < outRows.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-pill)', border: '1px solid', whiteSpace: 'nowrap', ...roleColor(r.role) }}>{r.role}</span>
                    </td>
                    <td style={{ padding: '10px 16px', borderBottom: i < outRows.length - 1 ? '1px solid var(--border-subtle)' : 'none', fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{r.span}</td>
                    <td style={{ padding: '10px 16px', borderBottom: i < outRows.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-pill)', border: '1px solid', whiteSpace: 'nowrap', ...scopeStyle(r.scope) }}>{r.scopeLabel}</span>
                    </td>
                    <td style={{ padding: '10px 16px', borderBottom: i < outRows.length - 1 ? '1px solid var(--border-subtle)' : 'none', fontSize: 12, color: 'var(--text-muted)' }}>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Side: coverage + activity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ ...CARD, padding: '18px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ ...labelStyle, alignSelf: 'flex-start', marginBottom: 0 }}>Coverage · This Week</div>
            <DonutChart
              value={coverageRate}
              max={100}
              color={coverageRate >= 90 ? 'var(--status-ready-text)' : coverageRate >= 70 ? 'var(--accent)' : 'var(--status-blocked-text)'}
              label="covered"
            />
            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', padding: '5px 0', borderTop: '1px solid var(--border-subtle)' }}>
                <span>Filled slots</span><span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{filledSlotsTotal}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', padding: '5px 0', borderTop: '1px solid var(--border-subtle)' }}>
                <span>Open gaps</span><span style={{ color: unfilledSlotsTotal > 0 ? 'var(--status-blocked-text)' : 'var(--text-muted)', fontWeight: 500 }}>{unfilledSlotsTotal}</span>
              </div>
            </div>
          </div>

          <div>
            <div style={labelStyle}>Recent Activity</div>
            <div style={CARD}>
              {activity.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>No activity yet</div>
              ) : activity.map((item, i) => {
                const style = ACTOR_STYLES[item.actor] ?? ACTOR_STYLES.system
                const iconUrl = item.actor === 'aegis'
                  ? '/aegis-icon.jpg'
                  : item.actor === 'soteria' || item.actor === 'system'
                    ? '/soteria-icon.png'
                    : (item.actor === 'manager' || item.actor === 'quria_admin')
                      ? (item.actor_avatar_url || userAvatarByName[item.actor_name || ''] || null)
                      : null
                const displayLabel = item.actor_name && (item.actor === 'manager' || item.actor === 'quria_admin') ? item.actor_name : style.label
                const initial = (item.actor === 'aegis' || item.actor === 'soteria' || item.actor === 'system')
                  ? style.initial
                  : (item.actor_name ? initialsOf(item.actor_name) : style.initial)
                return (
                  <div key={item.id} style={{ display: 'flex', gap: 11, padding: '11px 16px', borderBottom: i < activity.length - 1 ? '1px solid var(--border-subtle)' : 'none', alignItems: 'flex-start' }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: iconUrl ? 'transparent' : style.bg, border: `1px solid ${style.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-display)', color: style.color, flexShrink: 0, overflow: 'hidden' }}>
                      {iconUrl ? <img src={iconUrl} alt={style.label} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : initial}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item.summary}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, display: 'flex', gap: 6 }}>
                        <span style={{ color: style.color, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{displayLabel}</span>
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

      {/* ── Bottom: Warnings · Hours Fairness · Hours by Role ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, alignItems: 'start' }}>

        {/* Warnings */}
        <div>
          <div style={labelStyle}>Warnings &amp; Actions</div>
          <div style={CARD}>
            {warnings.length === 0 ? (
              <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--status-ready-text)', fontWeight: 500 }}>✓ Nothing requires attention</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>All systems clear</div>
              </div>
            ) : warnings.map((w, i) => {
              const dotColor = w.severity === 'high' ? 'var(--status-blocked-text)' : w.severity === 'medium' ? 'var(--accent)' : 'var(--text-muted)'
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: i < warnings.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{w.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{w.desc}</div>
                  </div>
                  <button onClick={() => router.push(w.path)} className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '4px 10px', flexShrink: 0 }}>{w.action}</button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Hours Fairness */}
        <div>
          <div style={labelStyle}>Hours Fairness</div>
          <div style={CARD}>
            <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 16 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, color: 'var(--accent)' }}>{spread}h</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>spread</div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>{topVsMedian ? `${topVsMedian}×` : '—'}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>top vs median</div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, color: unscheduledAvail.length > 0 ? 'var(--status-blocked-text)' : 'var(--text-primary)' }}>{unscheduledAvail.length}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>free &amp; unscheduled</div>
              </div>
            </div>
            <div style={{ padding: '6px 0' }}>
              {!currentSchedule ? (
                <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>Ask Aegis to build this week&apos;s schedule</div>
              ) : (
                <>
                  {topContributors.map((c, i) => {
                    const ot = otByName.get(c.name)
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px' }}>
                        <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-surface-3)', border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>{initialsOf(c.name)}</span>
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>
                          {c.name}
                          {ot && ot.max_hours > 0 && (
                            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-pill)', padding: '1px 6px', marginLeft: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>OT {Math.round((ot.hours / ot.max_hours) * 100)}%</span>
                          )}
                        </span>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: i === 0 ? 'var(--accent)' : 'var(--text-primary)' }}>{c.hours}h</span>
                      </div>
                    )
                  })}
                  {unscheduledAvail.slice(0, 2).map((e) => (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', background: 'var(--status-blocked-bg)', borderTop: '1px solid var(--status-blocked-border)', borderBottom: '1px solid var(--status-blocked-border)' }}>
                      <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-surface-3)', border: '1px solid var(--status-blocked-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11, color: 'var(--status-blocked-text)', flexShrink: 0 }}>{initialsOf(e.name)}</span>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--status-blocked-text)', fontWeight: 600 }}>
                        {e.name}
                        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--status-blocked-text)', border: '1px solid var(--status-blocked-border)', borderRadius: 'var(--radius-pill)', padding: '1px 6px', marginLeft: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>free · 0h</span>
                      </span>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: 'var(--status-blocked-text)' }}>0.0h</span>
                    </div>
                  ))}
                </>
              )}
            </div>
            {currentSchedule && onLeaveZero.length > 0 && (
              <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface-2)' }}>
                {onLeaveZero.slice(0, 2).map(e => e.name).join(' & ')}{onLeaveZero.length > 2 ? ` +${onLeaveZero.length - 2}` : ''} also at 0h — on approved leave, excluded from the flag.
              </div>
            )}
          </div>
        </div>

        {/* Hours by Role */}
        <div>
          <div style={labelStyle}>Hours by Role <span style={{ color: 'var(--text-disabled)', letterSpacing: '0.04em', fontWeight: 500, textTransform: 'none' }}>· this week</span></div>
          <div style={{ ...CARD, padding: 16 }}>
            <BarChart data={roleChartData} maxValue={maxRoleHours} color="var(--accent)" />
            {roleChartData.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', paddingTop: 8 }}>
                {currentSchedule ? 'No schedule this week' : "Ask Aegis to build this week's schedule"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
