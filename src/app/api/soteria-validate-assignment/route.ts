import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

// SOTERIA-SCOPE-1 (2026-07-21): the LLM call was REMOVED. Its issues were already
// thrown away (the verdict was recomputed deterministically); only stray AI text
// could leak through. This single-cell pre-check is now purely deterministic.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
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

<<<<<<< Updated upstream
  return NextResponse.json(result)
=======
    const { company_id, schedule_id, employee_id, employee_name, role_override, shift_name, date, start_time, end_time } = body

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

    const [
      { data: employee },
      { data: availability },
      { data: timeOff },
      { data: schedule },
    ] = await Promise.all([
      supabase.from('employees')
        .select('name, primary_role, qualified_roles, max_weekly_hours')
        .eq('id', employee_id).single(),
      supabase.from('availability')
        .select('day_of_week, start_time, end_time')
        .eq('employee_id', employee_id),
      supabase.from('time_off_requests')
        .select('start_date, end_date, status')
        .eq('employee_id', employee_id)
        .lte('start_date', date)
        .gte('end_date', date),
      supabase.from('schedules')
        .select('data')
        .eq('id', schedule_id)
        .is('deleted_at', null)
        .single(),
    ])

    const [y, mo, d] = date.split('-').map(Number)
    const dayOfWeek = new Date(y, mo - 1, d).getDay()
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

    // Current weekly hours for this employee, from the schedule as it stands.
    const assignments = (schedule?.data as { assignments?: { employee_id: string; hours: number }[] } | null)?.assignments ?? []
    const currentHours = assignments
      .filter((a) => a.employee_id === employee_id)
      .reduce((sum, a) => sum + (a.hours ?? 0), 0)

    const [sh, sm] = start_time.split(':').map(Number)
    const [eh, em] = end_time.split(':').map(Number)
    const shiftHours = Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60)

    const qualifiedRoles: string[] = (employee as { qualified_roles?: string[] } | null)?.qualified_roles ?? []
    const maxHours: number = (employee as { max_weekly_hours?: number } | null)?.max_weekly_hours ?? 40
    const isQualified = qualifiedRoles.includes(role_override) ||
      (employee as { primary_role?: string } | null)?.primary_role === role_override

    const hasAvailability = (availability ?? []).some((a: { day_of_week: number }) => a.day_of_week === dayOfWeek)
    const hasApprovedTimeOff = (timeOff ?? []).some((t: { status: string }) => t.status === 'approved')

    // Deterministic hard rules only — no AI.
    const hardIssues: string[] = []
    if (hasApprovedTimeOff) hardIssues.push(`${employee_name} has approved time off on ${date}.`)
    if (!isQualified) hardIssues.push(`${employee_name} is not qualified for ${role_override}.`)
    if (!hasAvailability) hardIssues.push(`${employee_name} has no availability on file for ${dayNames[dayOfWeek]}.`)
    if (currentHours + shiftHours > maxHours) hardIssues.push(`This puts ${employee_name} at ${(currentHours + shiftHours).toFixed(1)}h this week, over their ${maxHours}h limit.`)

    const result = {
      valid: hardIssues.length === 0,
      issues: hardIssues,
      suggestions: [] as string[],
      summary: hardIssues.length === 0
        ? `Looks good — ${employee_name} can take ${shift_name} on ${date}.`
        : `${hardIssues.length} issue${hardIssues.length === 1 ? '' : 's'} with placing ${employee_name} on ${shift_name} (${date}).`,
    }

    return NextResponse.json(result)
>>>>>>> Stashed changes
  } catch (error) {
    console.error('[soteria] error:', error)
    return NextResponse.json(
      {
        error: 'Validation failed',
        valid: false,
        issues: [],
        suggestions: [],
        summary: 'An error occurred during validation.',
      },
      { status: 500 },
    )
  }
}
