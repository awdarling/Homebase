'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Schedule, ScheduleAssignment, StaffingReport } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScheduleChange =
  | {
      kind: 'moved'
      employee_id: string
      employee_name: string
      from: { shift_name: string; date: string; role: string }
      to: { shift_name: string; date: string; role: string }
    }
  | {
      kind: 'added'
      employee_id: string
      employee_name: string
      to: { shift_name: string; date: string; role: string }
    }
  | {
      kind: 'removed'
      employee_id: string
      employee_name: string
      from: { shift_name: string; date: string; role: string }
    }

interface SoteraIssue {
  severity: 'error' | 'warning'
  employee_name: string
  description: string
  suggestion: string | null
}

interface SoteriaResult {
  issues: SoteraIssue[]
  summary: string
  approved: boolean
}

interface ScheduleReviewPanelProps {
  schedule: Schedule
  companyId: string
  changes: ScheduleChange[]
  originalAssignments: ScheduleAssignment[]
  pendingAssignments: ScheduleAssignment[]
  onClose: () => void
  onSaved: (updated: Schedule) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function describeChange(c: ScheduleChange): string {
  if (c.kind === 'moved') {
    return `${c.employee_name} moved from ${c.from.shift_name} ${formatDate(c.from.date)} → ${c.to.shift_name} ${formatDate(c.to.date)}`
  }
  if (c.kind === 'added') {
    return `${c.employee_name} added to ${c.to.shift_name} on ${formatDate(c.to.date)}`
  }
  return `${c.employee_name} removed from ${c.from.shift_name} on ${c.from.date}`
}

function changeBadge(kind: ScheduleChange['kind']): { label: string; color: string; bg: string; border: string } {
  if (kind === 'moved') return { label: 'MOVED', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.25)' }
  if (kind === 'added') return { label: 'ADDED', color: '#16a34a', bg: 'rgba(22,163,74,0.1)', border: 'rgba(22,163,74,0.25)' }
  return { label: 'REMOVED', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.25)' }
}

async function recomputeStaffingReport(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  pending: ScheduleAssignment[],
  original: ScheduleAssignment[],
  prevReport: StaffingReport | null,
  remainingGapsUnfilled: number,
): Promise<StaffingReport> {
  const [empRes, wageRes] = await Promise.all([
    supabase.from('employees').select('id, name, primary_role, max_weekly_hours, individual_wage').eq('company_id', companyId).eq('active', true),
    supabase.from('wage_rates').select('role, hourly_rate').eq('company_id', companyId),
  ])

  const employees = (empRes.data ?? []) as { id: string; name: string; primary_role: string; max_weekly_hours: number; individual_wage: number | null }[]
  const wageRates = (wageRes.data ?? []) as { role: string; hourly_rate: number }[]
  const wageByRole = new Map(wageRates.map(w => [w.role, w.hourly_rate]))

  // Hours per employee
  const hoursById: Record<string, number> = {}
  for (const a of pending) hoursById[a.employee_id] = (hoursById[a.employee_id] ?? 0) + (a.hours ?? 0)

  // Top + bottom contributors over all active employees
  const allRows = employees.map(e => ({
    employee_id: e.id,
    name: e.name,
    hours: Math.round((hoursById[e.id] ?? 0) * 10) / 10,
  }))
  const top_contributors = [...allRows].sort((a, b) => b.hours - a.hours).slice(0, 5)
  const bottom_contributors = [...allRows].sort((a, b) => a.hours - b.hours).slice(0, 3)

  // Estimated wages
  const empById = new Map(employees.map(e => [e.id, e]))
  const wagesByEmployee: Record<string, { hours: number; pay: number; rate: number; role: string }> = {}
  for (const a of pending) {
    const emp = empById.get(a.employee_id)
    const rate = emp?.individual_wage ?? wageByRole.get(a.role) ?? 0
    const w = wagesByEmployee[a.employee_id] ?? { hours: 0, pay: 0, rate, role: a.role }
    w.hours += a.hours ?? 0
    w.pay += (a.hours ?? 0) * rate
    w.rate = rate
    w.role = a.role
    wagesByEmployee[a.employee_id] = w
  }
  const by_employee = Object.entries(wagesByEmployee).map(([id, w]) => ({
    employee_id: id,
    employee_name: empById.get(id)?.name ?? 'Unknown',
    hours: parseFloat(w.hours.toFixed(2)),
    hourly_rate: w.rate,
    estimated_pay: parseFloat(w.pay.toFixed(2)),
  })).sort((a, b) => b.estimated_pay - a.estimated_pay)
  const total_estimated = parseFloat(by_employee.reduce((s, e) => s + e.estimated_pay, 0).toFixed(2))

  // Coverage rate — keep filled vs (filled + remaining unfilled gaps)
  const filled = pending.length
  const totalSlots = filled + remainingGapsUnfilled
  const coverage_rate = totalSlots > 0 ? Math.round((filled / totalSlots) * 100) : 100

  // Overtime risk
  const overtime_risk = allRows
    .filter(r => r.hours > 36)
    .map(r => {
      const emp = empById.get(r.employee_id)
      return {
        employee_id: r.employee_id,
        name: r.name,
        hours: r.hours,
        max_hours: emp?.max_weekly_hours ?? 40,
      }
    })

  void original
  return {
    coverage_rate,
    top_contributors,
    bottom_contributors,
    overtime_risk,
    gap_summary: prevReport?.gap_summary ?? '',
    special_notes_applied: prevReport?.special_notes_applied ?? [],
    aegis_notes: prevReport?.aegis_notes ?? '',
    estimated_wages: { total_estimated, by_employee },
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScheduleReviewPanel({
  schedule,
  companyId,
  changes,
  originalAssignments,
  pendingAssignments,
  onClose,
  onSaved,
}: ScheduleReviewPanelProps) {
  const supabase = createClient()

  const [phase, setPhase] = useState<'idle' | 'validating' | 'reviewed' | 'saving'>('idle')
  const [result, setResult] = useState<SoteriaResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const errors = result?.issues.filter(i => i.severity === 'error') ?? []
  const warnings = result?.issues.filter(i => i.severity === 'warning') ?? []

  async function runSoteriaCheck() {
    setPhase('validating')
    setResult(null)
    setError(null)
    try {
      const res = await fetch('/api/soteria-validate-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          schedule_id: schedule.id,
          original_assignments: originalAssignments,
          proposed_assignments: pendingAssignments,
          changes,
        }),
      })
      if (!res.ok) throw new Error(`Soteria validation failed (${res.status})`)
      const data = await res.json() as SoteriaResult
      setResult({
        issues: Array.isArray(data.issues) ? data.issues : [],
        summary: data.summary ?? 'Soteria reviewed the changes.',
        approved: typeof data.approved === 'boolean' ? data.approved : true,
      })
      setPhase('reviewed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach Soteria')
      setPhase('idle')
    }
  }

  async function save() {
    setPhase('saving')
    setError(null)
    try {
      const remainingUnfilled = (schedule.data?.gaps ?? []).reduce(
        (s, g) => s + Math.max(0, g.required_count - g.filled_count), 0,
      )
      const newReport = await recomputeStaffingReport(
        supabase, companyId, pendingAssignments, originalAssignments, schedule.staffing_report, remainingUnfilled,
      )
      const newData = {
        ...(schedule.data ?? { assignments: [], gaps: [], summary: '' }),
        assignments: pendingAssignments,
      }

      const { data: saved, error: updateErr } = await supabase
        .from('schedules')
        .update({ data: newData, staffing_report: newReport })
        .eq('id', schedule.id)
        .select()
        .single()
      if (updateErr) throw updateErr

      onSaved((saved as Schedule) ?? { ...schedule, data: newData, staffing_report: newReport })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setPhase('reviewed')
    }
  }

  const canSave = phase === 'reviewed' && result && errors.length === 0
  const saveLabel = phase === 'saving'
    ? 'Saving...'
    : warnings.length > 0 && errors.length === 0
      ? 'Save Anyway'
      : 'Save Changes'

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 900 }} onClick={onClose} />

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
                Soteria Review
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                {changes.length} change{changes.length === 1 ? '' : 's'} pending
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Diff list */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Changes
            </div>
            {changes.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No changes to review.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {changes.map((c, i) => {
                  const b = changeBadge(c.kind)
                  return (
                    <div key={i} style={{
                      background: 'var(--bg-surface-2)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                    }}>
                      <span style={{
                        padding: '2px 7px',
                        borderRadius: 'var(--radius-pill)',
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        color: b.color,
                        background: b.bg,
                        border: `1px solid ${b.border}`,
                        flexShrink: 0,
                        marginTop: 1,
                      }}>{b.label}</span>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {describeChange(c)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Soteria action */}
          {phase === 'idle' && (
            <button
              className="btn btn-primary btn-sm"
              onClick={runSoteriaCheck}
              disabled={changes.length === 0}
              style={{ alignSelf: 'flex-start' }}
            >
              Run Soteria Check
            </button>
          )}

          {phase === 'validating' && (
            <div style={{
              padding: '20px 16px',
              background: 'var(--bg-surface-2)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
                Soteria is reviewing {changes.length} change{changes.length === 1 ? '' : 's'}...
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Checking qualifications, conflicts, time off, and policies
              </div>
            </div>
          )}

          {error && (
            <div style={{
              padding: '12px 14px',
              background: 'rgba(239,68,68,0.06)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
              color: '#ef4444',
            }}>
              {error}
            </div>
          )}

          {(phase === 'reviewed' || phase === 'saving') && result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{
                padding: '14px 16px',
                background: result.approved ? 'rgba(22,163,74,0.07)' : 'rgba(239,68,68,0.07)',
                border: `1px solid ${result.approved ? 'rgba(22,163,74,0.3)' : 'rgba(239,68,68,0.3)'}`,
                borderRadius: 'var(--radius-md)',
              }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: result.approved ? '#16a34a' : '#ef4444',
                  marginBottom: 6,
                }}>
                  {result.approved
                    ? '✓ All clear'
                    : `⚠ ${errors.length} error${errors.length === 1 ? '' : 's'}${warnings.length > 0 ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}`}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {result.summary}
                </div>
              </div>

              {result.issues.map((issue, i) => {
                const isErr = issue.severity === 'error'
                return (
                  <div key={i} style={{
                    padding: '12px 14px',
                    background: isErr ? 'rgba(239,68,68,0.06)' : 'rgba(234,179,8,0.06)',
                    border: `1px solid ${isErr ? 'rgba(239,68,68,0.25)' : 'rgba(234,179,8,0.3)'}`,
                    borderRadius: 'var(--radius-md)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{
                        padding: '1px 7px',
                        borderRadius: 'var(--radius-pill)',
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        color: isErr ? '#ef4444' : '#ca8a04',
                        background: isErr ? 'rgba(239,68,68,0.12)' : 'rgba(234,179,8,0.12)',
                        border: `1px solid ${isErr ? 'rgba(239,68,68,0.25)' : 'rgba(234,179,8,0.3)'}`,
                      }}>
                        {issue.severity.toUpperCase()}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {issue.employee_name}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {issue.description}
                    </div>
                    {issue.suggestion && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic', lineHeight: 1.5 }}>
                        Suggestion: {issue.suggestion}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid var(--border-default)',
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          flexShrink: 0,
          background: 'var(--bg-surface-1)',
        }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            disabled={phase === 'saving'}
          >
            {phase === 'reviewed' && (errors.length > 0 || warnings.length > 0) ? 'Fix Issues' : 'Close'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={save}
            disabled={!canSave}
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </>
  )
}
