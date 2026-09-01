import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { decideSwapRequest, type SwapDecision } from '@/lib/swaps/decide'

// S-1 stage 1 (2026-09-01): the swap load + the activity_log write inside
// decideSwapRequest() now both run on the caller's own session-authenticated
// client (cookie-based, anon key) instead of the service-role key. The
// hand-written company check below is unchanged and still runs; RLS's own
// company-scoped policies on swap_requests/employees/activity_log are now a
// second, independent backstop under it. Aegis remains authoritative for the
// swap_requests.status write itself — this route never touches it.

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    swapRequestId?: string
    decision?: string
  } | null

  const swapRequestId = body?.swapRequestId
  const decision = body?.decision
  if (!swapRequestId || (decision !== 'approved' && decision !== 'denied')) {
    return NextResponse.json(
      { ok: false, message: 'Need a swapRequestId and a decision of "approved" or "denied".' },
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

  // ── Load the swap for company scoping + display context ──────────────────
  // `*` rather than a column list ON PURPOSE. L4b needs `kind` /
  // `target_shift_*`, which migration 023 adds — naming them explicitly would
  // make this route throw 42703 (column does not exist) on any deploy that lands
  // before Alexander runs the SQL. With `*` the fields are simply absent until
  // then and the copy falls back to the neutral "swap" wording.
  const { data: reqRow, error: reqErr } = await ssr
    .from('swap_requests')
    .select(`
      *,
      requesting_employee:employees!swap_requests_requesting_employee_fkey(name),
      receiving_employee:employees!swap_requests_receiving_employee_fkey(name)
    `)
    .eq('id', swapRequestId)
    .maybeSingle()
  if (reqErr) {
    return NextResponse.json({ ok: false, message: `Couldn't load that swap: ${reqErr.message}` }, { status: 500 })
  }
  if (!reqRow) {
    return NextResponse.json({ ok: false, message: 'That swap no longer exists — it may have been cancelled.' }, { status: 404 })
  }
  const reqData = reqRow as unknown as {
    company_id: string
    shift_date: string | null
    status: string
    // L4b, migration 023. Optional: absent on a pre-migration database.
    kind?: string | null
    target_shift_date?: string | null
    target_shift_name?: string | null
    requesting_employee: { name: string } | { name: string }[] | null
    receiving_employee: { name: string } | { name: string }[] | null
  }
  // A manager may only decide swaps inside their own company.
  if (reqData.company_id !== actor.company_id) {
    return NextResponse.json({ ok: false, message: 'That swap belongs to a different company.' }, { status: 403 })
  }
  const requester = Array.isArray(reqData.requesting_employee) ? reqData.requesting_employee[0] : reqData.requesting_employee
  const receiver = Array.isArray(reqData.receiving_employee) ? reqData.receiving_employee[0] : reqData.receiving_employee

  const result = await decideSwapRequest({
    supabase: ssr,
    swapRequestId,
    decision: decision as SwapDecision,
    companyId: actor.company_id,
    decidedBy: { userId: user.id, email: actor.email ?? user.email ?? null },
    requesterName: requester?.name,
    receiverName: receiver?.name,
    shiftDate: reqData.shift_date,
    actorName: actor.name,
    actorAvatarUrl: actor.avatar_url,
    swapKind: reqData.kind ?? null,
    targetShiftDate: reqData.target_shift_date ?? null,
    targetShiftName: reqData.target_shift_name ?? null,
  })

  // 409 when the swap was already decided (no change made); 200 on success; 400 otherwise.
  return NextResponse.json(result, { status: result.ok ? 200 : result.alreadyDecided ? 409 : 400 })
}
