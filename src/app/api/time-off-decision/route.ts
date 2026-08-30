import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { postToAegisInternal, AegisInternalConfigError, AegisInternalError } from '@/lib/aegis-internal'

// Service-role client — used only to load the request for the early
// company-scope check below (a friendlier 403 than waiting on Aegis). The
// decision write itself happens on the Aegis side.
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export type TimeOffTabAction = 'approve' | 'deny' | 'approve_and_cover'

// P2 (DRIFT §P2, 2026-08-30): the in-tab Time Off decision now lands in the
// SAME shared core as the email magic-link and the manager's texted reply
// (F13) — forwarded to Aegis's /internal/apply-time-off-decision, exactly as
// lib/aegis-actions/dispatcher.ts's handleTimeOffDecision does for the email
// door. Before this, `decideTimeOffRequest` (now retired) was a second,
// separate decision core that had never heard of a call-out: an in-tab
// approval never marked the shift on the schedule, never started coverage,
// and never retired a manager's parked text-reply state.
//
// Note what this route does NOT send: no `call_out` snapshot. The tab has no
// business knowing whether a request is a call-out just to decide it — Aegis
// resolves that itself, server-side, from the same to_thread:<id> side row
// the magic-link path already reads for threading. The browser only needs to
// know it FOR DISPLAY, to decide whether to show the third button (see
// TimeOffTab.tsx's separate, lightweight aegis_memory read for that).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    timeOffRequestId?: string
    action?: string
  } | null

  const timeOffRequestId = body?.timeOffRequestId
  const action = body?.action
  if (!timeOffRequestId || (action !== 'approve' && action !== 'deny' && action !== 'approve_and_cover')) {
    return NextResponse.json(
      { ok: false, message: 'Need a timeOffRequestId and an action of "approve", "deny" or "approve_and_cover".' },
      { status: 400 },
    )
  }

  // ── Auth: identify the acting manager from the cookie session ────────────
  const ssr = await createServerSupabase()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, message: 'You need to be signed in to do that.' }, { status: 401 })
  }
  const { data: userRow } = await ssr
    .from('users')
    .select('company_id, email, name, avatar_url')
    .eq('id', user.id)
    .single()
  if (!userRow) {
    return NextResponse.json({ ok: false, message: 'No Homebase account is linked to this login.' }, { status: 403 })
  }
  const actor = userRow as { company_id: string; email: string | null; name: string | null; avatar_url: string | null }

  // ── Load the request for an early, friendly company-scope check ──────────
  // (Aegis re-checks this itself with a company-bound lookup — this is only
  // so a foreign request reads as "belongs to a different company" instead
  // of the generic "couldn't find that request" Aegis would otherwise say.)
  const { data: reqRow, error: reqErr } = await service
    .from('time_off_requests')
    .select('id, company_id, employee:employees(name)')
    .eq('id', timeOffRequestId)
    .maybeSingle()
  if (reqErr) {
    return NextResponse.json({ ok: false, message: `Couldn't load that request: ${reqErr.message}` }, { status: 500 })
  }
  if (!reqRow) {
    return NextResponse.json({ ok: false, message: 'That request no longer exists — it may have been deleted.' }, { status: 404 })
  }
  const reqData = reqRow as unknown as {
    company_id: string
    employee: { name: string } | { name: string }[] | null
  }
  // A manager may only decide requests inside their own company.
  if (reqData.company_id !== actor.company_id) {
    return NextResponse.json({ ok: false, message: 'That request belongs to a different company.' }, { status: 403 })
  }
  const employee = Array.isArray(reqData.employee) ? reqData.employee[0] : reqData.employee
  const employeeName = employee?.name ?? 'the employee'

  try {
    const res = await postToAegisInternal<{ ok?: boolean; outcome?: string; message?: string }>(
      '/internal/apply-time-off-decision',
      {
        time_off_request_id: timeOffRequestId,
        action,
        company_id: actor.company_id,
        manager_user_id: user.id,
        manager_name: actor.name,
        manager_avatar_url: actor.avatar_url,
        source: 'in_tab',
      },
    )
    const ok = res.ok !== false
    const alreadyDecided = res.outcome === 'already_decided'
    return NextResponse.json(
      {
        ok,
        alreadyDecided,
        message: res.message ?? (ok
          ? `Done — ${employeeName} has been told.`
          : "That didn't go through. Please try again from the Time Off tab."),
      },
      { status: ok ? 200 : alreadyDecided ? 409 : 400 },
    )
  } catch (err) {
    if (err instanceof AegisInternalConfigError) {
      return NextResponse.json(
        { ok: false, message: 'Could not record the decision — the Aegis connection is not configured.' },
        { status: 500 },
      )
    }
    // A 403 is Aegis's revoked-manager refusal — its body carries the
    // manager-readable explanation; surface it rather than a generic error.
    if (err instanceof AegisInternalError && err.status === 403) {
      try {
        const parsed = JSON.parse(err.body) as { message?: string }
        if (parsed.message) {
          return NextResponse.json({ ok: false, message: parsed.message }, { status: 403 })
        }
      } catch { /* fall through to the generic line */ }
    }
    const errMsg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { ok: false, message: `Could not record that decision: ${errMsg}` },
      { status: 500 },
    )
  }
}
