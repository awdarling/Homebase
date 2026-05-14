import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  const { email, name, role, company_id } = await req.json() as {
    email: string
    name: string
    role: string
    company_id: string
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
    company_id,
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
