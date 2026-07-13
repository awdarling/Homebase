import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { withAnthropicRetry } from '@/lib/anthropic-retry'
import type { ScheduleAssignment, CustomAvailability } from '@/lib/types'
import {
  validateScheduleEdit,
  type ScheduleEditIssue,
  type ValidatorAssignment,
  type ValidatorAvailability,
  type ValidatorEmployee,
} from '@/lib/soteria/validateScheduleEdit'

console.log('[soteria] API key present:', !!process.env.ANTHROPIC_API_KEY)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function changeLine(c: ScheduleChange): string {
  if (c.kind === 'moved' && c.from && c.to) {
    return `MOVED: ${c.employee_name} — ${c.from.shift_name} ${c.from.date} (${c.from.role}) → ${c.to.shift_name} ${c.to.date} (${c.to.role})`
  }
  if (c.kind === 'added' && c.to) {
    return `ADDED: ${c.employee_name} → ${c.to.shift_name} ${c.to.date} (${c.to.role})`
  }
  if (c.kind === 'removed' && c.from) {
    return `REMOVED: ${c.employee_name} from ${c.from.shift_name} ${c.from.date} (${c.from.role})`
  }
  return `${c.kind.toUpperCase()}: ${c.employee_name}`
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

  const systemPrompt = `You are Soteria, the scheduling reviewer for ${company?.name ?? 'this company'}. A manager manually edited the schedule. The system has ALREADY validated every HARD rule deterministically — qualification, availability (including custom availability), approved time off, max weekly hours, "never together" pairs, and double-booking. DO NOT re-check or report any of those, and NEVER assert a time-off, qualification, hours, availability, or pairing conflict — those are handled and authoritative elsewhere. Your ONLY job is to surface SOFT, judgment-based observations a manager may want to weigh: coverage thinning, fairness/rotation imbalance, fatigue or back-to-back shifts, and "avoid" (soft) pairings. If nothing soft stands out, return an empty list. Return ONLY valid JSON.`

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

Report ONLY soft observations, all at severity "warning" (never "error" — hard rules are the system's job, not yours): coverage thinning, fairness/rotation imbalance, fatigue/back-to-back, or "avoid" (soft) pairings. Do not restate hard-rule conflicts.

Return JSON with this exact shape:
{
  "issues": [
    {
      "severity": "warning",
      "employee_name": "Name",
      "description": "The soft concern, in one sentence.",
      "suggestion": "Optional concrete suggestion, or null."
    }
  ]
}

If nothing soft stands out, return issues: [].`

  // Soft warnings only from the LLM (fairness, fatigue, coverage drops). It is
  // NEVER the source of truth for errors — those are the deterministic checks
  // above. If the model is unavailable, we still return the deterministic verdict.
  let llmWarnings: SoteraIssue[] = []
  try {
    const message = await withAnthropicRetry(() =>
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: userMessage }],
        system: systemPrompt,
      })
    )
    const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as SoteriaResponse
    if (Array.isArray(parsed.issues)) {
      llmWarnings = parsed.issues
        .filter(i => i && i.severity === 'warning')
        .map(i => ({ severity: 'warning' as const, employee_name: i.employee_name, description: i.description, suggestion: i.suggestion ?? null }))
    }
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
    // Verdict + summary come ENTIRELY from the deterministic checks — never from the
    // LLM's free-form sentence, which can hallucinate a hard conflict (e.g. claim an
    // employee is on time off when they are not) and contradict a correct "all clear".
    summary: hasHardError
      ? `${errorCount} blocking issue${errorCount === 1 ? '' : 's'} must be fixed before publishing.`
      : (llmWarnings.length > 0
          ? 'No blocking rule conflicts — a few soft items worth a look.'
          : 'All clear — no rule conflicts found.'),
  }

  return NextResponse.json(result)
  } catch (error) {
    console.error('[soteria] error:', error)
    const status = error != null && typeof error === 'object' && 'status' in error
      ? (error as { status: number }).status
      : 500
    const isOverload = status === 529
    return NextResponse.json(
      {
        error: isOverload
          ? 'AI service temporarily overloaded. Please try again in a few seconds.'
          : 'Validation failed',
        approved: false,
        issues: [],
        summary: isOverload
          ? 'Soteria is temporarily unavailable. Please try again.'
          : 'An error occurred during validation.',
      },
      { status: isOverload ? 503 : 500 },
    )
  }
}
