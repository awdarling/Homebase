import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Privilege ladder for the role cap. The live `users.role` enum is
// 'quria' | 'owner' | 'manager' ('quria' is the platform admin). Note:
// 'quria_admin' is an activity-log ACTOR label, NOT a users.role value.
const ROLE_RANK: Record<string, number> = { quria: 3, owner: 2, manager: 1 }

export async function POST(req: NextRequest) {
  const { email, name, role, company_id } = await req.json() as {
    email: string
    name: string
    role: string
    company_id: string
  }

  // ── SEC-1 access control (all checks BEFORE any user creation, so a
  //    rejected request never leaves an orphaned auth user) ─────────────────
  // 1. Caller must be signed in.
  const ssr = await createServerSupabase()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Load the caller's own role + company from the users table.
  const { data: callerRow } = await ssr
    .from('users')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  const caller = callerRow as { role: string; company_id: string } | null
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 3. Only owners and platform admins (quria) may create users.
  if (caller.role !== 'owner' && caller.role !== 'quria') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 4. The requested role must be a real users.role and may not exceed the
  //    caller's own privilege level.
  const requestedRank = ROLE_RANK[role]
  if (!requestedRank) {
    return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
  }
  if (requestedRank > ROLE_RANK[caller.role]) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 5. Company binding: an owner can only create within their OWN company —
  //    any company_id in the body is ignored. A quria admin may target any
  //    company (taken from the body).
  let targetCompanyId: string
  if (caller.role === 'owner') {
    targetCompanyId = caller.company_id
  } else {
    // quria
    if (!company_id) {
      return NextResponse.json({ error: 'company_id is required.' }, { status: 400 })
    }
    targetCompanyId = company_id
  }

  const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: { name },
  })

  if (authError || !authData?.user) {
    return NextResponse.json(
      { error: authError?.message ?? 'Failed to create auth user.' },
      { status: 400 },
    )
  }

  const { error: insertError } = await adminSupabase.from('users').insert({
    id: authData.user.id,
    company_id: targetCompanyId,
    email,
    name,
    role,
  })

  if (insertError) {
    // Roll back the auth user so a failed insert doesn't leave an orphan
    // that would block re-adding the same email.
    await adminSupabase.auth.admin.deleteUser(authData.user.id)
    return NextResponse.json({ error: insertError.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
