'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompany } from '@/lib/hooks/useCompany'
import type { Employee } from '@/lib/types'

type OnboardingStatus = 'not_started' | 'in_progress' | 'complete' | 'timed_out' | 'skipped'
type FilterType = 'all' | 'not_started' | 'in_progress' | 'complete' | 'flagged'

interface OnboardingMeta {
  employee_id?: string
  employee_name?: string
  email?: string
  role?: string
  availability_raw?: string
  availability_parsed?: unknown
  weekly_hours?: number
  flagged_low_availability?: boolean
  time_off?: string | boolean
  has_time_off?: boolean
}

interface MemoryContent {
  step?: string
  current_step?: string
  employee_id?: string
  email?: string
  role?: string
}

interface AegisMemoryRow {
  id: string
  source: string
  content: string
  created_at: string
}

interface ActivityEntry {
  id: string
  actor: 'aegis' | 'manager' | 'soteria' | 'system'
  action: string
  summary: string
  metadata: Record<string, unknown> | null
  entity_id: string | null
  created_at: string
}

interface EmployeeOnboardingRow {
  employee: Employee
  status: OnboardingStatus
  currentStep: string | null
  availabilityFormatted: string | null
  availabilityRaw: string | null
  weeklyHours: number | null
  flaggedLow: boolean
  emailCollected: boolean
  roleCollected: boolean
  timeOffSubmitted: boolean
  completedAt: string | null
}

const ONBOARDING_ACTIONS = ['onboarding_complete', 'onboarding_timeout', 'onboarding_skipped_no_phone']

const STATUS_CONFIG: Record<OnboardingStatus, { label: string; color: string; bg: string; border: string }> = {
  not_started: { label: 'Not Started', color: 'var(--text-muted)',          bg: 'var(--bg-surface-3)',      border: 'var(--border-default)' },
  in_progress: { label: 'In Progress', color: '#d97706',                   bg: 'rgba(245,158,11,0.1)',     border: 'rgba(245,158,11,0.3)' },
  complete:    { label: 'Complete',    color: 'var(--status-ready-text)',   bg: 'var(--status-ready-bg)',   border: 'var(--status-ready-border)' },
  timed_out:   { label: 'Timed Out',  color: 'var(--status-blocked-text)', bg: 'var(--status-blocked-bg)', border: 'var(--status-blocked-border)' },
  skipped:     { label: 'Skipped',    color: 'var(--text-muted)',          bg: 'var(--bg-surface-3)',      border: 'var(--border-default)' },
}

const STEP_LABELS: Record<string, string> = {
  email:                 'Waiting for: email',
  awaiting_email:        'Waiting for: email',
  role:                  'Waiting for: role',
  awaiting_role:         'Waiting for: role',
  availability:          'Waiting for: availability',
  awaiting_availability: 'Waiting for: availability',
  time_off:              'Waiting for: time off',
  awaiting_time_off:     'Waiting for: time off',
}

function formatTime12(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const hour = h % 12 || 12
  return m === 0 ? `${hour}${ampm}` : `${hour}:${String(m).padStart(2, '0')}${ampm}`
}

function formatAvailabilityParsed(parsed: unknown): string | null {
  if (!parsed) return null
  if (typeof parsed === 'string') return parsed
  if (Array.isArray(parsed)) {
    const parts = (parsed as Array<{ day?: string; start?: string; end?: string }>)
      .map((p) => {
        const day = p.day ?? ''
        const time = p.start && p.end ? `${formatTime12(p.start)}–${formatTime12(p.end)}` : ''
        return [day, time].filter(Boolean).join(' ')
      })
      .filter(Boolean)
    return parts.length ? parts.join(', ') : null
  }
  if (typeof parsed === 'object' && parsed !== null) {
    return JSON.stringify(parsed)
  }
  return null
}

function formatDateTime(d: string): string {
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function formatDateHeading(dateString: string) {
  const date = new Date(dateString)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function formatTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
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

function StatusBadge({ status }: { status: OnboardingStatus }) {
  const s = STATUS_CONFIG[status]
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 'var(--radius-pill)',
      fontSize: 11, fontWeight: 500,
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

function LowAvailBadge() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 7px',
      borderRadius: 'var(--radius-pill)',
      fontSize: 10, fontWeight: 600,
      background: 'rgba(245,158,11,0.15)',
      color: '#d97706',
      border: '1px solid rgba(245,158,11,0.35)',
      whiteSpace: 'nowrap',
    }}>
      ⚠ Low hrs
    </span>
  )
}

function YesNo({ yes }: { yes: boolean }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 500,
      color: yes ? 'var(--status-ready-text)' : 'var(--text-disabled)',
    }}>
      {yes ? 'Yes' : 'No'}
    </span>
  )
}

function getEmptyMessage(rows: EmployeeOnboardingRow[], filter: FilterType): { title: string; desc: string } {
  if (rows.length === 0) {
    return {
      title: 'No employees found',
      desc: 'Add employees in the Employees tab first.',
    }
  }
  if (filter === 'all') {
    const allDone = rows.every((r) => r.status === 'complete' || r.status === 'skipped')
    if (allDone) return { title: 'All employees have completed onboarding.', desc: '' }
    const noneStarted = rows.every((r) => r.status === 'not_started' || r.status === 'skipped')
    if (noneStarted) return {
      title: 'No onboarding sessions started yet.',
      desc: 'Ask Aegis to onboard your team by texting "Onboard my team".',
    }
  }
  return { title: 'No employees match this filter.', desc: 'Try selecting a different filter above.' }
}

export default function OnboardingTab() {
  const { company } = useCompany()
  const COMPANY_ID = company?.id ?? ''
  const [rows, setRows] = useState<EmployeeOnboardingRow[]>([])
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterType>('all')

  const supabase = createClient()

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    if (!COMPANY_ID) return
    setLoading(true)

    const [empRes, logsRes] = await Promise.all([
      supabase.from('employees').select('*').eq('company_id', COMPANY_ID).eq('active', true).order('name'),
      supabase.from('activity_log').select('*').eq('company_id', COMPANY_ID).in('action', ONBOARDING_ACTIONS).order('created_at', { ascending: false }),
    ])

    let memoryRows: AegisMemoryRow[] = []
    try {
      const { data: mem } = await (supabase as ReturnType<typeof createClient> & {
        from(table: 'aegis_memory'): { select: (cols: string) => { eq: (col: string, val: string) => { like: (col: string, pat: string) => Promise<{ data: AegisMemoryRow[] | null }> } } }
      }).from('aegis_memory').select('id, source, content, created_at').eq('company_id', COMPANY_ID).like('source', 'onboarding:%')
      if (mem) memoryRows = mem
    } catch {
      // aegis_memory table may not exist yet
    }

    const empList = (empRes.data ?? []) as Employee[]
    const logList = (logsRes.data ?? []) as ActivityEntry[]

    setActivityEntries(logList)

    // Index logs by employee_id (from metadata or entity_id), keep most recent per employee
    const logByEmpId = new Map<string, ActivityEntry>()
    for (const log of logList) {
      const meta = log.metadata as OnboardingMeta | null
      const empId = meta?.employee_id ?? log.entity_id
      if (empId && !logByEmpId.has(empId)) logByEmpId.set(empId, log)
    }

    // Index aegis_memory by employee_id (from content JSON) and by phone (from source)
    const memByEmpId = new Map<string, AegisMemoryRow>()
    const memByPhone = new Map<string, AegisMemoryRow>()
    for (const row of memoryRows) {
      try {
        const content = JSON.parse(row.content) as MemoryContent
        if (content.employee_id && !memByEmpId.has(content.employee_id)) {
          memByEmpId.set(content.employee_id, row)
        }
        const phoneMatch = row.source.match(/^onboarding:(.+)$/)
        if (phoneMatch) memByPhone.set(phoneMatch[1], row)
      } catch {
        // skip unparseable rows
      }
    }

    const onboardingRows: EmployeeOnboardingRow[] = empList.map((emp) => {
      const log = logByEmpId.get(emp.id)
      const memRow = memByEmpId.get(emp.id) ?? (emp.contact_phone ? memByPhone.get(emp.contact_phone) : undefined)

      if (log) {
        const meta = log.metadata as OnboardingMeta | null
        const status: OnboardingStatus =
          log.action === 'onboarding_complete'         ? 'complete' :
          log.action === 'onboarding_timeout'          ? 'timed_out' :
          log.action === 'onboarding_skipped_no_phone' ? 'skipped' :
          'not_started'

        const formatted = formatAvailabilityParsed(meta?.availability_parsed)
        const raw = typeof meta?.availability_raw === 'string' ? meta.availability_raw : null

        return {
          employee: emp,
          status,
          currentStep: null,
          availabilityFormatted: formatted,
          availabilityRaw: raw,
          weeklyHours: meta?.weekly_hours ?? null,
          flaggedLow: !!meta?.flagged_low_availability,
          emailCollected: !!meta?.email,
          roleCollected: !!meta?.role,
          timeOffSubmitted: !!(meta?.time_off || meta?.has_time_off),
          completedAt: log.created_at,
        }
      }

      if (memRow) {
        let content: MemoryContent = {}
        try { content = JSON.parse(memRow.content) } catch { /* ignore */ }
        const step = content.step ?? content.current_step ?? null
        return {
          employee: emp,
          status: 'in_progress',
          currentStep: step ? (STEP_LABELS[step] ?? `Step: ${step}`) : 'In progress',
          availabilityFormatted: null,
          availabilityRaw: null,
          weeklyHours: null,
          flaggedLow: false,
          emailCollected: !!content.email,
          roleCollected: !!content.role,
          timeOffSubmitted: false,
          completedAt: null,
        }
      }

      return {
        employee: emp,
        // Reachable by phone OR email → onboarding can start. Only truly
        // unreachable employees (neither on file) are "skipped".
        status: (emp.contact_phone || emp.contact_email) ? 'not_started' : 'skipped',
        currentStep: null,
        availabilityFormatted: null,
        availabilityRaw: null,
        weeklyHours: null,
        flaggedLow: false,
        emailCollected: false,
        roleCollected: false,
        timeOffSubmitted: false,
        completedAt: null,
      }
    })

    setRows(onboardingRows)
    setLoading(false)
  }

  const filtered = rows.filter((r) => {
    if (filter === 'all')         return true
    if (filter === 'not_started') return r.status === 'not_started'
    if (filter === 'in_progress') return r.status === 'in_progress'
    if (filter === 'complete')    return r.status === 'complete'
    if (filter === 'flagged')     return r.flaggedLow
    return true
  })

  const grouped = activityEntries.reduce((acc, entry) => {
    const key = new Date(entry.created_at).toDateString()
    if (!acc[key]) acc[key] = []
    acc[key].push(entry)
    return acc
  }, {} as Record<string, ActivityEntry[]>)

  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading onboarding data...
      </div>
    )
  }

  const emptyMsg = getEmptyMessage(rows, filter)

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        {(['all', 'not_started', 'in_progress', 'complete', 'flagged'] as FilterType[]).map((f) => {
          const labels: Record<FilterType, string> = {
            all: 'All', not_started: 'Not Started', in_progress: 'In Progress',
            complete: 'Complete', flagged: 'Flagged',
          }
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '5px 14px',
                borderRadius: 'var(--radius-pill)',
                border: '1px solid',
                fontSize: 12,
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
                background: filter === f ? 'var(--accent-dim)' : 'transparent',
                borderColor: filter === f ? 'var(--accent-border)' : 'var(--border-default)',
                color: filter === f ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {labels[f]}
            </button>
          )
        })}
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {filtered.length} employee{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">{emptyMsg.title}</div>
            {emptyMsg.desc && <div className="empty-state-desc">{emptyMsg.desc}</div>}
          </div>
        ) : (
          <table className="data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col style={{ width: '15%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '26%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Status</th>
                <th>Availability</th>
                <th>Hrs/wk</th>
                <th>Email</th>
                <th>Role</th>
                <th>Time Off</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.employee.id}>
                  <td>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.employee.name}
                    </div>
                    {row.employee.primary_role && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.employee.primary_role}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      <StatusBadge status={row.status} />
                      {row.flaggedLow && <LowAvailBadge />}
                      {row.currentStep && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                          {row.currentStep}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    {row.availabilityFormatted ? (
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          {row.availabilityFormatted}
                        </div>
                        {row.availabilityRaw && row.availabilityRaw !== row.availabilityFormatted && (
                          <div style={{
                            fontSize: 10, color: 'var(--text-muted)',
                            marginTop: 3, lineHeight: 1.4, fontStyle: 'italic',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            &ldquo;{row.availabilityRaw}&rdquo;
                          </div>
                        )}
                      </div>
                    ) : row.availabilityRaw ? (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {row.availabilityRaw}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-disabled)', fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {row.weeklyHours != null
                      ? <span style={{ fontWeight: 500 }}>{row.weeklyHours}h</span>
                      : <span style={{ color: 'var(--text-disabled)' }}>—</span>}
                  </td>
                  <td><YesNo yes={row.emailCollected} /></td>
                  <td><YesNo yes={row.roleCollected} /></td>
                  <td><YesNo yes={row.timeOffSubmitted} /></td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {row.completedAt
                      ? <span>{formatDateTime(row.completedAt)}</span>
                      : <span style={{ color: 'var(--text-disabled)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Onboarding Activity Timeline */}
      {activityEntries.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <div style={{
            fontSize: 11,
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 16,
          }}>
            Onboarding Activity
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {Object.entries(grouped).map(([dateKey, dayEntries]) => (
              <div key={dateKey}>
                <div style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  marginBottom: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}>
                  {formatDateHeading(dayEntries[0].created_at)}
                  <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
                </div>

                <div style={{
                  background: 'var(--bg-surface-1)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-lg)',
                  overflow: 'hidden',
                }}>
                  {dayEntries.map((entry, i) => (
                    <div key={entry.id} style={{
                      display: 'flex',
                      gap: 14,
                      padding: '14px 16px',
                      borderBottom: i < dayEntries.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      alignItems: 'flex-start',
                    }}>
                      <div style={{
                        width: 30, height: 30,
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--accent-dim)',
                        border: '1px solid var(--accent-border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700,
                        fontFamily: 'var(--font-display)',
                        color: 'var(--accent)',
                        flexShrink: 0, marginTop: 1,
                      }}>
                        A
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          {entry.summary}
                        </div>
                        <div style={{
                          fontSize: 10, color: 'var(--text-muted)',
                          marginTop: 4, display: 'flex', gap: 6, alignItems: 'center',
                        }}>
                          <span style={{ color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>
                            Aegis
                          </span>
                          <span>·</span>
                          <span>{formatTime(entry.created_at)}</span>
                          <span>·</span>
                          <span>{timeAgo(entry.created_at)}</span>
                          <span>·</span>
                          <span style={{ color: 'var(--text-disabled)', fontFamily: 'var(--font-mono, monospace)', fontSize: 9 }}>
                            {entry.action}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
