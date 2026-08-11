import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import type { ScheduleAssignment, CustomAvailability } from '@/lib/types'
import {
  validateScheduleEdit,
  type ScheduleEditIssue,
  type ValidatorAssignment,
  type ValidatorAvailability,
  type ValidatorEmployee,
  type ValidatorShiftType,
  type ValidatorShiftRequirement,
  type ValidatorExperienceRule,
  type ValidatorSexCoverage,
  type ValidatorPartialDayOff,
} from '@/lib/soteria/validateScheduleEdit'

// SOTERIA-SCOPE-1 (2026-07-21): the LLM "soft warning" pass was REMOVED. It was
// the source of the "too much / hallucinated" flags managers complained about
// (subjective fairness/rotation/coverage-thinking opinions). Soteria now returns
// ONLY deterministic checks from validateScheduleEdit — every configured rule a
// manual edit can break, and nothing else.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Not every company configures a "max consecutive days worked" rule, but the
// managers asked to keep the days-in-a-row reminder. When no policy is set we
// still give it, using this gentle default (flag MORE than N in a row). Set a
// real policy to override per company.
const DEFAULT_MAX_CONSECUTIVE_DAYS = 6
const MAX_CONSEC_KEYS = new Set([
  'max_consecutive_days_worked',
  'max_consecutive_days',
  'max_consecutive_work_days',
])

type ChangeKind = 'moved' | 'added' | 'removed'

interface ScheduleChange {
  kind: ChangeKind
  employee_id: string
  employee_name: string
  from?: { shift_name: string; date: string; role: string }
  to?: { shift_name: string; date: string; role: string }
}

interface SoteraIssue {
  severity: 'error' | 'warning'
  employee_name: string
  description: string
  suggestion: string | null
}

interface SoteriaResponse {
  issues: SoteraIssue[]
  summary: string
  approved: boolean
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      company_id: string
      schedule_id: string
      original_assignments: ScheduleAssignment[]
      proposed_assignments: ScheduleAssignment[]
      changes: ScheduleChange[]
    }

    const { company_id, schedule_id, proposed_assignments, changes } = body

    // Standard auth guard: caller must be signed in and belong to the company.
    const ssr = await createServerSupabase()
    const { data: { user } } = await ssr.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: userRow } = await ssr
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()
    if (!userRow || (userRow as { company_id: string }).company_id !== company_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Distinct employee_ids that appear in any change
    const touchedEmployeeIds = Array.from(new Set(
      changes.flatMap(c => c.employee_id ? [c.employee_id] : []),
    ))
    const noTouch = ['00000000-0000-0000-0000-000000000000']

    const [
      { data: employees },
      { data: availability },
      { data: customAvailability },
      { data: timeOff },
      { data: conflicts },
      { data: policies },
      { data: schedule },
      { data: shiftTypes },
      { data: shiftRequirements },
      { data: experienceRules },
    ] = await Promise.all([
      supabase.from('employees')
        .select('id, name, primary_role, qualified_roles, max_weekly_hours, sex, is_veteran')
        .eq('company_id', company_id)
        .eq('active', true),
      supabase.from('availability')
        .select('employee_id, day_of_week, start_time, end_time')
        .eq('company_id', company_id)
        .in('employee_id', touchedEmployeeIds.length > 0 ? touchedEmployeeIds : noTouch),
      // select('*') so effective_start_date (migration 019, Finding 3) is picked
      // up automatically once the column exists — no deploy-order coupling.
      supabase.from('custom_availability')
        .select('*')
        .eq('company_id', company_id)
        .eq('active', true)
        .in('employee_id', touchedEmployeeIds.length > 0 ? touchedEmployeeIds : noTouch),
      supabase.from('time_off_requests')
        .select('employee_id, start_date, end_date, status, time_off_type, partial_days')
        .eq('company_id', company_id)
        .eq('status', 'approved'),
      supabase.from('employee_conflicts')
        .select('employee_id_1, employee_id_2, severity')
        .eq('company_id', company_id),
      supabase.from('policies')
        .select('policy_key, policy_value, policy_value_json')
        .eq('company_id', company_id),
      supabase.from('schedules')
        .select('week_start, week_end')
        .eq('id', schedule_id)
        .is('deleted_at', null)
        .single(),
      supabase.from('shift_types')
        .select('id, name, start_time, end_time, days_active')
        .eq('company_id', company_id)
        .eq('active', true),
      supabase.from('shift_requirements')
        .select('shift_type_id, role, required_count, accepted_roles')
        .eq('company_id', company_id),
      supabase.from('shift_experience_rules')
        .select('shift_type_id, days_of_week, role, mode, min_count, season_start, season_end, active')
        .eq('company_id', company_id)
        .eq('active', true),
    ])

    // ── Build deterministic validator inputs ────────────────────────────────────
    const employeesById = new Map<string, ValidatorEmployee>()
    for (const e of employees ?? []) {
      employeesById.set(e.id, {
        id: e.id,
        name: e.name,
        qualified_roles: (e.qualified_roles as string[]) ?? [],
        max_weekly_hours: (e.max_weekly_hours as number) ?? 0,
        sex: (e as { sex?: string | null }).sex ?? undefined,
        is_veteran: (e as { is_veteran?: boolean | null }).is_veteran ?? false,
      })
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

    const vShiftTypes: ValidatorShiftType[] = (shiftTypes ?? []).map(s => ({
      id: s.id,
      name: s.name,
      start_time: s.start_time,
      end_time: s.end_time,
      days_active: (s.days_active as number[]) ?? [],
    }))
    const vShiftReqs: ValidatorShiftRequirement[] = (shiftRequirements ?? []).map(r => ({
      shift_type_id: r.shift_type_id,
      role: r.role,
      required_count: r.required_count,
      accepted_roles: (r.accepted_roles as string[] | null) ?? null,
    }))
    const vExperience: ValidatorExperienceRule[] = (experienceRules ?? []).map(r => ({
      shift_type_id: r.shift_type_id,
      days_of_week: (r.days_of_week as number[] | null) ?? null,
      role: r.role,
      mode: r.mode === 'all_veterans' ? 'all_veterans' : 'min_veterans',
      min_count: r.min_count,
      season_start: r.season_start,
      season_end: r.season_end,
      active: r.active,
    }))

    // Sex/gender concurrent-coverage rule + max-consecutive-days from policies.
    let sexCoverage: ValidatorSexCoverage | null = null
    let maxConsecutiveDays = DEFAULT_MAX_CONSECUTIVE_DAYS
    for (const p of policies ?? []) {
      const j = (p as { policy_value_json?: unknown }).policy_value_json
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        const o = j as Record<string, unknown>
        if (o.scope === 'concurrent_coverage' && o.minimums && Array.isArray(o.population_roles)) {
          sexCoverage = {
            attribute: typeof o.attribute === 'string' ? o.attribute : 'sex',
            minimums: o.minimums as Record<string, number>,
            population_roles: o.population_roles as string[],
          }
        }
      }
      if (MAX_CONSEC_KEYS.has((p as { policy_key: string }).policy_key)) {
        const n = typeof j === 'number'
          ? j
          : parseInt(String((p as { policy_value?: string }).policy_value ?? ''), 10)
        if (Number.isFinite(n) && n > 0) maxConsecutiveDays = n
      }
    }

    // Cells the edit touched (from + to of every change) — shift-level warnings
    // are scoped to these so pre-existing gaps aren't re-surfaced as noise.
    const touchedCells = new Set<string>()
    for (const c of changes) {
      if (c.from) touchedCells.add(`${c.from.shift_name}||${c.from.date}`)
      if (c.to) touchedCells.add(`${c.to.shift_name}||${c.to.date}`)
    }

    const issues: ScheduleEditIssue[] = validateScheduleEdit({
      weekStart: schedule?.week_start ?? '',
      proposedAssignments: proposed_assignments.map((a): ValidatorAssignment => ({
        employee_id: a.employee_id,
        employee_name: a.employee_name ?? '',
        date: a.date,
        shift_name: a.shift_name,
        role: a.role ?? '',
        start_time: a.start_time ?? '',
        end_time: a.end_time ?? '',
        hours: a.hours ?? 0,
      })),
      touchedEmployeeIds,
      employeesById,
      availByEmp,
      customByEmp,
      timeOff: (timeOff ?? []).map(t => ({
        employee_id: t.employee_id,
        start_date: t.start_date,
        end_date: t.end_date,
        time_off_type: (t as { time_off_type?: string | null }).time_off_type ?? null,
        partial_days: (t as { partial_days?: ValidatorPartialDayOff[] | null }).partial_days ?? null,
      })),
      conflicts: (conflicts ?? []).map(c => ({ employee_id_1: c.employee_id_1, employee_id_2: c.employee_id_2, severity: c.severity })),
      maxConsecutiveDays,
      touchedCells,
      shiftTypes: vShiftTypes,
      shiftRequirements: vShiftReqs,
      experienceRules: vExperience,
      sexCoverage,
    })

    const errorCount = issues.filter(i => i.severity === 'error').length
    const warningCount = issues.filter(i => i.severity === 'warning').length

    const result: SoteriaResponse = {
      issues: issues.map(i => ({
        severity: i.severity,
        employee_name: i.employee_name,
        description: i.description,
        suggestion: i.suggestion,
      })),
      approved: errorCount === 0,
      summary: errorCount > 0
        ? `${errorCount} blocking issue${errorCount === 1 ? '' : 's'} must be fixed before publishing.`
        : (warningCount > 0
            ? `No blocking rule conflicts — ${warningCount} thing${warningCount === 1 ? '' : 's'} worth a look.`
            : 'All clear — no rule conflicts found.'),
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[soteria] error:', error)
    return NextResponse.json(
      {
        error: 'Validation failed',
        approved: false,
        issues: [],
        summary: 'An error occurred during validation.',
      },
      { status: 500 },
    )
  }
}
