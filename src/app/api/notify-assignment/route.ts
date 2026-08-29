import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { postToAegisInternal, AegisInternalError, AegisInternalConfigError } from '@/lib/aegis-internal'

// Service-role client — only used for the delivery-failure audit entry below.
// The send itself (and its consent decision) is delegated to Aegis.
const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/**
 * Notify an employee that a manager assigned them to a shift (GapResolverPanel).
 *
 * S-4 (2026-08-28): this route used to send the SMS itself through Homebase's
 * own Telnyx client — the ONE door in the whole system that could text an
 * employee without passing Aegis's consent gate ("may we text this person?").
 * Dormant (held closed by EMAIL_ONLY on Vercel), but the door existed. It is
 * now a thin proxy, exactly like notify-day-closure: session → caller's
 * company → forward to Aegis `/internal/notify-assignment` with the internal
 * secret. Aegis binds the employee to the company, routes the notification
 * SMS-first through the consent gate (email fallback for anyone who hasn't
 * opted in), and writes the activity log. After this, exactly one function in
 * the system decides whether an employee may be texted (Rule 0b).
 *
 * Body: { employee_id, shift_name, role, date, start_time, end_time, company_id }
 * Response: { success: boolean, message: string } — the contract
 * GapResolverPanel has always consumed.
 */
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
  // Notifications must always be authorized by a signed-in user of the
  // requesting company. Without this gate, anyone could trigger arbitrary
  // employee assignment texts.
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

  // ── Delegate the send to Aegis (owns consent + channels + the audit log) ──
  try {
    const result = await postToAegisInternal<{ ok?: boolean; channel?: string; message?: string }>(
      '/internal/notify-assignment',
      {
        company_id,
        employee_id,
        shift_name,
        role,
        date,
        start_time,
        end_time,
        approved_by: user.id,
        approved_by_email: userRecord.email,
      },
    )
    return NextResponse.json({
      success: result.ok !== false,
      message: result.message ?? (result.ok !== false ? 'The employee has been notified.' : 'The employee could not be notified.'),
    })
  } catch (err) {
    const detail = err instanceof AegisInternalConfigError || err instanceof AegisInternalError
      ? err.message
      : err instanceof Error ? err.message : 'unknown error'
    await adminSupabase.from('activity_log').insert({
      company_id,
      actor: 'manager',
      action: 'notification_delivery_failed',
      entity_type: 'employee',
      entity_id: employee_id,
      summary: 'Assignment notification could not be delivered — the Aegis call failed',
      metadata: {
        aegis_endpoint: '/internal/notify-assignment',
        error: detail,
        shift_name, role, date,
        approved_by: user.id,
        approved_by_email: userRecord.email,
      },
    })
    return NextResponse.json({
      success: false,
      message: `The assignment was saved, but the notification could not be sent: ${detail}. Please let the employee know directly.`,
    })
  }
}
