'use client'
import { useCompany } from '@/lib/hooks/useCompany'
import { useQuria } from '@/lib/hooks/useQuria'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logActivity as logActivityFn } from '@/lib/activity'
import type { PartialDayDetail, ShiftOption } from '@/lib/types'

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

interface TORequest {
  id: string
  employee_id: string
  start_date: string
  end_date: string
  reason: string | null
  status: 'pending' | 'approved' | 'denied'
  requested_at: string
  decided_at: string | null
  aegis_recommendation: 'approve' | 'deny' | 'neutral' | null
  aegis_reasoning: string | null
  time_off_type: 'full_day' | 'partial' | null
  partial_days: PartialDayDetail[] | null
  employee: { name: string; primary_role: string } | null
}

function formatDate(d: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatShortDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

function datesBetween(start: string, end: string): string[] {
  if (!start || !end || start > end) return []
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const out: string[] = []
  const cur = new Date(sy, sm - 1, sd)
  const stop = new Date(ey, em - 1, ed)
  while (cur <= stop) {
    const yy = cur.getFullYear()
    const mm = String(cur.getMonth() + 1).padStart(2, '0')
    const dd = String(cur.getDate()).padStart(2, '0')
    out.push(`${yy}-${mm}-${dd}`)
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function describePartial(days: PartialDayDetail[] | null): string | null {
  if (!days || days.length === 0) return null
  if (days.length === 1) {
    const d = days[0]
    if (d.type === 'shift_off') return `Shift off: ${d.shift_name ?? '—'}`
    return `Partial: ${d.start_time ?? '—'}–${d.end_time ?? '—'}`
  }
  const first = days[0]
  const allSame = days.every(d =>
    d.type === first.type &&
    (d.shift_name ?? null) === (first.shift_name ?? null) &&
    (d.start_time ?? null) === (first.start_time ?? null) &&
    (d.end_time ?? null) === (first.end_time ?? null),
  )
  if (allSame) {
    if (first.type === 'shift_off') return `Shift off: ${first.shift_name ?? '—'}`
    return `Partial: ${first.start_time ?? '—'}–${first.end_time ?? '—'}`
  }
  return 'Partial (varies by day)'
}

function AegisBadge({ rec }: { rec: 'approve' | 'deny' | 'neutral' }) {
  const styles: Record<string, { bg: string; border: string; text: string; label: string }> = {
    approve: { bg: 'rgba(22,163,74,0.1)', border: 'rgba(22,163,74,0.25)', text: '#16a34a', label: 'Aegis: Approve' },
    deny:    { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.25)', text: '#ef4444', label: 'Aegis: Deny' },
    neutral: { bg: 'rgba(107,114,128,0.1)', border: 'rgba(107,114,128,0.25)', text: '#6b7280', label: 'Aegis: Neutral' },
  }
  const s = styles[rec]
  return (
    <span style={{
      padding: '2px 8px',
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: 'var(--radius-pill)',
      fontSize: 10,
      fontWeight: 700,
      color: s.text,
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

function ToggleGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (next: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map(opt => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1,
              padding: '7px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid',
              fontSize: 12,
              fontFamily: 'var(--font-body)',
              fontWeight: 500,
              cursor: 'pointer',
              background: active ? '#f97316' : 'transparent',
              borderColor: active ? '#f97316' : 'var(--border-default)',
              color: active ? '#ffffff' : 'var(--text-muted)',
              transition: 'background 120ms, border-color 120ms, color 120ms',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export default function TimeOffTab() {
  const { company, user } = useCompany()
  const { isQuria } = useQuria()
  const COMPANY_ID = company?.id ?? ''
  const [requests, setRequests] = useState<TORequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'denied'>('all')
  const [showForm, setShowForm] = useState(false)
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState({ employee_id: '', start_date: '', end_date: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ── Time-off mode + type ──────────────────────────────────────────────────
  const [toMode, setToMode] = useState<'single' | 'multi'>('single')
  const [toType, setToType] = useState<'full_day' | 'partial'>('full_day')
  const [partialMode, setPartialMode] = useState<'same_all' | 'per_day'>('same_all')

  // Global partial config (single, or multi same_all)
  const [globalPartialType, setGlobalPartialType] = useState<'shift_off' | 'custom_hours'>('shift_off')
  const [globalShiftId, setGlobalShiftId] = useState('')
  const [globalShiftName, setGlobalShiftName] = useState('')
  const [globalStartTime, setGlobalStartTime] = useState('')
  const [globalEndTime, setGlobalEndTime] = useState('')

  // Per-day partial config (multi per_day). Days not present here are treated
  // as full-day off within the range.
  const [perDayDetails, setPerDayDetails] = useState<Record<string, PartialDayDetail>>({})

  // Shift options cache keyed by date
  const [shiftOptions, setShiftOptions] = useState<Record<string, ShiftOption[]>>({})

  const supabase = createClient()

  useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    if (!COMPANY_ID) return
    setLoading(true)
    const [toRes, empRes] = await Promise.all([
      supabase
        .from('time_off_requests')
        .select('*, employee:employees(name, primary_role)')
        .eq('company_id', COMPANY_ID)
        .order('requested_at', { ascending: false }),
      supabase
        .from('employees')
        .select('id, name')
        .eq('company_id', COMPANY_ID)
        .eq('active', true)
        .order('name'),
    ])
    if (toRes.data) setRequests(toRes.data as TORequest[])
    if (empRes.data) setEmployees(empRes.data)
    setLoading(false)
  }

  async function logActivity(action: string, summary: string, entityId?: string) {
    await logActivityFn({
      supabase,
      company_id: COMPANY_ID,
      action,
      entity_type: 'time_off_request',
      entity_id: entityId,
      summary,
      isQuria,
      actorName: user?.name,
      actorAvatarUrl: user?.avatar_url,
    })
  }

  async function handleDecision(req: TORequest, decision: 'approved' | 'denied') {
    await supabase
      .from('time_off_requests')
      .update({ status: decision, decided_at: new Date().toISOString() })
      .eq('id', req.id)
    await logActivity(
      `time_off_${decision}`,
      `${decision.charAt(0).toUpperCase() + decision.slice(1)} time-off for ${req.employee?.name ?? 'employee'}: ${formatDate(req.start_date)} – ${formatDate(req.end_date)}`,
      req.id
    )
    fetchData()
  }

  async function handleDelete(req: TORequest) {
    await supabase.from('time_off_requests').delete().eq('id', req.id)
    await logActivity(
      'time_off_deleted',
      `Deleted time-off request for ${req.employee?.name ?? 'employee'}: ${formatDate(req.start_date)} – ${formatDate(req.end_date)}`,
      req.id
    )
    fetchData()
  }

  // ── Shift loader ─────────────────────────────────────────────────────────
  async function loadShiftsForDate(date: string, employeeId: string): Promise<ShiftOption[]> {
    if (!date || !employeeId || !COMPANY_ID) return []
    const dow = dayOfWeek(date)
    const { data: empRow } = await supabase
      .from('employees')
      .select('qualified_roles')
      .eq('id', employeeId)
      .single()
    const roles = (empRow as { qualified_roles?: string[] } | null)?.qualified_roles ?? []
    if (roles.length === 0) return []
    const { data } = await supabase
      .from('shift_requirements')
      .select('id, shift_name, start_time, end_time, role, days_active')
      .eq('company_id', COMPANY_ID)
      .in('role', roles)
      .contains('days_active', [dow])
    return (data as ShiftOption[] | null) ?? []
  }

  // Reset shift cache when the employee changes — shifts depend on qualified roles.
  useEffect(() => {
    setShiftOptions({})
  }, [form.employee_id])

  // Compute which dates need shift options loaded based on current selections.
  const datesNeedingShifts = useMemo(() => {
    if (!form.employee_id || toType !== 'partial') return [] as string[]
    if (toMode === 'single') {
      return form.start_date ? [form.start_date] : []
    }
    if (!form.start_date || !form.end_date) return []
    if (partialMode === 'same_all') return [form.start_date]
    return datesBetween(form.start_date, form.end_date)
  }, [form.employee_id, form.start_date, form.end_date, toType, toMode, partialMode])

  // Load shifts for any uncached dates.
  useEffect(() => {
    if (!form.employee_id) return
    const missing = datesNeedingShifts.filter(d => !(d in shiftOptions))
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      const results = await Promise.all(
        missing.map(async d => [d, await loadShiftsForDate(d, form.employee_id)] as const)
      )
      if (cancelled) return
      setShiftOptions(prev => {
        const next = { ...prev }
        for (const [d, shifts] of results) next[d] = shifts
        return next
      })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datesNeedingShifts.join('|'), form.employee_id])

  // Seed perDayDetails defaults whenever the date range or mode changes.
  useEffect(() => {
    if (toMode !== 'multi' || partialMode !== 'per_day') return
    if (!form.start_date || !form.end_date) return
    const dates = datesBetween(form.start_date, form.end_date)
    setPerDayDetails(prev => {
      const next: Record<string, PartialDayDetail> = {}
      for (const d of dates) {
        next[d] = prev[d] ?? { date: d, type: 'shift_off', shift_id: null, shift_name: null, start_time: null, end_time: null }
      }
      return next
    })
  }, [form.start_date, form.end_date, partialMode, toMode])

  function resetForm() {
    setForm({ employee_id: '', start_date: '', end_date: '', reason: '' })
    setToMode('single')
    setToType('full_day')
    setPartialMode('same_all')
    setGlobalPartialType('shift_off')
    setGlobalShiftId('')
    setGlobalShiftName('')
    setGlobalStartTime('')
    setGlobalEndTime('')
    setPerDayDetails({})
    setShiftOptions({})
    setError('')
  }

  function buildPartialDays(): PartialDayDetail[] | null {
    if (toType !== 'partial') return null

    const buildGlobal = (date: string): PartialDayDetail => ({
      date,
      type: globalPartialType,
      shift_id: globalPartialType === 'shift_off' ? (globalShiftId || null) : null,
      shift_name: globalPartialType === 'shift_off' ? (globalShiftName || null) : null,
      start_time: globalPartialType === 'custom_hours' ? (globalStartTime || null) : null,
      end_time: globalPartialType === 'custom_hours' ? (globalEndTime || null) : null,
    })

    if (toMode === 'single') {
      if (!form.start_date) return []
      return [buildGlobal(form.start_date)]
    }

    if (!form.start_date || !form.end_date) return []
    const dates = datesBetween(form.start_date, form.end_date)

    if (partialMode === 'same_all') {
      return dates.map(buildGlobal)
    }

    // per_day — keep only days the user actually set as partial
    return dates
      .map(d => perDayDetails[d])
      .filter((d): d is PartialDayDetail => !!d)
  }

  async function handleAdd() {
    if (!form.employee_id || !form.start_date) {
      setError('Employee and start date are required.')
      return
    }
    if (toMode === 'multi' && !form.end_date) {
      setError('End date is required for multi-day requests.')
      return
    }

    const effectiveEnd = toMode === 'single' ? form.start_date : form.end_date

    if (toMode === 'multi' && form.end_date < form.start_date) {
      setError('End date must be on or after the start date.')
      return
    }

    if (toType === 'partial') {
      if (toMode === 'single' || (toMode === 'multi' && partialMode === 'same_all')) {
        if (globalPartialType === 'shift_off' && !globalShiftId) {
          setError('Select a shift for the partial request.')
          return
        }
        if (globalPartialType === 'custom_hours' && (!globalStartTime || !globalEndTime)) {
          setError('Enter both a start and end time for the partial request.')
          return
        }
      }
      if (toMode === 'multi' && partialMode === 'per_day') {
        // Validate any per-day partial rows the user did opt into
        for (const d of Object.values(perDayDetails)) {
          if (d.type === 'shift_off' && !d.shift_id) {
            setError(`Select a shift for ${formatShortDate(d.date)}.`)
            return
          }
          if (d.type === 'custom_hours' && (!d.start_time || !d.end_time)) {
            setError(`Enter start and end times for ${formatShortDate(d.date)}.`)
            return
          }
        }
      }
    }

    setSaving(true)

    const partial_days = buildPartialDays()
    const time_off_type = toType

    const { data } = await supabase.from('time_off_requests').insert({
      company_id: COMPANY_ID,
      employee_id: form.employee_id,
      start_date: form.start_date,
      end_date: effectiveEnd,
      reason: form.reason || null,
      status: 'pending',
      time_off_type,
      partial_days,
    }).select().single()

    const emp = employees.find((e) => e.id === form.employee_id)
    if (data) await logActivity(
      'time_off_created',
      `Logged time-off request for ${emp?.name ?? 'employee'}: ${formatDate(form.start_date)} – ${formatDate(effectiveEnd)}${time_off_type === 'partial' ? ' (partial)' : ''}`,
      data.id
    )
    setSaving(false)
    setShowForm(false)
    resetForm()
    fetchData()
  }

  function updatePerDayRow(date: string, updater: (prev: PartialDayDetail | undefined) => PartialDayDetail | undefined) {
    setPerDayDetails(prev => {
      const next = { ...prev }
      const updated = updater(next[date])
      if (updated === undefined) {
        delete next[date]
      } else {
        next[date] = updated
      }
      return next
    })
  }

  const filtered = requests.filter((r) => filter === 'all' || r.status === filter)

  const counts = {
    pending:  requests.filter((r) => r.status === 'pending').length,
    approved: requests.filter((r) => r.status === 'approved').length,
    denied:   requests.filter((r) => r.status === 'denied').length,
  }

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading time-off requests...
    </div>
  )

  const globalShiftList = toMode === 'single'
    ? (shiftOptions[form.start_date] ?? [])
    : (shiftOptions[form.start_date] ?? [])

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        {(['all', 'pending', 'approved', 'denied'] as const).map((f) => (
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
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f !== 'all' && counts[f] > 0 && (
              <span style={{ marginLeft: 5, fontWeight: 600 }}>{counts[f]}</span>
            )}
          </button>
        ))}
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setShowForm(true) }}>
            + Log Request
          </button>
        </div>
      </div>

      <div style={{
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No requests</div>
            <div className="empty-state-desc">No time-off requests match this filter.</div>
          </div>
        ) : (
          filtered.map((req, i) => {
            const partialSummary = req.time_off_type === 'partial' ? describePartial(req.partial_days) : null
            return (
              <div key={req.id} style={{
                padding: '14px 16px',
                borderBottom: i < filtered.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}>
                {/* Main row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                      {req.employee?.name ?? 'Unknown'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {req.employee?.primary_role} · Requested {formatDate(req.requested_at)}
                    </div>
                    {partialSummary && (
                      <div style={{ fontSize: 11, color: '#f97316', marginTop: 4, fontWeight: 500 }}>
                        {partialSummary}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 160, flexShrink: 0 }}>
                    {formatDate(req.start_date)} – {formatDate(req.end_date)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1, minWidth: 0 }}>
                    {req.reason ?? '—'}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {req.aegis_recommendation && <AegisBadge rec={req.aegis_recommendation} />}
                    {req.status === 'pending' ? (
                      <>
                        <button
                          className="btn btn-sm"
                          onClick={() => handleDecision(req, 'approved')}
                          style={{
                            background: 'var(--status-ready-bg)',
                            color: 'var(--status-ready-text)',
                            border: '1px solid var(--status-ready-border)',
                          }}
                        >
                          Approve
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => handleDecision(req, 'denied')}
                          style={{
                            background: 'var(--status-blocked-bg)',
                            color: 'var(--status-blocked-text)',
                            border: '1px solid var(--status-blocked-border)',
                          }}
                        >
                          Deny
                        </button>
                      </>
                    ) : (
                      <span className={`badge ${req.status === 'approved' ? 'badge-ready' : 'badge-blocked'}`}>
                        {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                      </span>
                    )}
                    <button
                      onClick={() => handleDelete(req)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        padding: '4px',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title="Delete request"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>

                {/* Per-day partial detail list — only for multi requests with varied days */}
                {req.time_off_type === 'partial' && req.partial_days && req.partial_days.length > 1 && partialSummary === 'Partial (varies by day)' && (
                  <div style={{
                    marginTop: 10,
                    paddingLeft: 12,
                    borderLeft: '2px solid rgba(249,115,22,0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}>
                    {req.partial_days.map(d => (
                      <div key={d.date} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{formatShortDate(d.date)}:</span>{' '}
                        {d.type === 'shift_off'
                          ? `Shift off (${d.shift_name ?? '—'})`
                          : `Partial ${d.start_time ?? '—'}–${d.end_time ?? '—'}`}
                      </div>
                    ))}
                  </div>
                )}

                {/* Aegis reasoning block */}
                {req.aegis_reasoning && (
                  <div style={{
                    marginTop: 10,
                    paddingLeft: 12,
                    borderLeft: '2px solid rgba(99,102,241,0.3)',
                  }}>
                    <div style={{
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      fontWeight: 700,
                      marginBottom: 3,
                    }}>
                      Aegis Assessment
                    </div>
                    <div style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      fontStyle: 'italic',
                      lineHeight: 1.55,
                    }}>
                      {req.aegis_reasoning}
                    </div>
                    {partialSummary && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Reviewing: {partialSummary}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }}>
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-xl)',
            padding: 28,
            width: '100%',
            maxWidth: 560,
            maxHeight: '90vh',
            overflowY: 'auto',
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>
              Log Time-Off Request
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Employee</label>
                <select className="form-select" value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">Select employee...</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>

              {/* Single / Multi toggle */}
              <div className="form-group">
                <label className="form-label">Length</label>
                <ToggleGroup
                  value={toMode}
                  onChange={(v) => {
                    setToMode(v)
                    if (v === 'single') {
                      setPartialMode('same_all')
                    }
                  }}
                  options={[
                    { value: 'single', label: 'Single Day' },
                    { value: 'multi', label: 'Multiple Days' },
                  ]}
                />
              </div>

              {/* Date pickers */}
              {toMode === 'single' ? (
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input
                    className="form-input"
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value, end_date: e.target.value }))}
                  />
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Start Date</label>
                    <input className="form-input" type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">End Date</label>
                    <input className="form-input" type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
                  </div>
                </div>
              )}

              {/* Full / Partial toggle */}
              <div className="form-group">
                <label className="form-label">Type</label>
                <ToggleGroup
                  value={toType}
                  onChange={setToType}
                  options={[
                    { value: 'full_day', label: 'Full Day' },
                    { value: 'partial', label: 'Partial Day' },
                  ]}
                />
              </div>

              {/* Partial configuration */}
              {toType === 'partial' && (
                <div style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: 14,
                  background: 'var(--bg-surface-2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}>
                  {toMode === 'multi' && (
                    <ToggleGroup
                      value={partialMode}
                      onChange={setPartialMode}
                      options={[
                        { value: 'same_all', label: 'Same for all days' },
                        { value: 'per_day', label: 'Set per day' },
                      ]}
                    />
                  )}

                  {(toMode === 'single' || partialMode === 'same_all') && (
                    <>
                      <ToggleGroup
                        value={globalPartialType}
                        onChange={(v) => {
                          setGlobalPartialType(v)
                          if (v === 'shift_off') {
                            setGlobalStartTime('')
                            setGlobalEndTime('')
                          } else {
                            setGlobalShiftId('')
                            setGlobalShiftName('')
                          }
                        }}
                        options={[
                          { value: 'shift_off', label: 'By Shift' },
                          { value: 'custom_hours', label: 'Custom Hours' },
                        ]}
                      />

                      {globalPartialType === 'shift_off' ? (
                        <div className="form-group">
                          <label className="form-label">Select shift to miss</label>
                          <select
                            className="form-select"
                            value={globalShiftId}
                            onChange={(e) => {
                              const id = e.target.value
                              setGlobalShiftId(id)
                              const match = globalShiftList.find(s => s.id === id)
                              setGlobalShiftName(match?.shift_name ?? '')
                            }}
                            disabled={!form.employee_id || !form.start_date}
                          >
                            <option value="">
                              {!form.employee_id || !form.start_date
                                ? 'Select employee and date first…'
                                : globalShiftList.length === 0
                                  ? 'No matching shifts for this employee on that day'
                                  : 'Select shift…'}
                            </option>
                            {globalShiftList.map(s => (
                              <option key={s.id} value={s.id}>
                                {s.shift_name} ({s.start_time}–{s.end_time})
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div className="form-group">
                            <label className="form-label">From</label>
                            <input className="form-input" type="time" value={globalStartTime} onChange={(e) => setGlobalStartTime(e.target.value)} />
                          </div>
                          <div className="form-group">
                            <label className="form-label">To</label>
                            <input className="form-input" type="time" value={globalEndTime} onChange={(e) => setGlobalEndTime(e.target.value)} />
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {toMode === 'multi' && partialMode === 'per_day' && form.start_date && form.end_date && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {datesBetween(form.start_date, form.end_date).map(date => {
                        const detail = perDayDetails[date]
                        const rowType: 'full_day' | 'shift_off' | 'custom_hours' = detail ? detail.type : 'full_day'
                        const dateShifts = shiftOptions[date] ?? []

                        return (
                          <div key={date} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap',
                            background: 'var(--bg-surface-1)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-md)',
                            padding: '8px 10px',
                          }}>
                            <div style={{
                              minWidth: 110,
                              fontSize: 12,
                              fontWeight: 500,
                              color: 'var(--text-secondary)',
                            }}>
                              {formatShortDate(date)}
                            </div>
                            <select
                              className="form-select"
                              style={{ maxWidth: 140 }}
                              value={rowType}
                              onChange={(e) => {
                                const next = e.target.value as 'full_day' | 'shift_off' | 'custom_hours'
                                updatePerDayRow(date, () => {
                                  if (next === 'full_day') return undefined
                                  if (next === 'shift_off') {
                                    return { date, type: 'shift_off', shift_id: null, shift_name: null, start_time: null, end_time: null }
                                  }
                                  return { date, type: 'custom_hours', shift_id: null, shift_name: null, start_time: null, end_time: null }
                                })
                              }}
                            >
                              <option value="full_day">Full Day</option>
                              <option value="shift_off">By Shift</option>
                              <option value="custom_hours">Custom Hours</option>
                            </select>

                            {rowType === 'shift_off' && (
                              <select
                                className="form-select"
                                style={{ flex: 1, minWidth: 180 }}
                                value={detail?.shift_id ?? ''}
                                onChange={(e) => {
                                  const id = e.target.value
                                  const match = dateShifts.find(s => s.id === id)
                                  updatePerDayRow(date, prev => prev
                                    ? { ...prev, shift_id: id || null, shift_name: match?.shift_name ?? null }
                                    : prev,
                                  )
                                }}
                              >
                                <option value="">
                                  {dateShifts.length === 0
                                    ? 'No matching shifts on this day'
                                    : 'Select shift…'}
                                </option>
                                {dateShifts.map(s => (
                                  <option key={s.id} value={s.id}>
                                    {s.shift_name} ({s.start_time}–{s.end_time})
                                  </option>
                                ))}
                              </select>
                            )}

                            {rowType === 'custom_hours' && (
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1, minWidth: 200 }}>
                                <input
                                  className="form-input"
                                  type="time"
                                  style={{ width: 110 }}
                                  value={detail?.start_time ?? ''}
                                  onChange={(e) => updatePerDayRow(date, prev => prev
                                    ? { ...prev, start_time: e.target.value || null }
                                    : prev,
                                  )}
                                />
                                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
                                <input
                                  className="form-input"
                                  type="time"
                                  style={{ width: 110 }}
                                  value={detail?.end_time ?? ''}
                                  onChange={(e) => updatePerDayRow(date, prev => prev
                                    ? { ...prev, end_time: e.target.value || null }
                                    : prev,
                                  )}
                                />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Reason <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <input className="form-input" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Personal, medical, vacation..." />
              </div>
            </div>

            {error && <div style={{ fontSize: 12, color: 'var(--status-blocked-text)', marginTop: 12 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => { setShowForm(false); resetForm() }}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving}>
                {saving ? 'Saving...' : 'Log Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
