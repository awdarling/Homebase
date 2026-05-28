'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Schedule, ScheduleGap, ScheduleAssignment } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Candidate {
  id: string
  name: string
  primary_role: string
  qualified_roles: string[]
  contact_phone: string | null
  hoursThisWeek: number
  hasTimeOff: boolean
}

interface PendingAssignment {
  employee_id: string
  employee_name: string
  role: string
  contact_phone: string | null
}

interface SoteraResult {
  valid: boolean
  issues: string[]
  suggestions: string[]
  summary: string
}

interface GapResolverPanelProps {
  gap: ScheduleGap
  schedule: Schedule
  companyId: string
  onClose: () => void
  onResolved: (updatedSchedule: Schedule) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatGapDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function computeHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GapResolverPanel({
  gap, schedule, companyId, onClose, onResolved,
}: GapResolverPanelProps) {
  const supabase = createClient()

  // Candidate list state
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [shiftTimes, setShiftTimes] = useState({ start_time: '09:00', end_time: '17:00' })
  const [loading, setLoading] = useState(true)
  const [noReason, setNoReason] = useState('')

  // All employees for custom search
  const [allEmployees, setAllEmployees] = useState<{ id: string; name: string }[]>([])
  const [allRoles, setAllRoles] = useState<string[]>([])

  // Custom assignment state
  const [customSearch, setCustomSearch] = useState('')
  const [customEmployee, setCustomEmployee] = useState<{ id: string; name: string } | null>(null)
  const [customRole, setCustomRole] = useState(gap.role)
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  // Soteria state
  const [soteraPhase, setSoteraPhase] = useState<'idle' | 'validating' | 'result'>('idle')
  const [soteraResult, setSoteraResult] = useState<SoteraResult | null>(null)
  const [pendingAssignment, setPendingAssignment] = useState<PendingAssignment | null>(null)
  const [assigning, setAssigning] = useState(false)

  const [y, mo, d] = gap.date.split('-').map(Number)
  const gapDayOfWeek = new Date(y, mo - 1, d).getDay()
  const unfilled = gap.required_count - gap.filled_count

  useEffect(() => { loadData() }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function loadData() {
    setLoading(true)

    const [empRes, availRes, toRes, shiftRes, rolesRes] = await Promise.all([
      supabase.from('employees').select('id, name, primary_role, qualified_roles, contact_phone').eq('company_id', companyId).eq('active', true),
      supabase.from('availability').select('employee_id, day_of_week').eq('company_id', companyId),
      supabase.from('time_off_requests').select('employee_id').eq('company_id', companyId).eq('status', 'approved').lte('start_date', gap.date).gte('end_date', gap.date),
      supabase.from('shift_requirements').select('start_time, end_time').eq('company_id', companyId).eq('shift_name', gap.shift_name).eq('role', gap.role).limit(1).maybeSingle(),
      supabase.from('roles').select('name').eq('company_id', companyId).order('name'),
    ])

    if (shiftRes.data) setShiftTimes({ start_time: shiftRes.data.start_time, end_time: shiftRes.data.end_time })

    const employees = (empRes.data ?? []) as { id: string; name: string; primary_role: string; qualified_roles: string[]; contact_phone: string | null }[]
    const availability = (availRes.data ?? []) as { employee_id: string; day_of_week: number }[]
    const timeOffSet = new Set((toRes.data ?? []).map((t: { employee_id: string }) => t.employee_id))

    setAllEmployees(employees.map(e => ({ id: e.id, name: e.name })))
    setAllRoles((rolesRes.data ?? []).map((r: { name: string }) => r.name))

    const qualified = employees.filter(emp =>
      emp.primary_role === gap.role || (emp.qualified_roles ?? []).includes(gap.role)
    )
    const available = qualified.filter(emp =>
      availability.some(a => a.employee_id === emp.id && a.day_of_week === gapDayOfWeek)
    )
    const assignments = schedule.data?.assignments ?? []
    const alreadyAssigned = new Set(
      assignments.filter(a => a.shift_name === gap.shift_name && a.date === gap.date).map(a => a.employee_id)
    )
    const candidateList = available.filter(emp => !alreadyAssigned.has(emp.id))

    const hoursMap = new Map<string, number>()
    for (const a of assignments) hoursMap.set(a.employee_id, (hoursMap.get(a.employee_id) ?? 0) + a.hours)

    setCandidates(candidateList.map(emp => ({
      id: emp.id, name: emp.name,
      primary_role: emp.primary_role, qualified_roles: emp.qualified_roles ?? [],
      contact_phone: emp.contact_phone,
      hoursThisWeek: hoursMap.get(emp.id) ?? 0,
      hasTimeOff: timeOffSet.has(emp.id),
    })))

    if (candidateList.length === 0) {
      if (qualified.length === 0) setNoReason('No employees are qualified for this role.')
      else if (available.length === 0) setNoReason('No qualified employees are available on this day of week.')
      else setNoReason('All qualified available employees are already assigned to this shift.')
    }

    setLoading(false)
  }

  // ── Soteria validation ────────────────────────────────────────────────────

  async function triggerSoteria(assignment: PendingAssignment) {
    setPendingAssignment(assignment)
    setSoteraPhase('validating')
    setSoteraResult(null)

    try {
      const res = await fetch('/api/soteria-validate-assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          schedule_id: schedule.id,
          employee_id: assignment.employee_id,
          employee_name: assignment.employee_name,
          role_override: assignment.role,
          shift_name: gap.shift_name,
          date: gap.date,
          start_time: shiftTimes.start_time,
          end_time: shiftTimes.end_time,
        }),
      })
      const result = await res.json() as SoteraResult
      setSoteraResult(result)
    } catch {
      setSoteraResult({ valid: true, issues: [], suggestions: [], summary: 'Soteria could not be reached. Proceeding with manual review.' })
    }

    setSoteraPhase('result')
  }

  // ── DB write ──────────────────────────────────────────────────────────────

  async function handleAssign(assignment: PendingAssignment) {
    setAssigning(true)
    const { start_time, end_time } = shiftTimes
    const hours = computeHours(start_time, end_time)

    const newAssignment: ScheduleAssignment = {
      date: gap.date,
      employee_id: assignment.employee_id,
      employee_name: assignment.employee_name,
      shift_name: gap.shift_name,
      role: assignment.role,
      start_time,
      end_time,
      hours,
    }

    const updatedGaps = (schedule.data?.gaps ?? [])
      .map(g => g.shift_name === gap.shift_name && g.date === gap.date && g.role === gap.role
        ? { ...g, filled_count: g.filled_count + 1 } : g)
      .filter(g => g.filled_count < g.required_count)

    const updatedAssignments = [...(schedule.data?.assignments ?? []), newAssignment]

    const updatedData = { ...(schedule.data ?? { assignments: [], gaps: [], summary: '' }), assignments: updatedAssignments, gaps: updatedGaps }

    const { data: saved } = await supabase.from('schedules')
      .update({ data: updatedData })
      .eq('id', schedule.id).select().single()

    fetch('/api/notify-assignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: assignment.employee_id, shift_name: gap.shift_name, role: assignment.role, date: gap.date, start_time, end_time, company_id: companyId }),
    }).catch(() => {})

    setAssigning(false)
    onResolved((saved as Schedule) ?? { ...schedule, data: updatedData })
  }

  // ── Search filtering ──────────────────────────────────────────────────────

  const filteredSearch = customSearch.trim().length > 0
    ? allEmployees.filter(e => e.name.toLowerCase().includes(customSearch.toLowerCase())).slice(0, 8)
    : []

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 900 }} onClick={onClose} />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 500, maxWidth: '100vw',
        background: 'var(--bg-surface-1)',
        borderLeft: '1px solid var(--border-default)',
        zIndex: 901,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.2)',
      }}>

        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                Fill Gap
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                {gap.shift_name} · {gap.role} · {formatGapDate(gap.date)}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ padding: '2px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-pill)', fontSize: 11, fontWeight: 600, color: '#ef4444' }}>
              {unfilled} unfilled
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{gap.filled_count}/{gap.required_count} filled</span>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* ── Soteria overlay ── */}
          {soteraPhase !== 'idle' && (
            <div style={{ marginBottom: 20 }}>
              {soteraPhase === 'validating' ? (
                <div style={{ padding: '20px 16px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Soteria is reviewing this assignment...</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Checking qualifications, availability, policies</div>
                </div>
              ) : soteraResult && (
                <div style={{
                  padding: '16px',
                  background: soteraResult.valid ? 'rgba(22,163,74,0.07)' : 'rgba(234,179,8,0.07)',
                  border: `1px solid ${soteraResult.valid ? 'rgba(22,163,74,0.25)' : 'rgba(234,179,8,0.3)'}`,
                  borderRadius: 'var(--radius-lg)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: soteraResult.issues.length > 0 ? 10 : 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: soteraResult.valid ? '#16a34a' : '#ca8a04' }}>
                      {soteraResult.valid ? '✓ Soteria:' : '⚠ Soteria found issues:'}
                    </span>
                  </div>
                  {soteraResult.issues.length > 0 && (
                    <ul style={{ margin: '0 0 10px', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {soteraResult.issues.map((issue, i) => (
                        <li key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{issue}</li>
                      ))}
                    </ul>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 14 }}>
                    {soteraResult.summary}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setSoteraPhase('idle'); setSoteraResult(null); setPendingAssignment(null) }} disabled={assigning}>
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={assigning}
                      onClick={() => pendingAssignment && handleAssign(pendingAssignment)}
                    >
                      {assigning ? 'Assigning...' : soteraResult.valid ? 'Confirm Assignment' : 'Proceed Anyway'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Candidate list ── */}
          {loading ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Finding available employees...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {candidates.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-default)' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>No candidates available</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>{noReason}</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
                    {candidates.length} {candidates.length === 1 ? 'Employee' : 'Employees'} Available
                  </div>
                  {candidates.map(c => (
                    <div key={c.id} style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <span>{c.hoursThisWeek}h this week</span>
                          {c.hasTimeOff && <span style={{ color: '#ef4444', fontWeight: 500 }}>⚠ Time off this day</span>}
                        </div>
                      </div>
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={soteraPhase !== 'idle'}
                        onClick={() => triggerSoteria({ employee_id: c.id, employee_name: c.name, role: gap.role, contact_phone: c.contact_phone })}
                        style={{ flexShrink: 0 }}
                      >
                        Assign
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* ── Divider ── */}
          {!loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0 16px' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Or enter a custom assignment</div>
              <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
            </div>
          )}

          {/* ── Custom assignment ── */}
          {!loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Employee search */}
              <div ref={searchRef} style={{ position: 'relative' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Employee name</label>
                  <input
                    className="form-input"
                    placeholder="Employee name..."
                    value={customEmployee ? customEmployee.name : customSearch}
                    onChange={e => {
                      setCustomSearch(e.target.value)
                      setCustomEmployee(null)
                      setShowDropdown(true)
                    }}
                    onFocus={() => setShowDropdown(true)}
                  />
                </div>
                {showDropdown && filteredSearch.length > 0 && !customEmployee && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                    background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)', boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                    maxHeight: 200, overflowY: 'auto',
                  }}>
                    {filteredSearch.map(emp => (
                      <div
                        key={emp.id}
                        onClick={() => { setCustomEmployee(emp); setCustomSearch(''); setShowDropdown(false) }}
                        style={{ padding: '9px 14px', fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface-2)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        {emp.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Role override */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Assigning as</label>
                <select className="form-select" value={customRole} onChange={e => setCustomRole(e.target.value)}>
                  {(allRoles.length > 0 ? allRoles : [gap.role]).map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              {/* Submit */}
              <button
                className="btn btn-secondary btn-sm"
                disabled={!customEmployee || soteraPhase !== 'idle'}
                onClick={() => customEmployee && triggerSoteria({ employee_id: customEmployee.id, employee_name: customEmployee.name, role: customRole, contact_phone: null })}
                style={{ alignSelf: 'flex-start' }}
              >
                Add to Schedule
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
