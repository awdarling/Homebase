import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { postToAegisInternal } from '@/lib/aegis-internal'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type AegisAccess = 'manager' | 'employee' | 'blocked'
const VALID: AegisAccess[] = ['manager', 'employee', 'blocked']

// Set an employee's Aegis access level. Server-side so the role gate + company
// binding are actually enforced (not just hidden in the UI), and so that
// blocking someone can fire the "you've been removed" notice via Aegis.
// Managers, owners, and Quria admins may manage Aegis access for their company.
export async function POST(req: NextRequest) {
  const { employee_id, access } = (await req.json()) as { employee_id: string; access: AegisAccess }

  // 1. Caller signed in.
  const ssr = await createServerSupabase()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Caller role + company.
  const { data: callerRow } = await ssr
    .from('users')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  const caller = callerRow as { role: string; company_id: string } | null
  if (!caller || !['manager', 'owner', 'quria'].includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 3. Validate input.
  if (!employee_id || !VALID.includes(access)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  // 4. Load the target employee + enforce company binding (quria may cross).
  const { data: empRow } = await adminSupabase
    .from('employees')
    .select('id, name, company_id, aegis_access')
    .eq('id', employee_id)
    .single()
  const emp = empRow as { id: string; name: string; company_id: string; aegis_access: string | null } | null
  if (!emp) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 })
  }
  if (caller.role !== 'quria' && emp.company_id !== caller.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const wasBlocked = (emp.aegis_access ?? 'employee') === 'blocked'

  // 5. Apply the change.
  const { error: updErr } = await adminSupabase
    .from('employees')
    .update({ aegis_access: access })
    .eq('id', employee_id)
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 400 })
  }

  // 6. If this newly blocks them, let Aegis send the one-time heads-up. Best
  //    effort — the access change already succeeded, so a notify failure must
  //    not fail the request.
  if (access === 'blocked' && !wasBlocked) {
    try {
      await postToAegisInternal('/internal/notify-access-removed', {
        company_id: emp.company_id,
        employee_id: emp.id,
      })
    } catch (e) {
      console.error('notify-access-removed failed (access change still applied):', e)
    }
  }

  return NextResponse.json({ success: true })
}
