import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ActionType =
  | 'approve_to'
  | 'deny_to'
  // N-3 / §O3 — a call-out's third choice: approve the absence AND have Aegis
  // blast the qualified pool. Minted (Aegis-side) only when the token payload
  // carries call_out; dispatched through Aegis's shared decision core.
  | 'approve_and_cover_to'
  | 'approve_availability'
  | 'deny_availability'
  | 'approve_custom_availability'
  | 'deny_custom_availability'
  | 'accept_emergency_coverage'
  | 'decline_emergency_coverage'
  | 'confirm_distribution'
  | 'request_additional_batch'
  | 'recheck_to'
  // #10 undirected swap broadcast: a candidate's two email options.
  // swap_pickup → confirm page (one-way pickup); swap_trade_select → the
  // shift-picker page (two-way trade, built in Stage 3b).
  | 'swap_pickup'
  | 'swap_trade_select'
  // The requester's response to a proposed trade.
  | 'swap_agree'
  | 'swap_decline'

// Mirrors the live aegis_action_tokens schema (Aegis-side migration 015 +
// follow-ups). issued_to_* are the manager identity captured at token-mint
// time; dispatchers use issued_to_user_id for decided_by attribution.
export type TokenRow = {
  id: string
  company_id: string | null
  token_hash: string
  action_type: ActionType
  payload: Record<string, unknown>
  issued_to_email: string | null
  issued_to_employee_id: string | null
  issued_to_user_id: string | null
  issued_at: string
  expires_at: string
  consumed_at: string | null
}

export type VerifyResult =
  | { ok: true; row: TokenRow }
  | { ok: false; error: 'invalid' | 'expired' | 'consumed' }

export type ConsumeResult =
  | { ok: true; row: TokenRow }
  | { ok: false; error: 'invalid' | 'expired' | 'consumed' }

// Mirrors the Aegis-side hashing. Duplicated intentionally so the two repos
// stay independent — change here ⇒ change in Aegis.
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

export async function verifyToken(
  rawToken: string,
  supabase: SupabaseClient,
): Promise<VerifyResult> {
  const tokenHash = hashToken(rawToken)

  const { data, error } = await supabase
    .from('aegis_action_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error || !data) {
    return { ok: false, error: 'invalid' }
  }

  const row = data as TokenRow

  if (row.consumed_at !== null) {
    return { ok: false, error: 'consumed' }
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: 'expired' }
  }

  return { ok: true, row }
}

export async function consumeToken(
  rawToken: string,
  supabase: SupabaseClient,
): Promise<ConsumeResult> {
  const tokenHash = hashToken(rawToken)
  const nowIso = new Date().toISOString()

  // Atomic guarded update: only succeeds if not yet consumed AND not expired.
  const { data, error } = await supabase
    .from('aegis_action_tokens')
    .update({ consumed_at: nowIso })
    .eq('token_hash', tokenHash)
    .is('consumed_at', null)
    .gt('expires_at', nowIso)
    .select('*')
    .maybeSingle()

  if (error) {
    return { ok: false, error: 'invalid' }
  }

  if (!data) {
    // The guarded update didn't match. Re-read to disambiguate why.
    const { data: existing } = await supabase
      .from('aegis_action_tokens')
      .select('consumed_at, expires_at')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (!existing) return { ok: false, error: 'invalid' }
    const row = existing as { consumed_at: string | null; expires_at: string }
    if (row.consumed_at !== null) return { ok: false, error: 'consumed' }
    return { ok: false, error: 'expired' }
  }

  return { ok: true, row: data as TokenRow }
}
