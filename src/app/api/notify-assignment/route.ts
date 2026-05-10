import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

  // Load employee
  const { data: employee } = await supabase
    .from('employees')
    .select('name, contact_phone')
    .eq('id', employee_id)
    .single()

  if (!employee?.contact_phone) {
    return NextResponse.json({ success: false, message: 'Employee has no phone number on file' })
  }

  // Try to load SMS from_number from company_channels, fall back to env var
  const { data: channelData } = await supabase
    .from('company_channels')
    .select('phone_number')
    .eq('company_id', company_id)
    .eq('channel_type', 'sms')
    .limit(1)
    .maybeSingle()

  const fromNumber = (channelData as { phone_number?: string } | null)?.phone_number
    ?? process.env.TWILIO_FROM_NUMBER
    ?? ''

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN

  // Format the date nicely
  const [y, mo, da] = date.split('-').map(Number)
  const dateStr = new Date(y, mo - 1, da).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  const message = `Hi ${employee.name}, you've been added to the ${shift_name} shift (${role}, ${start_time}–${end_time}) on ${dateStr} by your manager. See you then!`

  if (!accountSid || !authToken || !fromNumber) {
    await supabase.from('activity_log').insert({
      company_id,
      actor: 'system',
      action: 'assignment_notification_skipped',
      entity_type: 'employee',
      entity_id: employee_id,
      summary: `SMS notification skipped for ${employee.name} — Twilio not configured`,
      metadata: { shift_name, role, date },
    })
    return NextResponse.json({ success: false, message: 'Twilio credentials not configured' })
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

  const twilioRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: employee.contact_phone,
        From: fromNumber,
        Body: message,
      }).toString(),
    }
  )

  const twilioData = await twilioRes.json() as { sid?: string; message?: string }

  await supabase.from('activity_log').insert({
    company_id,
    actor: 'system',
    action: twilioRes.ok ? 'assignment_notification_sent' : 'assignment_notification_failed',
    entity_type: 'employee',
    entity_id: employee_id,
    summary: twilioRes.ok
      ? `SMS sent to ${employee.name}: ${shift_name} (${role}) on ${date}`
      : `SMS failed for ${employee.name}: ${twilioData.message ?? 'Unknown Twilio error'}`,
    metadata: { shift_name, role, date, twilio_sid: twilioData.sid ?? null },
  })

  return NextResponse.json({
    success: twilioRes.ok,
    message: twilioRes.ok ? 'SMS sent successfully' : `Twilio error: ${twilioData.message ?? 'Unknown'}`,
  })
}
