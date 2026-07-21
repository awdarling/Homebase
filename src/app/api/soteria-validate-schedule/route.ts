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
<<<<<<< Updated upstream
  const body = await req.json() as {
    company_id: string
    schedule_id: string
    original_assignments: ScheduleAssignment[]
    proposed_assignments: ScheduleAssignment[]
    changes: ScheduleChange[]
  }

  const { company_id, schedule_id, proposed_assignments, changes } = body

  // Standard auth guard: caller must be signed in and belong to the company they query.
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
    changes.flatMap(c => c.employee_id ? [c.employee_id] : [])
  ))

  const [
    { data: company },
    { data: employees },
    { data: availability },
    { data: customAvailability },
    { data: timeOff },
    { data: conflicts },
    { data: policies },
    { data: schedule },
  ] = await Promise.all([
    supabase.from('companies').select('name').eq('id', company_id).single(),
    supabase.from('employees')
      .select('id, name, primary_role, qualified_roles, max_weekly_hours')
      .eq('company_id', company_id)
      .eq('active', true),
    supabase.from('availability')
      .select('employee_id, day_of_week, start_time, end_time')
      .eq('company_id', company_id)
      .in('employee_id', touchedEmployeeIds.length > 0 ? touchedEmployeeIds : ['00000000-0000-0000-0000-000000000000']),
    // custom_availability was previously NEVER loaded — the root of the bug where
    // a swap that violated an employee's custom availability was approved.
    supabase.from('custom_availability')
      .select('id, employee_id, company_id, type, end_date, cycle_weeks, cycle_start_date, patterns, active, created_at')
      .eq('company_id', company_id)
      .eq('active', true)
      .in('employee_id', touchedEmployeeIds.length > 0 ? touchedEmployeeIds : ['00000000-0000-0000-0000-000000000000']),
    supabase.from('time_off_requests')
      .select('employee_id, start_date, end_date, status')
      .eq('company_id', company_id)
      .eq('status', 'approved'),
    supabase.from('employee_conflicts')
      .select('employee_id_1, employee_id_2, severity, reason')
      .eq('company_id', company_id),
    supabase.from('policies').select('policy_key, policy_value, description').eq('company_id', company_id),
    supabase.from('schedules').select('week_start, week_end').eq('id', schedule_id).is('deleted_at', null).single(),
  ])

  const empById = new Map<string, { id: string; name: string; primary_role: string; qualified_roles: string[]; max_weekly_hours: number }>()
  for (const e of employees ?? []) empById.set(e.id, e)

  // ── Deterministic, custom-availability-aware hard-rule validation ───────────
  // The LLM pass below is kept ONLY for soft/fairness warnings. Every hard rule
  // — qualification, availability, CUSTOM availability, approved time off, max
  // weekly hours, overlapping double-booking, never-together pairs — is computed
  // here so nothing can be silently missed. (The prior LLM-only path never even
  // loaded custom availability and approved an impossible swap.)
  const employeesById = new Map<string, ValidatorEmployee>()
  for (const e of employees ?? []) {
    employeesById.set(e.id, {
      id: e.id,
      name: e.name,
      qualified_roles: (e.qualified_roles as string[]) ?? [],
      max_weekly_hours: (e.max_weekly_hours as number) ?? 0,
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
  const deterministicIssues: ScheduleEditIssue[] = validateScheduleEdit({
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
    timeOff: (timeOff ?? []).map(t => ({ employee_id: t.employee_id, start_date: t.start_date, end_date: t.end_date })),
    conflicts: (conflicts ?? []).map(c => ({ employee_id_1: c.employee_id_1, employee_id_2: c.employee_id_2, severity: c.severity })),
  })
  const hasHardError = deterministicIssues.some(i => i.severity === 'error')

  // Compute proposed weekly hours per employee
  const proposedHoursByEmployee: Record<string, number> = {}
  for (const a of proposed_assignments) {
    proposedHoursByEmployee[a.employee_id] = (proposedHoursByEmployee[a.employee_id] ?? 0) + (a.hours ?? 0)
  }

  // Build per-day, per-shift staff list to detect conflict pair violations
  const staffByCell: Record<string, string[]> = {}
  for (const a of proposed_assignments) {
    const key = `${a.shift_name}||${a.date}`
    if (!staffByCell[key]) staffByCell[key] = []
    staffByCell[key].push(a.employee_id)
  }

  // Touched-employee context lines
  const employeeContext = touchedEmployeeIds.map(id => {
    const e = empById.get(id)
    if (!e) return `- ${id}: (employee not found)`
    const avail = (availability ?? []).filter(a => a.employee_id === id)
    const availStr = avail.length === 0
      ? 'no availability on file'
      : avail.map(a => `${DAY_NAMES[a.day_of_week]} ${a.start_time}-${a.end_time}`).join(', ')
    const tos = (timeOff ?? []).filter(t => t.employee_id === id)
    const toStr = tos.length === 0
      ? 'no approved time off'
      : tos.map(t => `${t.start_date}–${t.end_date}`).join(', ')
    const totalHours = proposedHoursByEmployee[id] ?? 0
    return `- ${e.name} (id ${id}):
    primary_role=${e.primary_role}; qualified_roles=[${e.qualified_roles?.join(', ') ?? ''}]
    max_weekly_hours=${e.max_weekly_hours}; proposed total=${totalHours.toFixed(1)}h
    availability=${availStr}
    approved_time_off=${toStr}`
  }).join('\n')

  // Conflict pair context
  const pairs = (conflicts ?? []).map(c => {
    const a = empById.get(c.employee_id_1)
    const b = empById.get(c.employee_id_2)
    return `- ${a?.name ?? c.employee_id_1} / ${b?.name ?? c.employee_id_2} — severity=${c.severity}; reason=${c.reason ?? '—'}`
  }).join('\n') || '  (none)'

  // Cell co-staffing summary for changed cells only
  const changedCellKeys = new Set<string>()
  for (const c of changes) {
    if (c.from) changedCellKeys.add(`${c.from.shift_name}||${c.from.date}`)
    if (c.to) changedCellKeys.add(`${c.to.shift_name}||${c.to.date}`)
  }
  const cellStaffing = Array.from(changedCellKeys).map(key => {
    const ids = staffByCell[key] ?? []
    const names = ids.map(id => empById.get(id)?.name ?? id)
    return `  - ${key.replace('||', ' on ')}: ${names.length === 0 ? '(empty)' : names.join(', ')}`
  }).join('\n') || '  (none)'

  const systemPrompt = `You are Soteria, the scheduling compliance reviewer for ${company?.name ?? 'this company'}. A manager has manually edited the schedule. Review the proposed changes against availability, qualifications, conflicts, time-off, and policies. Flag every real issue, but do not invent issues that the data does not support. Return ONLY valid JSON.`

  const userMessage = `Schedule week: ${schedule?.week_start ?? '?'} – ${schedule?.week_end ?? '?'}

CHANGES (${changes.length}):
${changes.map(changeLine).join('\n') || '(none)'}

EMPLOYEE CONTEXT:
${employeeContext || '(no touched employees)'}

EMPLOYEE CONFLICT PAIRS:
${pairs}

CO-STAFFING IN AFFECTED CELLS (after changes apply):
${cellStaffing}

COMPANY POLICIES:
${(policies ?? []).map(p => `  - ${p.policy_key}: ${p.policy_value}${p.description ? ` (${p.description})` : ''}`).join('\n') || '  (none)'}

For every issue, classify severity:
  - "error": qualification mismatch, approved time-off conflict, "never together" pair both staffed, employee has no availability for that day, exceeds max_weekly_hours
  - "warning": coverage drop concerns, fairness issues, fatigue/back-to-back concerns, "avoid" pair both staffed, going over hours preference

Return JSON with this exact shape:
{
  "issues": [
    {
      "severity": "error" | "warning",
      "employee_name": "Name",
      "description": "What's wrong, in one sentence.",
      "suggestion": "Concrete fix suggestion, or null if none."
    }
  ],
  "summary": "One-sentence overall verdict.",
  "approved": true if there are no errors (warnings are OK), false if there is at least one error
}

If there are no issues at all, return issues: [], approved: true, and a positive one-sentence summary.`

  // Soft warnings only from the LLM (fairness, fatigue, coverage drops). It is
  // NEVER the source of truth for errors — those are the deterministic checks
  // above. If the model is unavailable, we still return the deterministic verdict.
  let llmWarnings: SoteraIssue[] = []
  let llmSummary = ''
  try {
    const message = await withAnthropicRetry(() =>
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: userMessage }],
        system: systemPrompt,
=======
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
      supabase.from('custom_availability')
        .select('id, employee_id, company_id, type, end_date, cycle_weeks, cycle_start_date, patterns, active, created_at')
        .eq('company_id', company_id)
        .eq('active', true)
        .in('employee_id', touchedEmployeeIds.length > 0 ? touchedEmployeeIds : noTouch),
      supabase.from('time_off_requests')
        .select('employee_id, start_date, end_date, status')
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
>>>>>>> Stashed changes
      })
    }
<<<<<<< Updated upstream
    if (typeof parsed.summary === 'string') llmSummary = parsed.summary
  } catch (llmErr) {
    console.warn('[soteria] soft-warning pass unavailable:', llmErr)
  }

  const mappedHard: SoteraIssue[] = deterministicIssues.map(i => ({
    severity: i.severity,
    employee_name: i.employee_name,
    description: i.description,
    suggestion: i.suggestion,
  }))
  const errorCount = mappedHard.filter(i => i.severity === 'error').length
  const result: SoteriaResponse = {
    issues: [...mappedHard, ...llmWarnings],
    approved: !hasHardError,
    summary: hasHardError
      ? `${errorCount} blocking issue${errorCount === 1 ? '' : 's'} must be fixed before publishing.`
      : (llmSummary || (llmWarnings.length > 0 ? 'No blocking issues — a few things worth a look.' : 'Looks good — no issues found.')),
  }
=======

    const availByEmp = new Map<string, ValidatorAvailability[]>()
    for (const av of availability ?? []) {
      const list = availByEmp.get(av.employee_id) ?? []
      list.push({ day_of_week: av.day_of_week, start_time: av.start_time, end_time: av.end_time })
      availByEmp.set(av.employee_id, list)
    }
>>>>>>> Stashed changes

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
      timeOff: (timeOff ?? []).map(t => ({ employee_id: t.employee_id, start_date: t.start_date, end_date: t.end_date })),
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
