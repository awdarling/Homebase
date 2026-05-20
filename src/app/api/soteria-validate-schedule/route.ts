import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { withAnthropicRetry } from '@/lib/anthropic-retry'
import type { ScheduleAssignment } from '@/lib/types'

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

  // Distinct employee_ids that appear in any change
  const touchedEmployeeIds = Array.from(new Set(
    changes.flatMap(c => c.employee_id ? [c.employee_id] : [])
  ))

  const [
    { data: company },
    { data: employees },
    { data: availability },
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
    supabase.from('time_off_requests')
      .select('employee_id, start_date, end_date, status')
      .eq('company_id', company_id)
      .eq('status', 'approved'),
    supabase.from('employee_conflicts')
      .select('employee_id_1, employee_id_2, severity, reason')
      .eq('company_id', company_id),
    supabase.from('policies').select('policy_key, policy_value, description').eq('company_id', company_id),
    supabase.from('schedules').select('week_start, week_end').eq('id', schedule_id).single(),
  ])

  const empById = new Map<string, { id: string; name: string; primary_role: string; qualified_roles: string[]; max_weekly_hours: number }>()
  for (const e of employees ?? []) empById.set(e.id, e)

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

  const message = await withAnthropicRetry(() =>
    anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
    })
  )

  const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''

  let result: SoteriaResponse
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    result = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
    if (!Array.isArray(result.issues)) result.issues = []
    if (typeof result.approved !== 'boolean') {
      result.approved = !result.issues.some(i => i.severity === 'error')
    }
    if (typeof result.summary !== 'string') result.summary = 'Soteria reviewed the changes.'
  } catch {
    result = {
      issues: [],
      summary: 'Soteria could not parse a structured response. Manual review recommended.',
      approved: true,
    }
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
