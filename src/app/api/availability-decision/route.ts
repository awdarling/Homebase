import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { decideAvailabilityChange, type AvailabilityDecision } from '@/lib/availability/decide'

// Service-role client — the row load + activity_log write bypass RLS, exactly as
// the time-off / swap in-tab routes do. Auth is enforced via the cookie session
// below before anything happens.
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    availabilityChangeRequestId?: string
    decision?: string
  } | null

  const availabilityChangeRequestId = body?.availabilityChangeRequestId
  const decision = body?.decision
  if (!availabilityChangeRequestId || (decision !== 'approved' && decision !== 'denied')) {
    return NextResponse.json(
      { ok: false, message: 'Need an availabilityChangeRequestId and a decision of "approved" or "denied".' },
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

  // ── Load the request for company scoping + display context ───────────────
  const { data: reqRow, error: reqErr } = await service
    .from('availability_change_requests')
    .select('id, company_id, employee_id, change_kind, status')
    .eq('id', availabilityChangeRequestId)
    .maybeSingle()
  if (reqErr) {
    return NextResponse.json({ ok: false, message: `Couldn't load that request: ${reqErr.message}` }, { status: 500 })
  }
  if (!reqRow) {
    return NextResponse.json({ ok: false, message: 'That request no longer exists — it may have been deleted.' }, { status: 404 })
  }
  const reqData = reqRow as unknown as {
    company_id: string
    employee_id: string
    change_kind: 'permanent' | 'date_limited' | 'rotating'
    status: string
  }
  // A manager may only decide requests inside their own company.
  if (reqData.company_id !== actor.company_id) {
    return NextResponse.json({ ok: false, message: 'That request belongs to a different company.' }, { status: 403 })
  }

  // Employee name for the manager-facing message (no FK-embed dependency).
  const { data: empRow } = await service
    .from('employees')
    .select('name')
    .eq('id', reqData.employee_id)
    .maybeSingle()
  const employeeName = (empRow as { name: string } | null)?.name

  const result = await decideAvailabilityChange({
    supabase: service,
    availabilityChangeRequestId,
    decision: decision as AvailabilityDecision,
    companyId: actor.company_id,
    decidedBy: { userId: user.id, email: actor.email ?? user.email ?? null, name: actor.name },
    employeeName,
    changeKind: reqData.change_kind,
    actorAvatarUrl: actor.avatar_url,
  })

  // 409 when the row was already decided (no change made); 200 on success; 400 otherwise.
  return NextResponse.json(result, { status: result.ok ? 200 : result.alreadyDecided ? 409 : 400 })
}
