import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { decideTimeOffRequest, type TimeOffDecision } from '@/lib/time-off/decide'

// Service-role client — the guarded decision write must bypass RLS, exactly as
// the magic-link dispatcher does. Auth is enforced separately via the cookie
// session below before any write happens.
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    timeOffRequestId?: string
    decision?: string
  } | null

  const timeOffRequestId = body?.timeOffRequestId
  const decision = body?.decision
  if (!timeOffRequestId || (decision !== 'approved' && decision !== 'denied')) {
    return NextResponse.json(
      { ok: false, message: 'Need a timeOffRequestId and a decision of "approved" or "denied".' },
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

  // ── Load the request for company scoping + message/display context ───────
  const { data: reqRow, error: reqErr } = await service
    .from('time_off_requests')
    .select('id, company_id, start_date, end_date, employee:employees(name)')
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
    start_date: string | null
    end_date: string | null
    employee: { name: string } | { name: string }[] | null
  }
  // A manager may only decide requests inside their own company.
  if (reqData.company_id !== actor.company_id) {
    return NextResponse.json({ ok: false, message: 'That request belongs to a different company.' }, { status: 403 })
  }
  const employee = Array.isArray(reqData.employee) ? reqData.employee[0] : reqData.employee

  const result = await decideTimeOffRequest({
    supabase: service,
    timeOffRequestId,
    decision: decision as TimeOffDecision,
    companyId: actor.company_id,
    decidedBy: { userId: user.id, email: actor.email ?? user.email ?? null },
    source: 'in_tab',
    employeeName: employee?.name,
    startDate: reqData.start_date,
    endDate: reqData.end_date,
    actorName: actor.name,
    actorAvatarUrl: actor.avatar_url,
  })

  // 409 when the row was already decided (no change made); 200 otherwise.
  return NextResponse.json(result, { status: result.ok ? 200 : result.alreadyDecided ? 409 : 400 })
}
