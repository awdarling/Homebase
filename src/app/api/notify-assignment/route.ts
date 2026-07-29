import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { sendTelnyxSms } from '@/lib/sms/telnyx'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { employee_id, shift_name, role, date, start_time, end_time, company_id } = body as {
    employee_id: string
    shift_name: string
    role: string
    date: string
    start_time: string
    end_time: string
    company_id: string
  }

  // ── Auth check ──────────────────────────────────────────────────────────
  // Notifications must always be authorized by a manager in the requesting
  // company. Without this gate, anyone could send arbitrary employee
  // assignment texts. See notify-warning safety guard (Phase 2).
  const ssr = await createServerSupabase()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data: userRow } = await ssr
    .from('users')
    .select('company_id, email')
    .eq('id', user.id)
    .single()
  const userRecord = userRow as { company_id: string; email: string | null } | null
  if (!userRecord || userRecord.company_id !== company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const approvedById = user.id
  const approvedByEmail = userRecord.email ?? null

  // Load employee
  const { data: employee } = await supabase
    .from('employees')
    .select('name, contact_phone')
    .eq('id', employee_id)
    .single()

  if (!employee?.contact_phone) {
    return NextResponse.json({ success: false, message: 'Employee has no phone number on file' })
  }

  // Resolve this tenant's OWN Telnyx sending number from config
  // (company_channels.channel_value, channel_type='sms'). No global fallback —
  // each company sends from its own number.
  const { data: channelData } = await supabase
    .from('company_channels')
    .select('channel_value')
    .eq('company_id', company_id)
    .eq('channel_type', 'sms')
    .limit(1)
    .maybeSingle()

  const fromNumber = (channelData as { channel_value?: string } | null)?.channel_value ?? ''

  // Format the date nicely
  const [y, mo, da] = date.split('-').map(Number)
  const dateStr = new Date(y, mo - 1, da).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  const message = `Hi ${employee.name}, you've been added to the ${shift_name} shift (${role}, ${start_time}–${end_time}) on ${dateStr} by your manager. See you then!`

  // Not configured (no Telnyx API key, or the tenant has no SMS number): skip
  // gracefully and log it, exactly as before.
  if (!process.env.TELNYX_API_KEY || !fromNumber) {
    await supabase.from('activity_log').insert({
      company_id,
      actor: 'manager',
      action: 'assignment_notification_skipped',
      entity_type: 'employee',
      entity_id: employee_id,
      summary: `SMS notification skipped for ${employee.name} — Telnyx not configured for this company`,
      metadata: {
        shift_name, role, date,
        approved_by: approvedById,
        approved_by_email: approvedByEmail,
      },
    })
    return NextResponse.json({ success: false, message: 'Telnyx not configured for this company' })
  }

  const result = await sendTelnyxSms({
    from: fromNumber,
    to: employee.contact_phone,
    text: message,
  })

  await supabase.from('activity_log').insert({
    company_id,
    actor: 'manager',
    action: result.ok ? 'assignment_notification_sent' : 'assignment_notification_failed',
    entity_type: 'employee',
    entity_id: employee_id,
    summary: result.ok
      ? `SMS sent to ${employee.name}: ${shift_name} (${role}) on ${date}`
      : `SMS failed for ${employee.name}: ${result.error ?? 'Unknown Telnyx error'}`,
    metadata: {
      shift_name, role, date,
      telnyx_id: result.id ?? null,
      approved_by: approvedById,
      approved_by_email: approvedByEmail,
    },
  })

  return NextResponse.json({
    success: result.ok,
    message: result.ok ? 'SMS sent successfully' : `Telnyx error: ${result.error ?? 'Unknown'}`,
  })
}
