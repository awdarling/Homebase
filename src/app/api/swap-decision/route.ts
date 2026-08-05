import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { decideSwapRequest, type SwapDecision } from '@/lib/swaps/decide'

// Service-role client — the activity_log write + swap load bypass RLS, exactly
// as the time-off in-tab route does. Auth is enforced via the cookie session
// below before anything happens.
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

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
  const { data: reqRow, error: reqErr } = await service
    .from('swap_requests')
    .select(`
      id, company_id, shift_date, status,
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
    supabase: service,
    swapRequestId,
    decision: decision as SwapDecision,
    companyId: actor.company_id,
    decidedBy: { userId: user.id, email: actor.email ?? user.email ?? null },
    requesterName: requester?.name,
    receiverName: receiver?.name,
    shiftDate: reqData.shift_date,
    actorName: actor.name,
    actorAvatarUrl: actor.avatar_url,
  })

  // 409 when the swap was already decided (no change made); 200 on success; 400 otherwise.
  return NextResponse.json(result, { status: result.ok ? 200 : result.alreadyDecided ? 409 : 400 })
}
