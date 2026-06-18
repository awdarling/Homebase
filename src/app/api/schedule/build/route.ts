import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { postToAegisInternal, AegisInternalError, AegisInternalConfigError } from '@/lib/aegis-internal'

/**
 * Build a schedule from the Homebase site (DEV_ROADMAP item 9).
 *
 * A logged-in manager/owner (or quria) asks Aegis to build a fresh DRAFT
 * schedule for the target week, reusing the same engine core as the email
 * "build the schedule" command. The schedule is saved as a draft; the manager
 * then reviews/edits and clicks Publish separately.
 *
 * Body: { targetWeek?: 'this' | 'next', veteranPreference?: string, companyId?: string }
 *   - targetWeek defaults to 'next' (the common case: build next week).
 *   - companyId is only honored for quria (cross-company); everyone else builds
 *     for their own company.
 *
 * The build itself writes the `schedule_built` activity_log entry on the Aegis
 * side, so there's no duplicate log here.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    targetWeek?: 'this' | 'next'
    veteranPreference?: string
    companyId?: string
  }

  // ── Authz gate ──
  const ssr = await createServerSupabase()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: callerRow } = await ssr
    .from('users')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  const caller = callerRow as { role: string; company_id: string } | null
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const isQuria = caller.role === 'quria'
  if (!['manager', 'owner', 'quria'].includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Company binding: quria may target any company; everyone else is forced to
  // their own (the body cannot override it).
  const companyId = isQuria && body.companyId ? body.companyId : caller.company_id
  if (!companyId) {
    return NextResponse.json({ error: 'No company to build for.' }, { status: 400 })
  }

  const targetWeek: 'this' | 'next' = body.targetWeek === 'this' ? 'this' : 'next'

  try {
    const result = await postToAegisInternal<{
      ok: boolean
      schedule_id?: string
      week_start?: string
      week_end?: string
      total_filled?: number
      total_required?: number
      gaps?: number
      reason?: string
      error?: string
    }>('/internal/build-schedule', {
      company_id: companyId,
      target_week: targetWeek,
      ...(body.veteranPreference ? { veteran_preference: body.veteranPreference } : {}),
    })

    if (!result.ok) {
      const msg = result.reason === 'no_shift_types'
        ? 'No active shift types are set up for this company. Add shift types and shift requirements in Scheduling before building.'
        : `The build could not be saved: ${result.error ?? 'unknown error'}.`
      return NextResponse.json({ error: msg }, { status: 422 })
    }

    return NextResponse.json({
      success: true,
      scheduleId: result.schedule_id,
      weekStart: result.week_start,
      weekEnd: result.week_end,
      totalFilled: result.total_filled,
      totalRequired: result.total_required,
      gaps: result.gaps,
    })
  } catch (err) {
    const detail = err instanceof AegisInternalConfigError || err instanceof AegisInternalError
      ? err.message
      : err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json(
      { error: `Could not reach the schedule builder: ${detail}` },
      { status: 502 },
    )
  }
}
