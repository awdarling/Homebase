import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

// Same privilege ladder as create-user / revoke-user.
const ROLE_RANK: Record<string, number> = { quria: 3, owner: 2, manager: 1 }

// Change a Homebase login's role. Found 2026-08-24 while designating Watermark's
// owner: the Access page wrote `users.role` straight from the browser, and the
// only UPDATE policy on `users` is "your own row" — so every role change by
// Quria or an owner silently updated zero rows. The page reloaded, nothing
// changed, no error. This route mirrors revoke-user: caller verified from their
// own session, target and new role both rank strictly below the caller, owners
// stay inside their own company, write logged to activity_log.
//
// S-1 stage 2 (2026-09-05): moved off the service-role key onto the caller's
// own session client. The RLS policy "Owners and quria can update lower-
// ranked users" (added the same day) now backstops every hand-written check
// below at the database layer — this route's checks are unchanged, they just
// stopped being the only thing enforcing this.
export async function POST(req: NextRequest) {
  let body: { user_id?: string; role?: string }
  try {
    body = (await req.json()) as { user_id?: string; role?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { user_id, role } = body

  const ssr = await createServerSupabase()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: callerRow } = await ssr
    .from('users')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  const caller = callerRow as { role: string; company_id: string } | null
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (caller.role !== 'owner' && caller.role !== 'quria') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!user_id || typeof user_id !== 'string') {
    return NextResponse.json({ error: 'user_id is required.' }, { status: 400 })
  }
  if (!role || !ROLE_RANK[role]) {
    return NextResponse.json({ error: 'role must be quria, owner, or manager.' }, { status: 400 })
  }
  if (user_id === user.id) {
    return NextResponse.json({ error: "You can't change your own role." }, { status: 400 })
  }

  const { data: targetRow } = await ssr
    .from('users')
    .select('id, name, role, company_id')
    .eq('id', user_id)
    .single()
  const target = targetRow as { id: string; name: string | null; role: string; company_id: string } | null
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 })

  // Both the target's current role AND the new role must rank strictly below the caller.
  const callerRank = ROLE_RANK[caller.role] ?? 0
  if ((ROLE_RANK[target.role] ?? 0) >= callerRank || ROLE_RANK[role] >= callerRank) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (caller.role === 'owner' && target.company_id !== caller.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (target.role === role) return NextResponse.json({ success: true, role })

  // On the session client (ssr) — the "Owners and quria can update lower-
  // ranked users" RLS policy backstops this write. `.select().single()`
  // doubles as a matched-row-count check (F7): zero rows matched errors
  // instead of silently reporting success (the exact failure mode that made
  // this route necessary in the first place, back when the Access page wrote
  // straight from the browser).
  const { data: updated, error: updErr } = await ssr
    .from('users')
    .update({ role })
    .eq('id', user_id)
    .select('id')
    .single()
  if (updErr || !updated) {
    console.error(`[update-user-role] update did not match exactly one row for target ${user_id}:`, updErr?.message)
    return NextResponse.json({ error: 'Could not change the role. Please try again.' }, { status: 500 })
  }

  await ssr.from('activity_log').insert({
    company_id: target.company_id,
    actor: caller.role === 'quria' ? 'quria_admin' : 'manager',
    action: 'homebase_role_changed',
    entity_type: 'user',
    entity_id: user_id,
    summary: `${target.name ?? 'A login'} changed from ${target.role} to ${role}`,
    metadata: { from: target.role, to: role },
  })

  return NextResponse.json({ success: true, role })
}
