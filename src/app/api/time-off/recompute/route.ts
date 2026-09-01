import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import {
  postToAegisInternal,
  AegisInternalError,
  AegisInternalConfigError,
} from '@/lib/aegis-internal'

// TO-RERUN-1: re-run the Aegis coverage check + recommendation for a time-off
// request against CURRENT approvals (see TO-REC-STALE). Read-only w.r.t. the
// decision — Aegis only rewrites aegis_recommendation / aegis_reasoning. Auth is
// the same cookie-session + company-scope gate as /api/time-off-decision.
//
// S-1 stage 1 (2026-09-01): the lookup below runs on the caller's own
// session-authenticated client instead of the service-role key. The
// hand-written company check is unchanged and still runs; a foreign-company
// row is now also invisible to the query itself (RLS), so the request
// simply won't be found — a second, independent backstop under the check.

type RecomputeResponse = {
  ok?: boolean
  status?: 'recomputed' | 'skipped_no_requirements' | 'not_found'
  recommendation?: 'approve' | 'deny'
  coverage_gap_count?: number
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { timeOffRequestId?: string } | null
  const timeOffRequestId = body?.timeOffRequestId
  if (!timeOffRequestId) {
    return NextResponse.json({ ok: false, message: 'Need a timeOffRequestId.' }, { status: 400 })
  }

  // ── Auth: identify the acting manager from the cookie session ────────────
  const ssr = await createServerSupabase()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, message: 'You need to be signed in to do that.' }, { status: 401 })
  }
  const { data: userRow } = await ssr
    .from('users')
    .select('company_id')
    .eq('id', user.id)
    .single()
  if (!userRow) {
    return NextResponse.json({ ok: false, message: 'No Homebase account is linked to this login.' }, { status: 403 })
  }
  const actor = userRow as { company_id: string }

  // ── Company-scope the request ────────────────────────────────────────────
  const { data: reqRow, error: reqErr } = await ssr
    .from('time_off_requests')
    .select('id, company_id')
    .eq('id', timeOffRequestId)
    .maybeSingle()
  if (reqErr) {
    return NextResponse.json({ ok: false, message: `Couldn't load that request: ${reqErr.message}` }, { status: 500 })
  }
  if (!reqRow) {
    return NextResponse.json({ ok: false, message: 'That request no longer exists.' }, { status: 404 })
  }
  if ((reqRow as { company_id: string }).company_id !== actor.company_id) {
    return NextResponse.json({ ok: false, message: 'That request belongs to a different company.' }, { status: 403 })
  }

  // ── Recompute via the Aegis internal bridge ──────────────────────────────
  try {
    const result = await postToAegisInternal<RecomputeResponse>(
      '/internal/recompute-to-recommendation',
      { time_off_request_id: timeOffRequestId },
    )

    if (result.status === 'skipped_no_requirements') {
      return NextResponse.json({
        ok: true,
        message: "Re-checked, but there's no shift schedule set up to measure coverage against, so the recommendation is unchanged.",
      })
    }

    const verb = result.recommendation === 'approve' ? 'Approve' : "Don't approve"
    const gaps = result.coverage_gap_count ?? 0
    const gapNote =
      result.recommendation === 'deny' && gaps > 0
        ? ` (${gaps} coverage gap${gaps === 1 ? '' : 's'} if approved now)`
        : ''
    return NextResponse.json({
      ok: true,
      message: `Re-checked against everything currently approved — Aegis now recommends: ${verb}${gapNote}.`,
    })
  } catch (err) {
    if (err instanceof AegisInternalConfigError) {
      return NextResponse.json({ ok: false, message: 'Re-check is not configured on this deployment yet.' }, { status: 500 })
    }
    if (err instanceof AegisInternalError) {
      return NextResponse.json({ ok: false, message: `Aegis could not re-check that request (${err.status}).` }, { status: 502 })
    }
    return NextResponse.json({ ok: false, message: 'Something went wrong re-checking that request.' }, { status: 500 })
  }
}
