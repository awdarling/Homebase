import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { postToAegisInternal, AegisInternalError, AegisInternalConfigError } from '@/lib/aegis-internal'

// Service-role client — only used for the tenancy/auth checks below. The
// notification fan-out itself is delegated to Aegis (which owns the roster).
const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/**
 * Notify the staff scheduled on a day the manager just closed (Batch-1 F8).
 *
 * The fan-out is delegated to Aegis's `/internal/notify-day-closure`, which loads
 * the day's roster and notifies every scheduled employee SMS-first + email
 * fallback. This replaces the previous approach, which POSTed a "Send this message
 * to <name>" body to Aegis's PUBLIC /webhooks/sms|email impersonating the manager
 * and relied on the intent classifier to deliver it — fragile, and rejected in
 * production by webhook signature verification, so "Close day" notified nobody.
 *
 * Body: { scheduleId: string, date: string (YYYY-MM-DD), companyId: string }
 */
export async function POST(req: NextRequest) {
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
    .select('company_id, role')
    .eq('id', user.id)
    .single()
  const caller = userRow as { company_id: string; role: string } | null
  // Quria admins may act cross-company; everyone else is bound to their tenant.
  if (!caller || (caller.role !== 'quria' && caller.company_id !== companyId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Delegate the fan-out to Aegis (owns roster + SMS-first notify) ─────────
  try {
    const result = await postToAegisInternal<{
      ok: boolean
      notified?: number
      total_scheduled?: number
      texted?: number
      emailed?: number
      failures?: string[]
    }>('/internal/notify-day-closure', {
      company_id: companyId,
      schedule_id: scheduleId,
      date,
    })

    await adminSupabase.from('activity_log').insert({
      company_id: companyId,
      actor: caller.role === 'quria' ? 'quria_admin' : 'manager',
      action: 'closure_notifications_triggered',
      entity_type: 'schedule',
      entity_id: scheduleId,
      summary: `Closure notifications requested for ${date} — Aegis notified ${result.notified ?? 0} of ${result.total_scheduled ?? 0} scheduled employee(s)`,
      metadata: { date, notified: result.notified ?? 0, total_scheduled: result.total_scheduled ?? 0, failures: result.failures ?? null },
    })

    return NextResponse.json({
      success: true,
      notified: result.notified ?? 0,
      total_scheduled: result.total_scheduled ?? 0,
      failures: result.failures && result.failures.length > 0 ? result.failures : undefined,
    })
  } catch (err) {
    const detail = err instanceof AegisInternalConfigError || err instanceof AegisInternalError
      ? err.message
      : err instanceof Error ? err.message : 'unknown error'
    // Surface the failure loudly (never silently notify nobody) but don't 500 —
    // the day is already closed; the manager can retry the notification.
    return NextResponse.json({
      success: false,
      error: `The day was closed, but closure notifications could not be sent: ${detail}. Please retry, or notify affected staff directly.`,
    }, { status: 502 })
  }
}
