import type { SupabaseClient } from '@supabase/supabase-js'
import {
  postToAegisInternal,
  AegisInternalError,
  AegisInternalConfigError,
} from '@/lib/aegis-internal'

export type AvailabilityDecision = 'approved' | 'denied'

export interface DecideAvailabilityInput {
  /** Service-role client — the activity_log write bypasses RLS. */
  supabase: SupabaseClient
  availabilityChangeRequestId: string
  decision: AvailabilityDecision
  /** activity_log requires a company_id; null skips logging. */
  companyId: string | null
  /** Who acted. userId lands in availability_change_requests.decided_by (Aegis-side). */
  decidedBy: { userId: string | null; email: string | null; name: string | null }
  /** Display context for the manager-facing message + activity summary. */
  employeeName?: string
  changeKind?: 'permanent' | 'date_limited' | 'rotating'
  actorAvatarUrl?: string | null
}

export interface DecideAvailabilityResult {
  ok: boolean
  message: string
  /** Aegis-authoritative outcome. 'noop' = nothing changed (already decided / gone). */
  status?: 'approved' | 'denied' | 'noop'
  /** true when the row was already decided (surface as 409). */
  alreadyDecided?: boolean
  reason?: string
}

type DecideNotifyResponse = {
  ok?: boolean
  status?: 'approved' | 'denied' | 'noop'
  reason?: string
}

function kindPhrase(kind?: string): string {
  if (kind === 'date_limited') return 'temporary availability change'
  if (kind === 'rotating') return 'rotating availability change'
  return 'availability change'
}

/**
 * Records a manager's availability approve/deny decision from the Homebase tab.
 *
 * Like swaps (and unlike time-off), AEGIS is authoritative: it flips the ledger
 * row (guarded, pending-only), applies the DB effect (replace weekly availability,
 * or write the custom override), and notifies the employee — all in one place,
 * shared with the reply-YES + email-button paths. So Homebase does NOT write
 * availability_change_requests.status here; it authenticates the manager, calls
 * Aegis, logs the real outcome for the activity feed, and returns a human message.
 */
export async function decideAvailabilityChange(
  input: DecideAvailabilityInput,
): Promise<DecideAvailabilityResult> {
  const { supabase, availabilityChangeRequestId, decision, companyId, decidedBy } = input
  const who = input.employeeName ?? 'the employee'
  const verb = decision === 'approved' ? 'approved' : 'denied'

  let resp: DecideNotifyResponse
  try {
    resp = await postToAegisInternal<DecideNotifyResponse>(
      '/internal/decide-availability-change',
      {
        availability_change_request_id: availabilityChangeRequestId,
        decision,
        decided_by_user_id: decidedBy.userId,
        decided_by_name: decidedBy.name ?? decidedBy.email,
      },
    )
  } catch (err) {
    // Aegis owns the apply + status write, so a failed call means NOTHING changed.
    const errMsg = err instanceof Error ? err.message : String(err)
    if (companyId) {
      await supabase.from('activity_log').insert({
        company_id: companyId,
        actor: 'manager',
        actor_name: decidedBy.name ?? null,
        actor_avatar_url: input.actorAvatarUrl ?? null,
        action: 'availability_change_decision_failed',
        entity_type: 'availability_change_request',
        entity_id: availabilityChangeRequestId,
        summary: `Availability decision didn't go through — Aegis (/internal/decide-availability-change) couldn't be reached`,
        metadata: {
          aegis_endpoint: '/internal/decide-availability-change',
          error: errMsg,
          decided_by: decidedBy.userId,
          decided_by_email: decidedBy.email,
          decision,
        },
      })
    }
    if (err instanceof AegisInternalConfigError) {
      return { ok: false, message: `Couldn't process that — the Aegis connection isn't configured yet. Nothing changed.` }
    }
    if (err instanceof AegisInternalError) {
      return { ok: false, message: `Couldn't process that right now — Aegis returned an error. Nothing changed; please try again.` }
    }
    return { ok: false, message: `Couldn't process that right now. Nothing changed; please try again.` }
  }

  const status = resp.status ?? 'noop'

  if (status === 'noop') {
    const reason = resp.reason ?? 'nothing to do'
    const already = /already/i.test(reason)
    return {
      ok: false,
      alreadyDecided: already,
      status,
      reason,
      message: already
        ? `This ${kindPhrase(input.changeKind)} was already handled — ${reason}. Nothing changed.`
        : `Couldn't ${decision === 'approved' ? 'approve' : 'deny'} that change: ${reason}.`,
    }
  }

  // A real decision landed — log it for the activity feed (best-effort; never blocks).
  if (companyId) {
    await supabase.from('activity_log').insert({
      company_id: companyId,
      actor: 'manager',
      actor_name: decidedBy.name ?? null,
      actor_avatar_url: input.actorAvatarUrl ?? null,
      action: `availability_change_${status}`,
      entity_type: 'availability_change_request',
      entity_id: availabilityChangeRequestId,
      summary: `${status === 'approved' ? 'Approved' : 'Denied'} ${who}'s ${kindPhrase(input.changeKind)}`,
      metadata: {
        decided_by: decidedBy.userId,
        decided_by_email: decidedBy.email,
        decision,
        change_kind: input.changeKind ?? null,
      },
    })
  }

  const message =
    status === 'approved'
      ? `Done — ${who}'s ${kindPhrase(input.changeKind)} is approved and applied. They've been notified.`
      : `Done — ${who}'s ${kindPhrase(input.changeKind)} is denied. They've been notified.`
  return { ok: true, status, message }
}
