import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { capabilityRoleFor } from '@/lib/soteria/capabilities'

// Read/curate surface for soteria_memory (D22 follow-on). Memory is SOFT
// conversational context only — no engine reads this table; it is injected into
// Soteria's own prompt to personalize her replies. This route lets a manager SEE
// and DELETE what she's remembered, closing the "nothing stored the manager can't
// see" gap. Actual scheduling rules live in policies/rules, not here.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Same guard as the Soteria executor: signed-in user whose company matches, and
// a manager/owner (never an employee).
async function authorize(
  companyId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const ssr = await createServerSupabase()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' }
  const { data: userRow } = await ssr
    .from('users')
    .select('company_id, role')
    .eq('id', user.id)
    .single()
  if (!userRow || (userRow as { company_id: string }).company_id !== companyId) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  if (capabilityRoleFor((userRow as { role?: string }).role) === 'employee') {
    return { ok: false, status: 403, error: 'Managers and owners only.' }
  }
  return { ok: true }
}

// N-8 (2026-08-30): log the real Supabase error server-side; the caller gets
// a generic message rather than raw constraint/column detail.
function dbError(action: string, message: string): NextResponse {
  console.error(`[soteria/memory] ${action} failed:`, message)
  return NextResponse.json({ error: `Could not ${action}. Please try again.` }, { status: 500 })
}

export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get('companyId') ?? ''
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 })
  const auth = await authorize(companyId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { data, error } = await supabase
    .from('soteria_memory')
    .select('id, memory_type, content, source, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
  if (error) return dbError('load Soteria memory', error.message)
  return NextResponse.json({ memories: data ?? [] })
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { id, companyId } = body as { id?: string; companyId?: string }
  if (!id || !companyId) return NextResponse.json({ error: 'id and companyId required' }, { status: 400 })
  const auth = await authorize(companyId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { error } = await supabase
    .from('soteria_memory')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId)
  if (error) return dbError('delete that memory', error.message)

  await supabase.from('activity_log').insert({
    company_id: companyId,
    actor: 'soteria',
    action: 'delete_memory',
    entity_type: 'soteria_memory',
    entity_id: id,
    summary: 'Manager deleted a Soteria memory',
  })
  return NextResponse.json({ success: true })
}
