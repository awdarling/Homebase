import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import type { ScheduleAssignment, CustomAvailability } from '@/lib/types'
import {
  validateScheduleEdit,
  type ValidatorAssignment,
  type ValidatorAvailability,
  type ValidatorEmployee,
  type ValidatorPartialDayOff,
} from '@/lib/soteria/validateScheduleEdit'

// Item 1b — "Fix Issues": Soteria resolves the blocking issues for the manager.
// Rather than trust an LLM to hand-edit a live schedule (risky), this is
// DETERMINISTIC and guaranteed: it repeatedly removes the specific edit-introduced
// assignment causing each hard error, re-validating after every removal, until the
// deterministic validator reports zero errors. It prefers to undo the manager's
// just-added/moved assignments (the source of the conflict), never touching
// pre-existing ones it doesn't have to. Returns the corrected assignments + a
// plain-English summary of what it changed.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type ChangeKind = 'moved' | 'added' | 'removed'
interface ScheduleChange {
  kind: ChangeKind
  employee_id: string
  employee_name: string
  from?: { shift_name: string; date: string; role: string }
  to?: { shift_name: string; date: string; role: string }
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      company_id: string
      schedule_id: string
      proposed_assignments: ScheduleAssignment[]
      changes: ScheduleChange[]
    }
    const { company_id, schedule_id, proposed_assignments, changes } = body

    const ssr = await createServerSupabase()
    const { data: { user } } = await ssr.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: userRow } = await ssr.from('users').select('company_id').eq('id', user.id).single()
    if (!userRow || (userRow as { company_id: string }).company_id !== company_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const touchedEmployeeIds = Array.from(new Set(changes.flatMap(c => c.employee_id ? [c.employee_id] : [])))
    const noEmp = ['00000000-0000-0000-0000-000000000000']

    const [
      { data: employees },
      { data: availability },
      { data: customAvailability },
      { data: timeOff },
      { data: conflicts },
      { data: schedule },
    ] = await Promise.all([
      supabase.from('employees').select('id, name, qualified_roles, max_weekly_hours, last_day').eq('company_id', company_id).eq('active', true),
      supabase.from('availability').select('employee_id, day_of_week, start_time, end_time').eq('company_id', company_id).in('employee_id', touchedEmployeeIds.length > 0 ? touchedEmployeeIds : noEmp),
      // select('*') so effective_start_date (migration 019, Finding 3) is picked up automatically once the column exists.
      supabase.from('custom_availability').select('*').eq('company_id', company_id).eq('active', true).in('employee_id', touchedEmployeeIds.length > 0 ? touchedEmployeeIds : noEmp),
      supabase.from('time_off_requests').select('employee_id, start_date, end_date, status, time_off_type, partial_days').eq('company_id', company_id).eq('status', 'approved'),
      supabase.from('employee_conflicts').select('employee_id_1, employee_id_2, severity').eq('company_id', company_id),
      supabase.from('schedules').select('week_start').eq('id', schedule_id).is('deleted_at', null).single(),
    ])

    const employeesById = new Map<string, ValidatorEmployee>()
    for (const e of employees ?? []) {
      employeesById.set(e.id, { id: e.id, name: e.name, qualified_roles: (e.qualified_roles as string[]) ?? [], max_weekly_hours: (e.max_weekly_hours as number) ?? 0, last_day: (e as { last_day?: string | null }).last_day ?? null })
    }
    const availByEmp = new Map<string, ValidatorAvailability[]>()
    for (const av of availability ?? []) {
      const list = availByEmp.get(av.employee_id) ?? []
      list.push({ day_of_week: av.day_of_week, start_time: av.start_time, end_time: av.end_time })
      availByEmp.set(av.employee_id, list)
    }
    const customByEmp = new Map<string, CustomAvailability | null>()
    for (const ca of (customAvailability ?? []) as unknown as CustomAvailability[]) {
      if (!customByEmp.has(ca.employee_id)) customByEmp.set(ca.employee_id, ca)
    }
    const toValidatorTimeOff = (timeOff ?? []).map(t => ({
      employee_id: t.employee_id,
      start_date: t.start_date,
      end_date: t.end_date,
      time_off_type: (t as { time_off_type?: string | null }).time_off_type ?? null,
      partial_days: (t as { partial_days?: ValidatorPartialDayOff[] | null }).partial_days ?? null,
    }))
    const toValidatorConflicts = (conflicts ?? []).map(c => ({ employee_id_1: c.employee_id_1, employee_id_2: c.employee_id_2, severity: c.severity }))
    const weekStart = schedule?.week_start ?? ''

    const toValidator = (a: ScheduleAssignment): ValidatorAssignment => ({
      employee_id: a.employee_id, employee_name: a.employee_name ?? '', date: a.date, shift_name: a.shift_name,
      role: a.role ?? '', start_time: a.start_time ?? '', end_time: a.end_time ?? '', hours: a.hours ?? 0,
    })
    const runValidator = (assignments: ScheduleAssignment[]) => validateScheduleEdit({
      weekStart, proposedAssignments: assignments.map(toValidator), touchedEmployeeIds,
      employeesById, availByEmp, customByEmp, timeOff: toValidatorTimeOff, conflicts: toValidatorConflicts,
    })

    // Assignments the manager just added/moved onto the board (preferred removal targets).
    const addedKeys = new Set(
      changes.filter(c => (c.kind === 'added' || c.kind === 'moved') && c.to)
        .map(c => `${c.employee_id}|${c.to!.shift_name}|${c.to!.date}`),
    )
    const key = (a: ScheduleAssignment) => `${a.employee_id}|${a.shift_name}|${a.date}`
    const implicated = (a: ScheduleAssignment, errNames: string[]) =>
      errNames.some(n => n === a.employee_name || n.includes(a.employee_name))

    let current = [...proposed_assignments]
    const removed: ScheduleAssignment[] = []
    for (let iter = 0; iter < 60; iter++) {
      const errs = runValidator(current).filter(i => i.severity === 'error')
      if (errs.length === 0) break
      const errNames = errs.map(e => e.employee_name)
      // Prefer an edit-added assignment for an implicated employee; then any added;
      // then any implicated assignment. Guarantees forward progress.
      let idx = current.findIndex(a => addedKeys.has(key(a)) && implicated(a, errNames))
      if (idx < 0) idx = current.findIndex(a => addedKeys.has(key(a)))
      if (idx < 0) idx = current.findIndex(a => implicated(a, errNames))
      if (idx < 0) break // nothing safe to remove — bail with best effort
      removed.push(current[idx])
      current = current.filter((_, i) => i !== idx)
    }

    const stillErrs = runValidator(current).filter(i => i.severity === 'error')
    const removedLines = removed.map(r => `${r.employee_name} from ${r.shift_name} on ${fmtDate(r.date)}`)
    let summary: string
    if (removed.length === 0) {
      summary = stillErrs.length === 0 ? 'Nothing to fix — the schedule was already clear.' : 'Couldn’t auto-resolve these issues safely — please adjust them by hand or use Override.'
    } else {
      summary = `Removed ${removed.length} conflicting assignment${removed.length === 1 ? '' : 's'} to clear the blocking issue${removed.length === 1 ? '' : 's'}: ${removedLines.join('; ')}.`
      if (stillErrs.length > 0) summary += ` ${stillErrs.length} issue${stillErrs.length === 1 ? '' : 's'} still need a manual look.`
      else summary += ' Add replacements if you need the coverage.'
    }

    return NextResponse.json({ corrected_assignments: current, removed_count: removed.length, remaining_errors: stillErrs.length, summary })
  } catch (e) {
    console.error('[soteria-fix-schedule] error:', e)
    return NextResponse.json({ error: 'Auto-fix failed' }, { status: 500 })
  }
}
