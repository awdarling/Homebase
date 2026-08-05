import type { SupabaseClient } from '@supabase/supabase-js'
import {
  postToAegisInternal,
  AegisInternalError,
  AegisInternalConfigError,
} from '@/lib/aegis-internal'

export type SwapDecision = 'approved' | 'denied'

export interface DecideSwapInput {
  /** Service-role client — the activity_log write bypasses RLS. */
  supabase: SupabaseClient
  swapRequestId: string
  decision: SwapDecision
  /** activity_log requires a company_id; null skips logging. */
  companyId: string | null
  /** Who acted. */
  decidedBy: { userId: string | null; email: string | null }
  /** Display context for the manager-facing message + activity summary. */
  requesterName?: string
  receiverName?: string
  shiftDate?: string | null
  actorName?: string | null
  actorAvatarUrl?: string | null
}

export interface DecideSwapResult {
  ok: boolean
  message: string
  /** Aegis-authoritative outcome. 'noop' = nothing changed. */
  status?: 'approved' | 'denied' | 'noop'
  /** How many people Aegis notified. */
  notified?: number
  /** Aegis's reason on a noop. */
  reason?: string
  /** true when the row was already decided (surface as 409). */
  alreadyDecided?: boolean
}

type SwapNotifyResponse = {
  ok?: boolean
  status?: 'approved' | 'denied' | 'noop'
  notified?: number
  reason?: string
}

// YYYY-MM-DD parsed in LOCAL time (never new Date('YYYY-MM-DD'), which shifts
// the day back at UTC midnight).
function formatDate(d: string | null | undefined): string {
  if (!d) return 'that day'
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Records a manager's swap approve/deny decision (giveaway / pickup).
 *
 * Unlike the time-off path, AEGIS is authoritative for the swap_requests.status
 * write: it applies the schedule change FIRST (Data Contract D2) and only marks
 * the row approved if that lands, then notifies both people. So Homebase does
 * NOT touch swap_requests.status here — the route authenticates the manager,
 * this calls Aegis, logs the real outcome, and returns a human message. Trades
 * stay on the email magic-link button (Aegis returns a noop for them here).
 */
export async function decideSwapRequest(input: DecideSwapInput): Promise<DecideSwapResult> {
  const { supabase, swapRequestId, decision, companyId, decidedBy } = input
  const who = input.requesterName ?? 'the employee'
  const receiver = input.receiverName ?? 'their teammate'
  const day = formatDate(input.shiftDate)

  let resp: SwapNotifyResponse
  try {
    resp = await postToAegisInternal<SwapNotifyResponse>(
      '/internal/notify-swap-decision',
      { swap_request_id: swapRequestId, decision },
    )
  } catch (err) {
    // Aegis owns the status write, so a failed call means NOTHING changed — say so.
    const errMsg = err instanceof Error ? err.message : String(err)
    if (companyId) {
      await supabase.from('activity_log').insert({
        company_id: companyId,
        actor: 'manager',
        actor_name: input.actorName ?? null,
        actor_avatar_url: input.actorAvatarUrl ?? null,
        action: 'swap_decision_failed',
        entity_type: 'swap_request',
        entity_id: swapRequestId,
        summary: `Swap decision didn't go through — Aegis (/internal/notify-swap-decision) couldn't be reached`,
        metadata: {
          aegis_endpoint: '/internal/notify-swap-decision',
          error: errMsg,
          decided_by: decidedBy.userId,
          decided_by_email: decidedBy.email,
          decision,
        },
      })
    }
    if (err instanceof AegisInternalConfigError) {
      return { ok: false, message: `Swap couldn't be processed — the Aegis connection isn't configured yet. Nothing changed.` }
    }
    if (err instanceof AegisInternalError) {
      return { ok: false, message: `Swap couldn't be processed right now — Aegis returned an error. Nothing changed; please try again.` }
    }
    return { ok: false, message: `Swap couldn't be processed right now. Nothing changed; please try again.` }
  }

  const status = resp.status ?? 'noop'
  const notified = resp.notified ?? 0

  // noop = Aegis made no change: already decided, the week isn't published yet,
  // it's a trade (email-button only), or the row is gone.
  if (status === 'noop') {
    const reason = resp.reason ?? 'nothing to do'
    const already = /already/i.test(reason)
    return {
      ok: false,
      alreadyDecided: already,
      status,
      reason,
      message: already
        ? `This swap was already handled — ${reason}. Nothing changed.`
        : `Couldn't ${decision === 'approved' ? 'approve' : 'deny'} that swap: ${reason}.`,
    }
  }

  // A real decision landed — log it (best-effort; never blocks).
  if (companyId) {
    await supabase.from('activity_log').insert({
      company_id: companyId,
      actor: 'manager',
      actor_name: input.actorName ?? null,
      actor_avatar_url: input.actorAvatarUrl ?? null,
      action: `swap_${status}`,
      entity_type: 'swap_request',
      entity_id: swapRequestId,
      summary: `${status === 'approved' ? 'Approved' : 'Denied'} shift swap: ${who} → ${receiver} on ${day}`,
      metadata: {
        decided_by: decidedBy.userId,
        decided_by_email: decidedBy.email,
        decision,
        notified,
      },
    })
  }

  const notifiedPhrase = notified > 0 ? ` Both people were notified.` : ''
  const message =
    status === 'approved'
      ? `Done — the swap is approved and the schedule's updated.${notifiedPhrase}`
      : `Done — the swap is denied.${notifiedPhrase}`
  return { ok: true, status, notified, message }
}
