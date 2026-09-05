import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

// Same privilege ladder as create-user. You can only act on someone strictly
// BELOW you: owner (2) can revoke manager (1); quria (3) can revoke owner/manager.
const ROLE_RANK: Record<string, number> = { quria: 3, owner: 2, manager: 1 }

// Revoke a Homebase user's access. Mirrors the create-user authz pattern, and
// marks the account revoked (keeping it) rather than deleting it — so sign-in
// can show a clear "access removed" message and the middleware locks them out
// of every page immediately.
//
// S-1 stage 2 (2026-09-05): moved off the service-role key onto the caller's
// own session client. The RLS policy "Owners and quria can update lower-
// ranked users" (added the same day) now backstops every hand-written check
// below at the database layer — this route's checks are unchanged, they just
// stopped being the only thing enforcing this.
export async function POST(req: NextRequest) {
  const { user_id } = (await req.json()) as { user_id: string }

  // 1. Caller must be signed in.
  const ssr = await createServerSupabase()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Load the caller's own role + company.
  const { data: callerRow } = await ssr
    .from('users')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  const caller = callerRow as { role: string; company_id: string } | null
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 3. Only owners and platform admins (quria) manage Homebase access.
  if (caller.role !== 'owner' && caller.role !== 'quria') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 4. Load the target.
  if (!user_id || typeof user_id !== 'string') {
    return NextResponse.json({ error: 'user_id is required.' }, { status: 400 })
  }
  if (user_id === user.id) {
    return NextResponse.json({ error: "You can't revoke your own access." }, { status: 400 })
  }
  const { data: targetRow } = await ssr
    .from('users')
    .select('id, role, company_id')
    .eq('id', user_id)
    .single()
  const target = targetRow as { id: string; role: string; company_id: string } | null
  if (!target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  }

  // 5. Hierarchy: the target must rank strictly below the caller.
  if ((ROLE_RANK[target.role] ?? 0) >= (ROLE_RANK[caller.role] ?? 0)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 6. Company binding: an owner can only revoke within their OWN company;
  //    a quria admin may revoke across companies.
  if (caller.role === 'owner' && target.company_id !== caller.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 7. Mark revoked, on the session client (ssr) — the "Owners and quria can
  //    update lower-ranked users" RLS policy now backstops this write
  //    independently of the checks above. Keep the account so sign-in can
  //    recognize them and show the friendly message; middleware enforces the
  //    lockout. `.select().single()` doubles as a matched-row-count check
  //    (F7): if RLS or a race condition means zero rows matched, this errors
  //    instead of silently reporting success.
  const { data: updated, error: updErr } = await ssr
    .from('users')
    .update({ access_revoked_at: new Date().toISOString() })
    .eq('id', user_id)
    .select('id')
    .single()
  if (updErr || !updated) {
    console.error(`[revoke-user] update did not match exactly one row for target ${user_id}:`, updErr?.message)
    return NextResponse.json({ error: 'Could not revoke access. Please try again.' }, { status: 500 })
  }

  await ssr.from('activity_log').insert({
    company_id: target.company_id,
    actor: caller.role === 'quria' ? 'quria_admin' : 'manager',
    action: 'homebase_access_revoked',
    entity_type: 'user',
    entity_id: user_id,
    summary: `Homebase access revoked for user ${user_id}`,
  })

  return NextResponse.json({ success: true })
}
