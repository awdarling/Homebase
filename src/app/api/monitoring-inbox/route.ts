import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

// B4 — per-client monitoring ("watch") inbox management.
// A monitoring inbox BCCs every outbound email for a company to an audit
// address (Aegis `resolveMonitoringEmails` → `buildBccList`). This route lets a
// QURIA (platform admin) ONLY add / toggle / remove those inboxes per client
// from the Access page, instead of editing the database by hand.
//
// All writes go through the service-role client AFTER a quria-only auth gate
// (mirrors the SEC-1 create-user pattern). Owners/managers are refused — this
// is deliberately a Quria-only control.

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Returns { companyGate: null } on success, or { error } (a NextResponse) to return.
async function requireQuria(): Promise<{ error: NextResponse } | { error: null }> {
  const ssr = await createServerSupabase()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: callerRow } = await ssr.from('users').select('role').eq('id', user.id).single()
  const caller = callerRow as { role: string } | null
  if (!caller || caller.role !== 'quria') {
    return { error: NextResponse.json({ error: 'Forbidden — Quria only.' }, { status: 403 }) }
  }
  return { error: null }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// GET /api/monitoring-inbox?company_id=... → list a company's monitoring inboxes
export async function GET(req: NextRequest) {
  const gate = await requireQuria()
  if (gate.error) return gate.error

  const companyId = req.nextUrl.searchParams.get('company_id')
  if (!companyId) return NextResponse.json({ error: 'company_id is required.' }, { status: 400 })

  const { data, error } = await adminSupabase
    .from('company_monitoring_inboxes')
    .select('id, email, active, created_at')
    .eq('company_id', companyId)
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ inboxes: data ?? [] })
}

// POST /api/monitoring-inbox  { company_id, email } → add a monitoring inbox
export async function POST(req: NextRequest) {
  const gate = await requireQuria()
  if (gate.error) return gate.error

  const { company_id, email } = (await req.json()) as { company_id?: string; email?: string }
  if (!company_id) return NextResponse.json({ error: 'company_id is required.' }, { status: 400 })
  const clean = (email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(clean)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })

  // Idempotent: reactivate rather than duplicate if this address already exists
  // for the company (company_monitoring_inboxes has no unique constraint).
  const { data: existing } = await adminSupabase
    .from('company_monitoring_inboxes')
    .select('id')
    .eq('company_id', company_id)
    .eq('email', clean)
    .maybeSingle()

  if (existing) {
    const { error } = await adminSupabase
      .from('company_monitoring_inboxes')
      .update({ active: true })
      .eq('id', (existing as { id: string }).id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, reactivated: true })
  }

  const { error } = await adminSupabase
    .from('company_monitoring_inboxes')
    .insert({ company_id, email: clean, active: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

// PATCH /api/monitoring-inbox  { id, active } → turn a monitoring inbox on/off
export async function PATCH(req: NextRequest) {
  const gate = await requireQuria()
  if (gate.error) return gate.error

  const { id, active } = (await req.json()) as { id?: string; active?: boolean }
  if (!id || typeof active !== 'boolean') {
    return NextResponse.json({ error: 'id and active (boolean) are required.' }, { status: 400 })
  }
  const { error } = await adminSupabase
    .from('company_monitoring_inboxes')
    .update({ active })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

// DELETE /api/monitoring-inbox  { id } → remove a monitoring inbox
export async function DELETE(req: NextRequest) {
  const gate = await requireQuria()
  if (gate.error) return gate.error

  const { id } = (await req.json()) as { id?: string }
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  const { error } = await adminSupabase
    .from('company_monitoring_inboxes')
    .delete()
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
