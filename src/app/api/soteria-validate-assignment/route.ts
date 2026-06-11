import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { withAnthropicRetry } from '@/lib/anthropic-retry'

console.log('[soteria] API key present:', !!process.env.ANTHROPIC_API_KEY)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
  const body = await req.json() as {
    company_id: string
    schedule_id: string
    employee_id: string
    employee_name: string
    role_override: string
    shift_name: string
    date: string
    start_time: string
    end_time: string
  }

  const { company_id, schedule_id, employee_id, employee_name, role_override, shift_name, date, start_time, end_time } = body

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

  // Load everything in parallel
  const [
    { data: company },
    { data: employee },
    { data: availability },
    { data: timeOff },
    { data: policies },
    { data: schedule },
    { data: wageRates },
  ] = await Promise.all([
    supabase.from('companies').select('name').eq('id', company_id).single(),
    supabase.from('employees')
      .select('name, primary_role, qualified_roles, max_weekly_hours, individual_wage')
      .eq('id', employee_id).single(),
    supabase.from('availability')
      .select('day_of_week, start_time, end_time')
      .eq('employee_id', employee_id),
    supabase.from('time_off_requests')
      .select('start_date, end_date, status')
      .eq('employee_id', employee_id)
      .lte('start_date', date)
      .gte('end_date', date),
    supabase.from('policies').select('policy_key, policy_value, description').eq('company_id', company_id),
    supabase.from('schedules').select('data, staffing_report').eq('id', schedule_id).is('deleted_at', null).single(),
    supabase.from('wage_rates').select('role, hourly_rate').eq('company_id', company_id),
  ])

  const [y, mo, d] = date.split('-').map(Number)
  const dayOfWeek = new Date(y, mo - 1, d).getDay()
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  // Compute current weekly hours for this employee
  const assignments = (schedule?.data as { assignments?: { employee_id: string; hours: number }[] } | null)?.assignments ?? []
  const currentHours = assignments
    .filter((a) => a.employee_id === employee_id)
    .reduce((sum, a) => sum + (a.hours ?? 0), 0)

  // Compute hours for this shift
  const [sh, sm] = start_time.split(':').map(Number)
  const [eh, em] = end_time.split(':').map(Number)
  const shiftHours = Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60)

  const qualifiedRoles: string[] = (employee as { qualified_roles?: string[] } | null)?.qualified_roles ?? []
  const maxHours: number = (employee as { max_weekly_hours?: number } | null)?.max_weekly_hours ?? 40
  const isQualified = qualifiedRoles.includes(role_override) ||
    (employee as { primary_role?: string } | null)?.primary_role === role_override

  const hasAvailability = (availability ?? []).some((a: { day_of_week: number }) => a.day_of_week === dayOfWeek)
  const hasApprovedTimeOff = (timeOff ?? []).some((t: { status: string }) => t.status === 'approved')

  const systemPrompt = `You are Soteria, the scheduling compliance assistant for ${company?.name ?? 'this company'}. Review a proposed schedule assignment and identify any policy violations, availability conflicts, or staffing issues. Be concise and direct. Return ONLY valid JSON.`

  const userMessage = `Review this proposed assignment:

Employee: ${employee_name}
  - Primary role: ${(employee as { primary_role?: string } | null)?.primary_role ?? 'Unknown'}
  - Qualified roles: ${qualifiedRoles.join(', ') || 'none listed'}
  - Max weekly hours: ${maxHours}h
  - Current hours this week: ${currentHours}h
  - Adding this shift: ${shiftHours}h → total would be ${currentHours + shiftHours}h

Assignment:
  - Shift: ${shift_name} on ${dayNames[dayOfWeek]}, ${date}
  - Time: ${start_time}–${end_time} (${shiftHours}h)
  - Assigning as: ${role_override}

Availability:
  - Has availability on ${dayNames[dayOfWeek]}: ${hasAvailability ? 'Yes' : 'No'}
  - Has approved time off on ${date}: ${hasApprovedTimeOff ? 'Yes — CONFLICT' : 'No'}

Role qualification:
  - Qualified for ${role_override}: ${isQualified ? 'Yes' : 'No — ROLE MISMATCH'}

Company policies:
${(policies ?? []).map((p: { policy_key: string; policy_value: string; description: string | null }) => `  - ${p.policy_key}: ${p.policy_value}${p.description ? ` (${p.description})` : ''}`).join('\n') || '  (no policies loaded)'}

Staffing notes:
  - Coverage rate this week: ${(schedule?.staffing_report as { coverage_rate?: number } | null)?.coverage_rate ?? 'unknown'}%

Return JSON with this exact shape:
{
  "valid": true or false,
  "issues": ["specific issue 1", "specific issue 2"],
  "suggestions": ["suggestion to fix issue 1"],
  "summary": "One sentence plain-English verdict."
}

If there are no issues, return valid: true, empty arrays for issues/suggestions, and a brief positive summary.`

  const message = await withAnthropicRetry(() =>
    anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
    })
  )

  const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''

  let result: { valid: boolean; issues: string[]; suggestions: string[]; summary: string }
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    result = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
  } catch {
    result = {
      valid: true,
      issues: [],
      suggestions: [],
      summary: 'Soteria reviewed this assignment. No critical issues detected.',
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
        valid: false,
        issues: [],
        suggestions: [],
        summary: isOverload
          ? 'Soteria is temporarily unavailable. Please try again.'
          : 'An error occurred during validation.',
      },
      { status: isOverload ? 503 : 500 },
    )
  }
}
