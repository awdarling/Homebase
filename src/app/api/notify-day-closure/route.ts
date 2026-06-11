import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import type { ScheduleAssignment, ScheduleData } from '@/lib/types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function formatDayDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })
}

export async function POST(req: NextRequest) {
  const aegisUrl = process.env.AEGIS_URL
  if (!aegisUrl) {
    return NextResponse.json({ error: 'Aegis not configured' }, { status: 500 })
  }

  const body = await req.json() as {
    scheduleId?: string
    date?: string
    companyId?: string
  }
  const { scheduleId, date, companyId } = body
  if (!scheduleId || !date || !companyId) {
    return NextResponse.json({ error: 'Missing scheduleId, date, or companyId' }, { status: 400 })
  }

  // ── Auth check ───────────────────────────────────────────────────────────
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
  if (!userRow || (userRow as { company_id: string }).company_id !== companyId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Load schedule + assignments for the closed date ──────────────────────
  const { data: scheduleRow, error: scheduleErr } = await supabase
    .from('schedules')
    .select('id, company_id, data')
    .eq('id', scheduleId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .single()

  if (scheduleErr || !scheduleRow) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }

  const scheduleData = (scheduleRow as { data: ScheduleData | null }).data
  const dayAssignments: ScheduleAssignment[] = (scheduleData?.assignments ?? [])
    .filter(a => a.date === date)

  if (dayAssignments.length === 0) {
    return NextResponse.json({ success: true, notified: 0 })
  }

  const employeeIds = Array.from(new Set(dayAssignments.map(a => a.employee_id)))

  // ── Employee contact info ────────────────────────────────────────────────
  const { data: employeeRows } = await supabase
    .from('employees')
    .select('id, name, contact_phone, contact_email')
    .in('id', employeeIds)

  const employees = (employeeRows ?? []) as Array<{
    id: string
    name: string
    contact_phone: string | null
    contact_email: string | null
  }>

  // ── Company name ─────────────────────────────────────────────────────────
  const { data: companyRow } = await supabase
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .single()
  const companyName = (companyRow as { name?: string } | null)?.name ?? 'your workplace'

  // ── Manager phone (for SMS From) ─────────────────────────────────────────
  const { data: managerRow } = await supabase
    .from('employees')
    .select('contact_phone')
    .eq('company_id', companyId)
    .eq('primary_role', 'Manager')
    .not('contact_phone', 'is', null)
    .limit(1)
    .maybeSingle()
  const managerPhone = (managerRow as { contact_phone?: string } | null)?.contact_phone ?? null

  // ── Manager email (for email From) ───────────────────────────────────────
  const { data: managerUser } = await supabase
    .from('users')
    .select('email')
    .eq('company_id', companyId)
    .in('role', ['owner', 'manager'])
    .limit(1)
    .maybeSingle()
  const managerEmail = (managerUser as { email?: string } | null)?.email ?? null

  const dateLabel = formatDayDate(date)

  // ── Group assignments by employee so we can mention shifts in the body ──
  const shiftsByEmployee = new Map<string, string[]>()
  for (const a of dayAssignments) {
    const list = shiftsByEmployee.get(a.employee_id) ?? []
    if (!list.includes(a.shift_name)) list.push(a.shift_name)
    shiftsByEmployee.set(a.employee_id, list)
  }

  let dispatched = 0
  const failures: string[] = []

  for (const emp of employees) {
    const shifts = shiftsByEmployee.get(emp.id) ?? []
    const shiftLabel = shifts.length === 0
      ? 'scheduled'
      : shifts.length === 1 ? shifts[0] : shifts.join(' and ')

    if (emp.contact_phone) {
      if (!managerPhone) {
        failures.push(`${emp.name} (no manager phone configured)`)
        continue
      }
      const sms = `Send this message to ${emp.name} at ${emp.contact_phone}: ${companyName} will be closed on ${dateLabel}. Your ${shiftLabel} shift has been cancelled. We'll see you for your next scheduled shift. — Aegis`
      const res = await fetch(`${aegisUrl}/webhooks/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: managerPhone, Body: sms }).toString(),
      })
      if (res.ok) {
        dispatched += 1
      } else {
        failures.push(`${emp.name} (sms ${res.status})`)
      }
      continue
    }

    if (emp.contact_email) {
      if (!managerEmail) {
        failures.push(`${emp.name} (no manager email configured)`)
        continue
      }
      const text = `Send this message to ${emp.name} at ${emp.contact_email}: ${companyName} will be closed on ${dateLabel}. Your ${shiftLabel} shift has been cancelled. We'll see you for your next scheduled shift. — Aegis`
      const res = await fetch(`${aegisUrl}/webhooks/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ from: managerEmail, text }).toString(),
      })
      if (res.ok) {
        dispatched += 1
      } else {
        failures.push(`${emp.name} (email ${res.status})`)
      }
      continue
    }

    failures.push(`${emp.name} (no phone or email on file)`)
  }

  await supabase.from('activity_log').insert({
    company_id: companyId,
    actor: 'system',
    action: 'closure_notifications_sent',
    entity_type: 'schedule',
    entity_id: scheduleId,
    summary: `Closure notifications sent to ${dispatched} employee${dispatched === 1 ? '' : 's'} for ${dateLabel}`,
    metadata: {
      date,
      dispatched,
      failures: failures.length > 0 ? failures : null,
      total_scheduled: employees.length,
    },
  })

  return NextResponse.json({
    success: true,
    notified: dispatched,
    failures: failures.length > 0 ? failures : undefined,
  })
}
