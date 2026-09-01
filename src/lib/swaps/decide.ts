import type { SupabaseClient } from '@supabase/supabase-js'
import {
  postToAegisInternal,
  AegisInternalError,
  AegisInternalConfigError,
} from '@/lib/aegis-internal'
import { swapNounFor } from '@/lib/aegis-actions/labels'

export type SwapDecision = 'approved' | 'denied'

export interface DecideSwapInput {
  /**
   * The client the activity_log write runs on. As of S-1 stage 1
   * (2026-09-01), swap-decision's route passes its caller's own
   * session-authenticated client here (not the service-role key) — the
   * insert is company-scoped by RLS as well as by the caller-supplied
   * `companyId`.
   */
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
  /**
   * L4b — `swap_requests.kind` ('giveaway' | 'pickup' | 'trade'), null on a row
   * created before migration 023. Everything a manager reads here is worded from
   * this; without it the copy claims a one-way handoff for a two-way trade.
   */
  swapKind?: string | null
  /** TRADE only: the shift the RECEIVER gives back to the requester. */
  targetShiftDate?: string | null
  targetShiftName?: string | null
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

/** The subset of the input that decides how a request is WORDED. */
export interface SwapCopyContext {
  requesterName?: string
  receiverName?: string
  shiftDate?: string | null
  swapKind?: string | null
  targetShiftDate?: string | null
}

export interface SwapDecisionCopy {
  /** Mid-sentence noun: 'trade' | 'pickup' | 'swap'. */
  noun: 'trade' | 'pickup' | 'swap'
  /** Sentence-initial form of the same noun. */
  Noun: string
  /** A trade we can actually describe — kind is 'trade' AND we know the return shift. */
  isTrade: boolean
  /** The activity_log summary line. */
  summary(status: 'approved' | 'denied'): string
  /** What the manager reads after clicking Approve / Deny. */
  message(status: 'approved' | 'denied', notified: number): string
}

/**
 * Every manager-facing string this module produces, in one pure function.
 *
 * Split out from `decideSwapRequest` so the copy is testable without a network
 * call to Aegis — the trade wording is the entire point of L4b on this side, and
 * an untested string is how the old "Trades stay on the email button" comment
 * survived three files while being true in none.
 */
export function swapDecisionCopy(ctx: SwapCopyContext): SwapDecisionCopy {
  const who = ctx.requesterName ?? 'the employee'
  const receiver = ctx.receiverName ?? 'their teammate'
  const day = formatDate(ctx.shiftDate)
  const returnDay = formatDate(ctx.targetShiftDate)

  // One noun for every surface — Rule 0b, shared with the Swaps tab chip.
  const noun = swapNounFor(ctx.swapKind)
  const Noun = noun[0].toUpperCase() + noun.slice(1)
  // Kind says trade, but a pre-023 row has no return shift to name. Don't
  // promise detail we don't have.
  const isTrade = noun === 'trade' && !!ctx.targetShiftDate

  return {
    noun,
    Noun,
    isTrade,
    summary(status) {
      const verb = status === 'approved' ? 'Approved' : 'Denied'
      // Two shifts moved on two days — the feed has to show both, or a manager
      // reading it later can't tell what actually happened.
      return isTrade
        ? `${verb} shift trade: ${who} (${day}) ↔ ${receiver} (${returnDay})`
        : `${verb} shift ${noun}: ${who} → ${receiver} on ${day}`
    },
    message(status, notified) {
      const notifiedPhrase = notified > 0 ? ` Both people were notified.` : ''
      if (status === 'denied') return `Done — the ${noun} is denied.${notifiedPhrase}`
      // Name who ends up on which day. "The schedule's updated" is true but
      // useless for a trade — the risk is the manager not realising TWO days
      // changed.
      return isTrade
        ? `Done — the trade is approved. ${who} now works ${returnDay} and ${receiver} now works ${day}.${notifiedPhrase}`
        : `Done — the ${noun} is approved and the schedule's updated.${notifiedPhrase}`
    },
  }
}

/**
 * Records a manager's swap / pickup / TRADE approve-deny decision.
 *
 * Unlike the time-off path, AEGIS is authoritative for the swap_requests.status
 * write: it applies the schedule change FIRST (Data Contract D2) and only marks
 * the row approved if that lands, then notifies both people. So Homebase does
 * NOT touch swap_requests.status here — the route authenticates the manager,
 * this calls Aegis, logs the real outcome, and returns a human message.
 *
 * ── L4b — TRADES NOW WORK FROM THIS PATH ────────────────────────────────────
 *
 * This function used to carry the comment "Trades stay on the email magic-link
 * button (Aegis returns a noop for them here)". That was never true of the code
 * on either side: Aegis called the ONE-WAY executor unconditionally, so
 * approving a trade here moved one shift, dropped the return leg, and reported
 * success. L4 made it refuse; L4b (migration 023 + `planRowExecution` in Aegis)
 * makes it execute BOTH legs and notify both people correctly.
 *
 * All this side has to do is stop lying in the copy. A manager approving a
 * two-way trade was told "the swap is approved and the schedule's updated" and
 * the activity feed recorded "Approved shift swap: A → B on Aug 3" — one arrow,
 * one date, for a move that changed two shifts on two days. The wording now
 * comes from `swapNounFor` (Rule 0b: same vocabulary as the Swaps tab chip).
 */
export async function decideSwapRequest(input: DecideSwapInput): Promise<DecideSwapResult> {
  const { supabase, swapRequestId, decision, companyId, decidedBy } = input
  const { noun, Noun, summary, message } = swapDecisionCopy(input)

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
        summary: `${Noun} decision didn't go through — Aegis (/internal/notify-swap-decision) couldn't be reached`,
        metadata: {
          aegis_endpoint: '/internal/notify-swap-decision',
          error: errMsg,
          decided_by: decidedBy.userId,
          decided_by_email: decidedBy.email,
          decision,
          swap_kind: input.swapKind ?? null,
        },
      })
    }
    if (err instanceof AegisInternalConfigError) {
      return { ok: false, message: `${Noun} couldn't be processed — the Aegis connection isn't configured yet. Nothing changed.` }
    }
    if (err instanceof AegisInternalError) {
      return { ok: false, message: `${Noun} couldn't be processed right now — Aegis returned an error. Nothing changed; please try again.` }
    }
    return { ok: false, message: `${Noun} couldn't be processed right now. Nothing changed; please try again.` }
  }

  const status = resp.status ?? 'noop'
  const notified = resp.notified ?? 0

  // noop = Aegis made no change: already decided, the week isn't published yet,
  // the row is gone, or `planRowExecution` refused it (a pre-023 row whose kind
  // or return shift was never recorded — see swap-kind.ts). Aegis's `reason` on
  // that last case already tells the manager to use the approval email, so pass
  // it through verbatim rather than paraphrasing it.
  if (status === 'noop') {
    const reason = resp.reason ?? 'nothing to do'
    const already = /already/i.test(reason)
    return {
      ok: false,
      alreadyDecided: already,
      status,
      reason,
      message: already
        ? `This ${noun} was already handled — ${reason}. Nothing changed.`
        : `Couldn't ${decision === 'approved' ? 'approve' : 'deny'} that ${noun}: ${reason}.`,
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
      summary: summary(status),
      metadata: {
        decided_by: decidedBy.userId,
        decided_by_email: decidedBy.email,
        decision,
        notified,
        swap_kind: input.swapKind ?? null,
        shift_date: input.shiftDate ?? null,
        target_shift_date: input.targetShiftDate ?? null,
      },
    })
  }

  return { ok: true, status, notified, message: message(status, notified) }
}
