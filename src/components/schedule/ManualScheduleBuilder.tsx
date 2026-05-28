'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type {
  Employee,
  Schedule,
  ScheduleAssignment,
  ScheduleData,
  ScheduleGap,
  ShiftRequirement,
  StaffingReport,
  WageRate,
} from '@/lib/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function mondayOf(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

interface DayInfo {
  iso: string
  weekday: string
  weekdayShort: string
  dayOfWeek: number
  monthDay: string
}

interface WeekRange {
  start: string
  end: string
  days: DayInfo[]
}

function buildWeek(choice: 'this' | 'next'): WeekRange {
  const today = new Date()
  const monday = mondayOf(today)
  if (choice === 'next') monday.setDate(monday.getDate() + 7)
  const days: DayInfo[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    days.push({
      iso: isoDate(d),
      weekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
      weekdayShort: d.toLocaleDateString('en-US', { weekday: 'short' }),
      dayOfWeek: d.getDay(),
      monthDay: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    })
  }
  return { start: days[0].iso, end: days[6].iso, days }
}

function shortRangeLabel(range: WeekRange): string {
  return `${range.days[0].monthDay}-${range.days[6].monthDay.replace(/^[A-Za-z]+\s/, '')}`
}

function longRangeLabel(range: WeekRange): string {
  return `${range.days[0].monthDay} – ${range.days[6].monthDay}`
}

function computeHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60)
}

function formatCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function expandTODates(start: string, end: string): string[] {
  const out: string[] = []
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const cur = new Date(sy, sm - 1, sd)
  const last = new Date(ey, em - 1, ed)
  while (cur <= last) {
    out.push(isoDate(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

const TO_CONFIRM_PHRASE = 'yes, i know this employee has to'

// ── Types internal to the builder ─────────────────────────────────────────────

interface ManualAssignment {
  shift_name: string
  role: string
  slot_index: number
  date: string
  employee_id: string
  employee_name: string
  start_time: string
  end_time: string
  hours: number
  to_override: boolean
}

interface ToConfirmation {
  shift_name: string
  role: string
  slot_index: number
  date: string
  employee_id: string
  employee_name: string
  start_time: string
  end_time: string
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ManualScheduleBuilderProps {
  companyId: string
  onClose: () => void
  onSaved: (schedule: Schedule) => void
}

export default function ManualScheduleBuilder({
  companyId,
  onClose,
  onSaved,
}: ManualScheduleBuilderProps) {
  const supabase = createClient()

  const [weekChoice, setWeekChoice] = useState<'this' | 'next'>('this')
  const range = useMemo(() => buildWeek(weekChoice), [weekChoice])

  const [selectedDayIso, setSelectedDayIso] = useState(range.days[0].iso)
  useEffect(() => { setSelectedDayIso(range.days[0].iso) }, [range])

  const [employees, setEmployees] = useState<Employee[]>([])
  const [shiftReqs, setShiftReqs] = useState<ShiftRequirement[]>([])
  const [wageRates, setWageRates] = useState<WageRate[]>([])
  const [toByEmployee, setToByEmployee] = useState<Map<string, Set<string>>>(new Map())
  const [existingSchedule, setExistingSchedule] = useState<Schedule | null>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [assignments, setAssignments] = useState<ManualAssignment[]>([])
  const [toConfirmation, setToConfirmation] = useState<ToConfirmation | null>(null)
  const [confirmInput, setConfirmInput] = useState('')

  // ── Load week-dependent data whenever the week changes ───────────────────
  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!companyId) return
      setLoading(true)

      const [empRes, reqRes, wageRes, toRes, existRes] = await Promise.all([
        supabase
          .from('employees')
          .select('id, company_id, name, primary_role, qualified_roles, max_weekly_hours, contact_phone, contact_email, active, created_at, individual_wage, is_veteran')
          .eq('company_id', companyId)
          .eq('active', true)
          .order('name'),
        supabase
          .from('shift_requirements')
          .select('id, company_id, shift_type_id, shift_name, role, required_count, start_time, end_time, days_active')
          .eq('company_id', companyId),
        supabase
          .from('wage_rates')
          .select('id, company_id, role, hourly_rate')
          .eq('company_id', companyId),
        supabase
          .from('time_off_requests')
          .select('employee_id, start_date, end_date')
          .eq('company_id', companyId)
          .eq('status', 'approved')
          .lte('start_date', range.end)
          .gte('end_date', range.start),
        supabase
          .from('schedules')
          .select('*')
          .eq('company_id', companyId)
          .eq('week_start', range.start)
          .eq('week_end', range.end)
          .order('generated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      if (cancelled) return

      const emps = (empRes.data ?? []) as Employee[]
      setEmployees(emps)
      setShiftReqs((reqRes.data ?? []) as ShiftRequirement[])
      setWageRates((wageRes.data ?? []) as WageRate[])
      setExistingSchedule((existRes.data as Schedule | null) ?? null)

      const toMap = new Map<string, Set<string>>()
      const toRows = (toRes.data ?? []) as { employee_id: string; start_date: string; end_date: string }[]
      for (const row of toRows) {
        const dates = expandTODates(row.start_date, row.end_date)
        const set = toMap.get(row.employee_id) ?? new Set<string>()
        for (const d of dates) set.add(d)
        toMap.set(row.employee_id, set)
      }
      setToByEmployee(toMap)

      // Reset the in-progress build whenever the week changes — we don't want
      // stale assignments from the previous week to bleed across.
      setAssignments([])
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [companyId, range, supabase])

  // ── Derived ──────────────────────────────────────────────────────────────

  const empById = useMemo(() => {
    const m = new Map<string, Employee>()
    for (const e of employees) m.set(e.id, e)
    return m
  }, [employees])

  const rateByRole = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of wageRates) m.set(r.role, r.hourly_rate)
    return m
  }, [wageRates])

  function rateFor(emp: Employee | undefined): { rate: number | null; source: 'individual' | 'role' | 'unknown' } {
    if (!emp) return { rate: null, source: 'unknown' }
    if (emp.individual_wage != null) return { rate: emp.individual_wage, source: 'individual' }
    const role = rateByRole.get(emp.primary_role)
    if (role != null) return { rate: role, source: 'role' }
    return { rate: null, source: 'unknown' }
  }

  const hoursByEmployee = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of assignments) {
      m.set(a.employee_id, (m.get(a.employee_id) ?? 0) + a.hours)
    }
    return m
  }, [assignments])

  const selectedDay = range.days.find(d => d.iso === selectedDayIso) ?? range.days[0]

  // Group requirements by shift_name for the selected day.
  const shiftsForSelectedDay = useMemo(() => {
    const onDay = shiftReqs.filter(r => r.days_active.includes(selectedDay.dayOfWeek))
    const byShift = new Map<string, ShiftRequirement[]>()
    for (const r of onDay) {
      const list = byShift.get(r.shift_name) ?? []
      list.push(r)
      byShift.set(r.shift_name, list)
    }
    return Array.from(byShift.entries()).map(([shift_name, reqs]) => ({
      shift_name,
      reqs: reqs.sort((a, b) => a.role.localeCompare(b.role)),
    }))
  }, [shiftReqs, selectedDay])

  function getSlot(shift_name: string, role: string, slot_index: number, date: string): ManualAssignment | undefined {
    return assignments.find(a =>
      a.shift_name === shift_name &&
      a.role === role &&
      a.slot_index === slot_index &&
      a.date === date,
    )
  }

  function isEmployeeAssignedToShift(employee_id: string, shift_name: string, date: string): boolean {
    return assignments.some(a => a.employee_id === employee_id && a.shift_name === shift_name && a.date === date)
  }

  function isEmployeeAssignedToday(employee_id: string, date: string): boolean {
    return assignments.some(a => a.employee_id === employee_id && a.date === date)
  }

  function hasTOOnDate(employee_id: string, date: string): boolean {
    return toByEmployee.get(employee_id)?.has(date) ?? false
  }

  // ── Suggested / Override option lists ────────────────────────────────────

  function suggestedOptions(role: string, shift_name: string, date: string): Array<{ employee: Employee; hours: number }> {
    return employees
      .filter(e => {
        const qualified = e.primary_role === role || (e.qualified_roles ?? []).includes(role)
        if (!qualified) return false
        if (hasTOOnDate(e.id, date)) return false
        if (isEmployeeAssignedToShift(e.id, shift_name, date)) return false
        return true
      })
      .map(e => ({ employee: e, hours: hoursByEmployee.get(e.id) ?? 0 }))
      .sort((a, b) => a.hours - b.hours || a.employee.name.localeCompare(b.employee.name))
  }

  function overrideOptions(date: string): Array<{ employee: Employee; hours: number; hasTO: boolean; alreadyToday: boolean }> {
    return employees
      .map(e => ({
        employee: e,
        hours: hoursByEmployee.get(e.id) ?? 0,
        hasTO: hasTOOnDate(e.id, date),
        alreadyToday: isEmployeeAssignedToday(e.id, date),
      }))
      .sort((a, b) => a.employee.name.localeCompare(b.employee.name))
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  function commitAssignment(req: ShiftRequirement, slot_index: number, date: string, emp: Employee, to_override: boolean) {
    setAssignments(prev => {
      const without = prev.filter(a => !(a.shift_name === req.shift_name && a.role === req.role && a.slot_index === slot_index && a.date === date))
      return [...without, {
        shift_name: req.shift_name,
        role: req.role,
        slot_index,
        date,
        employee_id: emp.id,
        employee_name: emp.name,
        start_time: req.start_time,
        end_time: req.end_time,
        hours: computeHours(req.start_time, req.end_time),
        to_override,
      }]
    })
  }

  function clearSlot(req: ShiftRequirement, slot_index: number, date: string) {
    setAssignments(prev => prev.filter(a => !(a.shift_name === req.shift_name && a.role === req.role && a.slot_index === slot_index && a.date === date)))
  }

  function pickFromSuggested(req: ShiftRequirement, slot_index: number, date: string, employee_id: string) {
    if (!employee_id) {
      clearSlot(req, slot_index, date)
      return
    }
    const emp = empById.get(employee_id)
    if (!emp) return
    commitAssignment(req, slot_index, date, emp, false)
  }

  function pickFromOverride(req: ShiftRequirement, slot_index: number, date: string, employee_id: string) {
    if (!employee_id) {
      clearSlot(req, slot_index, date)
      return
    }
    const emp = empById.get(employee_id)
    if (!emp) return
    if (hasTOOnDate(emp.id, date)) {
      setToConfirmation({
        shift_name: req.shift_name,
        role: req.role,
        slot_index,
        date,
        employee_id: emp.id,
        employee_name: emp.name,
        start_time: req.start_time,
        end_time: req.end_time,
      })
      setConfirmInput('')
      return
    }
    commitAssignment(req, slot_index, date, emp, false)
  }

  function confirmTOOverride() {
    if (!toConfirmation) return
    if (confirmInput.trim().toLowerCase() !== TO_CONFIRM_PHRASE) return
    const emp = empById.get(toConfirmation.employee_id)
    const req = shiftReqs.find(r => r.shift_name === toConfirmation.shift_name && r.role === toConfirmation.role)
    if (!emp || !req) {
      setToConfirmation(null)
      return
    }
    commitAssignment(req, toConfirmation.slot_index, toConfirmation.date, emp, true)
    setToConfirmation(null)
    setConfirmInput('')
  }

  function cancelTOOverride() {
    setToConfirmation(null)
    setConfirmInput('')
  }

  // ── Live summary ─────────────────────────────────────────────────────────

  const totalRequiredSlots = useMemo(() => {
    let total = 0
    for (const day of range.days) {
      for (const req of shiftReqs) {
        if (req.days_active.includes(day.dayOfWeek)) total += req.required_count
      }
    }
    return total
  }, [shiftReqs, range])

  const summaryRows = useMemo(() => {
    const m = new Map<string, { name: string; hours: number; pay: number; rateKnown: boolean }>()
    for (const a of assignments) {
      const cur = m.get(a.employee_id) ?? { name: a.employee_name, hours: 0, pay: 0, rateKnown: true }
      cur.hours += a.hours
      const { rate } = rateFor(empById.get(a.employee_id))
      if (rate != null) cur.pay += a.hours * rate
      else cur.rateKnown = false
      m.set(a.employee_id, cur)
    }
    const list: Array<{ employee_id: string; name: string; hours: number; pay: number; rateKnown: boolean }> = []
    m.forEach((v, k) => list.push({
      employee_id: k,
      name: v.name,
      hours: Math.round(v.hours * 10) / 10,
      pay: Math.round(v.pay * 100) / 100,
      rateKnown: v.rateKnown,
    }))
    return list.sort((a, b) => b.hours - a.hours)
  }, [assignments, empById, rateFor])

  const totalPay = summaryRows.reduce((s, r) => s + r.pay, 0)
  const partialPay = summaryRows.some(r => !r.rateKnown)
  const coverage = totalRequiredSlots > 0
    ? Math.round((assignments.length / totalRequiredSlots) * 100)
    : 100

  // ── Save ─────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    setSaveError(null)

    const canonicalAssignments: ScheduleAssignment[] = assignments.map(a => ({
      date: a.date,
      employee_id: a.employee_id,
      employee_name: a.employee_name,
      shift_name: a.shift_name,
      role: a.role,
      start_time: a.start_time,
      end_time: a.end_time,
      hours: a.hours,
    }))

    const gaps: ScheduleGap[] = []
    for (const day of range.days) {
      const todayReqs = shiftReqs.filter(r => r.days_active.includes(day.dayOfWeek))
      for (const req of todayReqs) {
        const filled = assignments.filter(a => a.date === day.iso && a.shift_name === req.shift_name && a.role === req.role).length
        if (filled < req.required_count) {
          gaps.push({
            date: day.iso,
            shift_name: req.shift_name,
            role: req.role,
            required_count: req.required_count,
            filled_count: filled,
            reason: 'Manually built — slot left unfilled',
          })
        }
      }
    }

    const contributorList = summaryRows.map(r => ({ employee_id: r.employee_id, name: r.name, hours: r.hours }))
    const top_contributors = contributorList.slice(0, 5)
    const bottom_contributors = [...contributorList].reverse().slice(0, 5)

    const staffing_report: StaffingReport = {
      coverage_rate: coverage,
      top_contributors,
      bottom_contributors,
      overtime_risk: [],
      gap_summary: gaps.length > 0 ? `${gaps.length} unfilled requirement${gaps.length === 1 ? '' : 's'}` : 'Fully covered',
      special_notes_applied: [],
      aegis_notes: 'Manually built by manager — Soteria did not review.',
    }

    const data: ScheduleData = {
      assignments: canonicalAssignments,
      gaps,
      summary: 'Manually built schedule — no AI involvement.',
    }

    const payload = {
      company_id: companyId,
      week_start: range.start,
      week_end: range.end,
      status: 'draft' as const,
      generated_by: 'manager',
      generated_at: new Date().toISOString(),
      data,
      staffing_report,
    }

    let savedSchedule: Schedule | null = null
    if (existingSchedule) {
      const { data: updated, error } = await supabase
        .from('schedules')
        .update(payload)
        .eq('id', existingSchedule.id)
        .select()
        .single()
      if (error) {
        setSaveError(error.message)
        setSaving(false)
        return
      }
      savedSchedule = updated as Schedule
    } else {
      const { data: inserted, error } = await supabase
        .from('schedules')
        .insert(payload)
        .select()
        .single()
      if (error) {
        setSaveError(error.message)
        setSaving(false)
        return
      }
      savedSchedule = inserted as Schedule
    }

    setSaving(false)
    onSaved(savedSchedule)
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 950 }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed',
        bottom: 0, left: 0, right: 0,
        height: '85vh',
        background: 'var(--bg-base)',
        borderTop: '1px solid var(--border-default)',
        borderTopLeftRadius: 'var(--radius-xl)',
        borderTopRightRadius: 'var(--radius-xl)',
        zIndex: 951,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 -16px 40px rgba(0,0,0,0.4)',
      }}>

        {/* Header */}
        <div style={{
          padding: '20px 28px',
          borderBottom: '1px solid var(--border-default)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 16,
          flexShrink: 0,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
              Manual Schedule Builder
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              No AI. No rules. Just you and a spreadsheet vibe.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <select
              className="form-select"
              value={weekChoice}
              onChange={e => setWeekChoice(e.target.value as 'this' | 'next')}
              style={{ minWidth: 220 }}
            >
              <option value="this">This week ({shortRangeLabel(buildWeek('this'))})</option>
              <option value="next">Next week ({shortRangeLabel(buildWeek('next'))})</option>
            </select>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18,
              }}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Existing schedule warning */}
        {existingSchedule && (
          <div style={{
            padding: '10px 28px',
            background: 'rgba(234,179,8,0.08)',
            borderBottom: '1px solid rgba(234,179,8,0.25)',
            fontSize: 12,
            color: '#ca8a04',
            flexShrink: 0,
          }}>
            <strong>Heads up:</strong> a schedule already exists for {longRangeLabel(range)}. Saving this will replace it.
          </div>
        )}

        {/* Body: split layout */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Left side: tabs + shift cards */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border-subtle)' }}>

            {/* Day tabs */}
            <div style={{
              display: 'flex',
              gap: 4,
              padding: '12px 28px',
              overflowX: 'auto',
              borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0,
            }}>
              {range.days.map(d => {
                const active = d.iso === selectedDayIso
                return (
                  <button
                    key={d.iso}
                    onClick={() => setSelectedDayIso(d.iso)}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 'var(--radius-pill)',
                      border: '1px solid',
                      fontSize: 12,
                      fontFamily: 'var(--font-body)',
                      cursor: 'pointer',
                      background: active ? 'var(--accent-dim)' : 'transparent',
                      borderColor: active ? 'var(--accent-border)' : 'var(--border-default)',
                      color: active ? 'var(--accent)' : 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{d.weekday}</span>
                    <span style={{ marginLeft: 6, opacity: 0.75 }}>{d.monthDay}</span>
                  </button>
                )
              })}
            </div>

            {/* Shift cards for selected day */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
              {loading ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  Loading employees and shifts…
                </div>
              ) : shiftsForSelectedDay.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  No shifts are configured for {selectedDay.weekday}.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {shiftsForSelectedDay.map(({ shift_name, reqs }) => {
                    const firstReq = reqs[0]
                    return (
                      <div key={shift_name} style={{
                        background: 'var(--bg-surface-1)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-lg)',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          padding: '12px 16px',
                          borderBottom: '1px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 10,
                        }}>
                          <div style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 14,
                            fontWeight: 700,
                            color: 'var(--text-primary)',
                            letterSpacing: '0.04em',
                          }}>
                            {shift_name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {firstReq.start_time} – {firstReq.end_time}
                          </div>
                        </div>

                        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                          {reqs.flatMap(req =>
                            Array.from({ length: req.required_count }, (_, slot_index) => {
                              const slot = getSlot(req.shift_name, req.role, slot_index, selectedDayIso)
                              const sugg = suggestedOptions(req.role, req.shift_name, selectedDayIso)
                              const overrideOpts = overrideOptions(selectedDayIso)
                              return (
                                <SlotRow
                                  key={`${req.id}::${slot_index}`}
                                  req={req}
                                  slot_index={slot_index}
                                  slot={slot}
                                  suggestedOpts={sugg}
                                  overrideOpts={overrideOpts}
                                  onPickSuggested={(empId) => pickFromSuggested(req, slot_index, selectedDayIso, empId)}
                                  onPickOverride={(empId) => pickFromOverride(req, slot_index, selectedDayIso, empId)}
                                  onClear={() => clearSlot(req, slot_index, selectedDayIso)}
                                />
                              )
                            }),
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right side: live summary */}
          <div style={{ width: '30%', minWidth: 280, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px 12px', flexShrink: 0 }}>
              <div className="section-label" style={{ margin: 0 }}>Live Summary</div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{
                background: 'var(--bg-surface-1)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-lg)',
                padding: '14px 16px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
              }}>
                <SummaryStat label="Assignments" value={String(assignments.length)} />
                <SummaryStat label="Coverage" value={`${coverage}%`} sub={`${assignments.length}/${totalRequiredSlots} slots`} />
                <SummaryStat label="Est. wages" value={formatCurrency(totalPay)} sub={partialPay ? '(partial — some rates unknown)' : undefined} accent />
                <SummaryStat label="Employees" value={String(summaryRows.length)} />
              </div>

              <div>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
                  Hours by employee
                </div>
                {summaryRows.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-disabled)', fontStyle: 'italic', padding: '12px 0' }}>
                    No assignments yet.
                  </div>
                ) : (
                  <div style={{
                    background: 'var(--bg-surface-1)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-lg)',
                    overflow: 'hidden',
                  }}>
                    {summaryRows.map((r, i) => (
                      <div key={r.employee_id} style={{
                        padding: '8px 12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        borderBottom: i < summaryRows.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                        fontSize: 12,
                      }}>
                        <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.name}
                        </span>
                        <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{r.hours.toFixed(1)}h</span>
                          {r.rateKnown ? (
                            <span style={{ marginLeft: 6, color: 'var(--accent)' }}>{formatCurrency(r.pay)}</span>
                          ) : (
                            <span style={{ marginLeft: 6, color: 'var(--text-disabled)' }}>—</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 28px',
          borderTop: '1px solid var(--border-default)',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}>
          {saveError && (
            <div style={{ flex: 1, fontSize: 12, color: 'var(--status-blocked-text)' }}>
              {saveError}
            </div>
          )}
          <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? 'Saving…' : 'Save as Draft'}
          </button>
        </div>
      </div>

      {/* TO override confirmation modal */}
      {toConfirmation && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}>
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-xl)',
            padding: 28,
            width: '100%',
            maxWidth: 460,
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
              This employee has approved time off
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
              You are scheduling <strong style={{ color: 'var(--text-primary)' }}>{toConfirmation.employee_name}</strong> on <strong style={{ color: 'var(--text-primary)' }}>{toConfirmation.date}</strong> but they have approved time off that day. To confirm, type:
            </div>
            <div style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 12,
              color: 'var(--text-primary)',
              background: 'var(--bg-surface-3)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 12px',
              marginBottom: 12,
            }}>
              yes, I know this employee has TO
            </div>
            <input
              className="form-input"
              autoFocus
              value={confirmInput}
              onChange={e => setConfirmInput(e.target.value)}
              placeholder="Type the phrase exactly"
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={cancelTOOverride}>Cancel</button>
              <button
                className="btn btn-sm"
                onClick={confirmTOOverride}
                disabled={confirmInput.trim().toLowerCase() !== TO_CONFIRM_PHRASE}
                style={{
                  background: confirmInput.trim().toLowerCase() === TO_CONFIRM_PHRASE ? 'var(--accent)' : 'var(--bg-surface-3)',
                  color: confirmInput.trim().toLowerCase() === TO_CONFIRM_PHRASE ? 'white' : 'var(--text-disabled)',
                  border: '1px solid var(--accent-border)',
                  cursor: confirmInput.trim().toLowerCase() === TO_CONFIRM_PHRASE ? 'pointer' : 'not-allowed',
                }}
              >
                Schedule Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function SummaryStat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: accent ? 'var(--accent)' : 'var(--text-primary)', lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{sub}</div>
      )}
    </div>
  )
}

interface SlotRowProps {
  req: ShiftRequirement
  slot_index: number
  slot: ManualAssignment | undefined
  suggestedOpts: Array<{ employee: Employee; hours: number }>
  overrideOpts: Array<{ employee: Employee; hours: number; hasTO: boolean; alreadyToday: boolean }>
  onPickSuggested: (employee_id: string) => void
  onPickOverride: (employee_id: string) => void
  onClear: () => void
}

function SlotRow({ req, slot_index, slot, suggestedOpts, overrideOpts, onPickSuggested, onPickOverride, onClear }: SlotRowProps) {
  const [activeSide, setActiveSide] = useState<'suggested' | 'override' | null>(null)

  const suggestedValue = activeSide === 'suggested' && slot ? slot.employee_id : ''
  const overrideValue = activeSide === 'override' && slot ? slot.employee_id : ''

  function handleSuggested(value: string) {
    if (value) {
      setActiveSide('suggested')
      onPickSuggested(value)
    } else {
      setActiveSide(null)
      onClear()
    }
  }

  function handleOverride(value: string) {
    if (value) {
      setActiveSide('override')
      onPickOverride(value)
    } else {
      setActiveSide(null)
      onClear()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{req.role}</span>
        {req.required_count > 1 && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            slot {slot_index + 1} of {req.required_count}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            Suggested
          </label>
          <select
            className="form-select"
            value={suggestedValue}
            onChange={e => handleSuggested(e.target.value)}
            style={{ fontSize: 12, width: '100%' }}
          >
            <option value="">— Select suggested —</option>
            {suggestedOpts.map(o => (
              <option key={o.employee.id} value={o.employee.id}>
                {o.employee.name} ({o.hours.toFixed(1)}h)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            Override
          </label>
          <select
            className="form-select"
            value={overrideValue}
            onChange={e => handleOverride(e.target.value)}
            style={{ fontSize: 12, width: '100%' }}
          >
            <option value="">— Pick anyone —</option>
            {overrideOpts.map(o => {
              const tags: string[] = []
              if (o.hasTO) tags.push('⚠ Has approved TO')
              if (o.alreadyToday) tags.push('Already scheduled')
              const suffix = tags.length > 0 ? ` · ${tags.join(' · ')}` : ''
              return (
                <option key={o.employee.id} value={o.employee.id}>
                  {o.employee.name} ({o.hours.toFixed(1)}h){suffix}
                </option>
              )
            })}
          </select>
        </div>
      </div>

      {slot && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 10px',
            borderRadius: 'var(--radius-pill)',
            fontSize: 11,
            fontWeight: 500,
            background: 'var(--accent-dim)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-border)',
          }}>
            {slot.employee_name}
            <button
              type="button"
              onClick={() => { setActiveSide(null); onClear() }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: 0,
                fontSize: 13,
                lineHeight: 1,
              }}
              aria-label="Remove"
            >
              ×
            </button>
          </span>
          {slot.to_override && (
            <span style={{
              padding: '2px 8px',
              borderRadius: 'var(--radius-pill)',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              background: 'rgba(249,115,22,0.1)',
              color: '#f97316',
              border: '1px solid rgba(249,115,22,0.25)',
            }}>
              TO Override
            </span>
          )}
        </div>
      )}
    </div>
  )
}
