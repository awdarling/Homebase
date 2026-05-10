'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Schedule, ScheduleGap, ScheduleAssignment } from '@/lib/types'

interface Candidate {
  id: string
  name: string
  primary_role: string
  qualified_roles: string[]
  contact_phone: string | null
  hoursThisWeek: number
  hasTimeOff: boolean
}

interface GapResolverPanelProps {
  gap: ScheduleGap
  schedule: Schedule
  companyId: string
  onClose: () => void
  onResolved: (updatedSchedule: Schedule) => void
}

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

export default function GapResolverPanel({
  gap, schedule, companyId, onClose, onResolved,
}: GapResolverPanelProps) {
  const supabase = createClient()
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [shiftTimes, setShiftTimes] = useState({ start_time: '09:00', end_time: '17:00' })
  const [loading, setLoading] = useState(true)
  const [noReason, setNoReason] = useState('')
  const [confirmCandidate, setConfirmCandidate] = useState<Candidate | null>(null)
  const [assigning, setAssigning] = useState(false)

  const [y, mo, d] = gap.date.split('-').map(Number)
  const gapDayOfWeek = new Date(y, mo - 1, d).getDay()

  useEffect(() => { loadCandidates() }, [])

  async function loadCandidates() {
    setLoading(true)

    const [empRes, availRes, toRes, shiftRes] = await Promise.all([
      supabase
        .from('employees')
        .select('id, name, primary_role, qualified_roles, contact_phone')
        .eq('company_id', companyId)
        .eq('active', true),
      supabase
        .from('availability')
        .select('employee_id, day_of_week')
        .eq('company_id', companyId),
      supabase
        .from('time_off_requests')
        .select('employee_id')
        .eq('company_id', companyId)
        .eq('status', 'approved')
        .lte('start_date', gap.date)
        .gte('end_date', gap.date),
      supabase
        .from('shift_requirements')
        .select('start_time, end_time')
        .eq('company_id', companyId)
        .eq('shift_name', gap.shift_name)
        .eq('role', gap.role)
        .limit(1)
        .maybeSingle(),
    ])

    if (shiftRes.data) {
      setShiftTimes({ start_time: shiftRes.data.start_time, end_time: shiftRes.data.end_time })
    }

    const allEmployees = (empRes.data ?? []) as {
      id: string; name: string; primary_role: string
      qualified_roles: string[]; contact_phone: string | null
    }[]
    const availability = (availRes.data ?? []) as { employee_id: string; day_of_week: number }[]
    const timeOffSet = new Set((toRes.data ?? []).map((t: { employee_id: string }) => t.employee_id))

    // Filter: qualified for role
    const qualified = allEmployees.filter(emp =>
      emp.primary_role === gap.role || (emp.qualified_roles ?? []).includes(gap.role)
    )

    // Filter: available on this day
    const available = qualified.filter(emp =>
      availability.some(a => a.employee_id === emp.id && a.day_of_week === gapDayOfWeek)
    )

    // Filter: not already assigned to this exact shift+date
    const assignments = schedule.data?.assignments ?? []
    const alreadyAssigned = new Set(
      assignments
        .filter(a => a.shift_name === gap.shift_name && a.date === gap.date)
        .map(a => a.employee_id)
    )
    const candidateList = available.filter(emp => !alreadyAssigned.has(emp.id))

    // Compute hours this week
    const hoursMap = new Map<string, number>()
    for (const a of assignments) {
      hoursMap.set(a.employee_id, (hoursMap.get(a.employee_id) ?? 0) + a.hours)
    }

    setCandidates(candidateList.map(emp => ({
      id: emp.id,
      name: emp.name,
      primary_role: emp.primary_role,
      qualified_roles: emp.qualified_roles ?? [],
      contact_phone: emp.contact_phone,
      hoursThisWeek: hoursMap.get(emp.id) ?? 0,
      hasTimeOff: timeOffSet.has(emp.id),
    })))

    if (candidateList.length === 0) {
      if (qualified.length === 0)
        setNoReason('No employees are qualified for this role.')
      else if (available.length === 0)
        setNoReason('No qualified employees are available on this day of week.')
      else
        setNoReason('All qualified available employees are already assigned to this shift.')
    }

    setLoading(false)
  }

  async function handleAssign(candidate: Candidate) {
    setAssigning(true)
    const { start_time, end_time } = shiftTimes
    const hours = computeHours(start_time, end_time)

    const newAssignment: ScheduleAssignment = {
      date: gap.date,
      employee_id: candidate.id,
      employee_name: candidate.name,
      shift_name: gap.shift_name,
      role: gap.role,
      start_time,
      end_time,
      hours,
    }

    // Update gaps: increment filled_count on matching gap, drop if fully filled
    const updatedGaps = (schedule.data?.gaps ?? [])
      .map(g =>
        g.shift_name === gap.shift_name && g.date === gap.date && g.role === gap.role
          ? { ...g, filled_count: g.filled_count + 1 }
          : g
      )
      .filter(g => g.filled_count < g.required_count)

    const updatedAssignments = [...(schedule.data?.assignments ?? []), newAssignment]

    // Recompute coverage_rate
    let updatedReport = schedule.staffing_report
    if (updatedReport) {
      const oldGaps = schedule.data?.gaps ?? []
      const oldUnfilled = oldGaps.reduce((s, g) => s + Math.max(0, g.required_count - g.filled_count), 0)
      const newUnfilled = updatedGaps.reduce((s, g) => s + Math.max(0, g.required_count - g.filled_count), 0)

      let newRate = updatedReport.coverage_rate
      if (oldUnfilled > newUnfilled && updatedReport.coverage_rate < 100) {
        const frac = updatedReport.coverage_rate / 100
        const totalRequired = frac < 1 && oldUnfilled > 0
          ? Math.round(oldUnfilled / (1 - frac))
          : updatedAssignments.length + newUnfilled
        const newFilled = totalRequired - newUnfilled
        newRate = Math.min(100, Math.round((newFilled / totalRequired) * 100))
      }

      const existing = updatedReport.top_contributors.find(c => c.employee_id === candidate.id)
      const newTopContributors = existing
        ? updatedReport.top_contributors.map(c =>
          c.employee_id === candidate.id ? { ...c, hours: c.hours + hours } : c
        )
        : [...updatedReport.top_contributors, { employee_id: candidate.id, name: candidate.name, hours }]
          .sort((a, b) => b.hours - a.hours)

      updatedReport = { ...updatedReport, coverage_rate: newRate, top_contributors: newTopContributors }
    }

    const updatedData = { ...(schedule.data ?? { assignments: [], gaps: [], summary: '' }), assignments: updatedAssignments, gaps: updatedGaps }

    const { data: saved } = await supabase
      .from('schedules')
      .update({ data: updatedData, staffing_report: updatedReport })
      .eq('id', schedule.id)
      .select()
      .single()

    await supabase.from('activity_log').insert({
      company_id: companyId,
      actor: 'manager',
      action: 'gap_resolved_manually',
      entity_type: 'schedule',
      entity_id: schedule.id,
      summary: `Manager assigned ${candidate.name} to ${gap.shift_name} (${gap.role}) on ${gap.date}`,
      metadata: { employee_id: candidate.id, shift_name: gap.shift_name, role: gap.role, date: gap.date },
    })

    // Trigger SMS (non-fatal)
    fetch('/api/notify-assignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: candidate.id,
        shift_name: gap.shift_name,
        role: gap.role,
        date: gap.date,
        start_time,
        end_time,
        company_id: companyId,
      }),
    }).catch(() => {})

    setAssigning(false)
    onResolved((saved as Schedule) ?? { ...schedule, data: updatedData, staffing_report: updatedReport })
  }

  const unfilled = gap.required_count - gap.filled_count

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 900 }}
        onClick={onClose}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed',
        top: 0, right: 0, bottom: 0,
        width: 480,
        maxWidth: '100vw',
        background: 'var(--bg-surface-1)',
        borderLeft: '1px solid var(--border-default)',
        zIndex: 901,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
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
            <button
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: '0 4px' }}
            >
              ×
            </button>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{
              padding: '2px 10px',
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 'var(--radius-pill)',
              fontSize: 11,
              fontWeight: 600,
              color: '#ef4444',
            }}>
              {unfilled} unfilled
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {gap.filled_count}/{gap.required_count} filled
            </span>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Finding available employees...
            </div>
          ) : candidates.length === 0 ? (
            <div style={{
              padding: '28px 20px',
              textAlign: 'center',
              background: 'var(--bg-surface-2)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-default)',
            }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>
                No candidates available
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>{noReason}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                {candidates.length} {candidates.length === 1 ? 'Employee' : 'Employees'} Available
              </div>
              {candidates.map(c => (
                <div key={c.id} style={{
                  background: 'var(--bg-surface-2)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span>{c.hoursThisWeek}h this week</span>
                      {c.hasTimeOff && (
                        <span style={{ color: '#ef4444', fontWeight: 500 }}>
                          ⚠ Approved time off this day
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => setConfirmCandidate(c)}
                    style={{ flexShrink: 0 }}
                  >
                    Assign
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation dialog */}
      {confirmCandidate && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1100,
          background: 'rgba(0,0,0,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}>
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-xl)',
            padding: 28,
            maxWidth: 440,
            width: '100%',
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
              Confirm Assignment
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 24 }}>
              Assign <strong style={{ color: 'var(--text-primary)' }}>{confirmCandidate.name}</strong> to{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{gap.shift_name}</strong>{' '}
              ({gap.role}) on{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{formatGapDate(gap.date)}</strong>?
              {' '}This will update the schedule and notify them via Aegis.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmCandidate(null)}
                disabled={assigning}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={assigning}
                onClick={() => {
                  const c = confirmCandidate
                  setConfirmCandidate(null)
                  handleAssign(c)
                }}
              >
                {assigning ? 'Assigning...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
