import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

// Service-role client — bypasses RLS. Mirrors the SEC-1 pattern used by
// src/app/api/schedule/delete/route.ts and friends. Writes to the three
// OPS-1/BILL-1-protected columns (deactivated_at, service_through,
// billing_model) also satisfy the `trg_enforce_billing_gate_columns`
// trigger's `auth.role() = 'service_role'` allowance (migration 021) —
// this route is the ONE place those columns are ever written from the app.
const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const VALID_BILLING_MODELS = new Set(['subscription', 'one_time', 'trial'])

type Action =
  | { action: 'deactivate'; company_id: string }
  | { action: 'reactivate'; company_id: string }
  | { action: 'set_service_through'; company_id: string; service_through: string | null }
  | { action: 'set_billing_model'; company_id: string; billing_model: string }

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Partial<Action> | null
  if (!body || typeof body.company_id !== 'string' || !body.company_id) {
    return NextResponse.json({ error: 'company_id is required.' }, { status: 400 })
  }
  const { company_id, action } = body

  // ── Authz gate (before any read or write) ─────────────────────────────
  // OPS-1 is explicit: an owner must not be able to flip their own company
  // back on. This is Quria-only, full stop — never company-scoped, unlike
  // most of this app's authz checks.
  const ssr = await createServerSupabase()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data: callerRow } = await ssr
    .from('users')
    .select('role, name, avatar_url')
    .eq('id', user.id)
    .maybeSingle()
  const caller = callerRow as { role: string; name: string; avatar_url: string | null } | null
  if (!caller || caller.role !== 'quria') {
    return NextResponse.json({ error: 'Forbidden — Quria staff only.' }, { status: 403 })
  }

  // Confirm the target company exists before writing anything to it.
  const { data: companyRow } = await adminSupabase
    .from('companies')
    .select('id, name, deactivated_at')
    .eq('id', company_id)
    .maybeSingle()
  if (!companyRow) {
    return NextResponse.json({ error: 'Company not found.' }, { status: 404 })
  }
  const company = companyRow as { id: string; name: string; deactivated_at: string | null }

  switch (action) {
    case 'deactivate': {
      const now = new Date().toISOString()
      const { error } = await adminSupabase
        .from('companies')
        .update({ deactivated_at: now })
        .eq('id', company_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      await adminSupabase.from('activity_log').insert({
        company_id,
        actor: 'quria_admin',
        actor_name: caller.name,
        actor_avatar_url: caller.avatar_url,
        action: 'company_deactivated',
        entity_type: 'company',
        entity_id: company_id,
        summary: `${caller.name} deactivated ${company.name} (OPS-1 kill switch) — Aegis and Homebase logins are now paused for this company.`,
        metadata: { direction: 'off', deactivated_at: now },
      })
      return NextResponse.json({ ok: true, deactivated_at: now })
    }

    case 'reactivate': {
      const { error } = await adminSupabase
        .from('companies')
        .update({ deactivated_at: null })
        .eq('id', company_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      await adminSupabase.from('activity_log').insert({
        company_id,
        actor: 'quria_admin',
        actor_name: caller.name,
        actor_avatar_url: caller.avatar_url,
        action: 'company_reactivated',
        entity_type: 'company',
        entity_id: company_id,
        summary: `${caller.name} reactivated ${company.name} (OPS-1 kill switch cleared) — Aegis and Homebase resume for this company.`,
        metadata: { direction: 'on', previously_deactivated_at: company.deactivated_at },
      })
      return NextResponse.json({ ok: true })
    }

    case 'set_service_through': {
      const raw = (body as { service_through?: unknown }).service_through
      if (raw !== null && (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw))) {
        return NextResponse.json({ error: 'service_through must be a YYYY-MM-DD date or null.' }, { status: 400 })
      }
      const { error } = await adminSupabase
        .from('companies')
        .update({ service_through: raw })
        .eq('id', company_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      await adminSupabase.from('activity_log').insert({
        company_id,
        actor: 'quria_admin',
        actor_name: caller.name,
        actor_avatar_url: caller.avatar_url,
        action: 'company_service_through_set',
        entity_type: 'company',
        entity_id: company_id,
        summary: raw
          ? `${caller.name} set ${company.name}'s service-through date to ${raw}.`
          : `${caller.name} cleared ${company.name}'s service-through date (no cap — stays live indefinitely).`,
        metadata: { service_through: raw },
      })
      return NextResponse.json({ ok: true })
    }

    case 'set_billing_model': {
      const model = (body as { billing_model?: unknown }).billing_model
      if (typeof model !== 'string' || !VALID_BILLING_MODELS.has(model)) {
        return NextResponse.json({ error: 'billing_model must be one of subscription, one_time, trial.' }, { status: 400 })
      }
      const { error } = await adminSupabase
        .from('companies')
        .update({ billing_model: model })
        .eq('id', company_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      await adminSupabase.from('activity_log').insert({
        company_id,
        actor: 'quria_admin',
        actor_name: caller.name,
        actor_avatar_url: caller.avatar_url,
        action: 'company_billing_model_set',
        entity_type: 'company',
        entity_id: company_id,
        summary: `${caller.name} set ${company.name}'s billing model to ${model}.`,
        metadata: { billing_model: model },
      })
      return NextResponse.json({ ok: true })
    }

    default:
      return NextResponse.json({ error: 'Unrecognized action.' }, { status: 400 })
  }
}
