// B5 — shared, deterministic labels for the magic-link action-result pages
// (src/app/api/aegis-action/route.ts) and the manager Swaps tab
// (src/app/(app)/data/tabs/SwapsTab.tsx). One source of truth for the
// pickup / coverage vs. swap vs. trade vocabulary (Rule 0b), so the two
// surfaces can't drift on wording.
//
// Terminology (from the SMS System Specification):
//   • pickup / coverage — ONE-WAY: an employee gives up a shift and another
//     employee takes it, nothing given back. An open request with no taker yet
//     is "coverage" being found; once someone takes it, it's a "pickup".
//   • trade            — TWO-WAY: two employees exchange shifts.
//   • swap             — the umbrella word; avoid it where pickup/trade is exact.

// Human titles for the confirmation / result page header. The mechanical
// `action_type.replace(/_/g,' ')` fallback produced "Swap Pickup" for a one-way
// pickup (it is not a swap) and "Approve To" for a time-off approval. This map
// gives every action a plain-English title; anything unlisted still falls back.
const ACTION_TITLES: Record<string, string> = {
  approve_to: 'Approve Time Off',
  deny_to: 'Deny Time Off',
  recheck_to: 'Re-check Time Off',
  approve_availability: 'Approve Availability Change',
  deny_availability: 'Deny Availability Change',
  approve_custom_availability: 'Approve Availability Change',
  deny_custom_availability: 'Deny Availability Change',
  accept_emergency_coverage: 'Accept Coverage Shift',
  decline_emergency_coverage: 'Decline Coverage Shift',
  confirm_distribution: 'Send Schedule',
  request_additional_batch: 'Find More Candidates',
  // swap family — distinguish one-way pickup from two-way trade
  swap_pickup: 'Pick Up Shift',
  swap_trade_select: 'Choose a Shift to Trade',
  swap_agree: 'Confirm Trade',
  swap_decline: 'Decline Trade',
}

export function actionResultTitle(action_type: string): string {
  return (
    ACTION_TITLES[action_type] ??
    action_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

// How a manager-facing swap_requests row should read.
//
// ── L4b — THIS USED TO BE WRONG FOR TRADES ──────────────────────────────────
//
// The old version took only `receiverPresent` and labelled EVERY row "Pickup"
// with a one-way arrow, on the stated assumption that "two-way trades ride the
// email path and don't create these rows". That assumption was false — both the
// broadcast trade and the directed trade create exactly these rows, and the tab
// rendered live Approve/Deny buttons for them. So a manager looking at a TRADE
// saw it described as a one-way pickup, approved it on that understanding, and
// (before L4) got a half-applied schedule.
//
// It is the same false invariant that appeared as a comment in three other files
// while being implemented in none. Now that `swap_requests.kind` exists
// (migration 023) the row can say what it actually is, so this describes it
// truthfully: a trade gets the bidirectional ↔ it always deserved.
export interface SwapRowDescriptor {
  /** Short chip label: Trade / Pickup / Open coverage. */
  kind: string
  /** ↔ for a two-way trade; → for a one-way handoff. */
  arrow: string
  /** Micro-caption under the two names. */
  hint: string
}

/**
 * @param receiverPresent  is a coworker attached yet?
 * @param swapKind         `swap_requests.kind` — 'trade' | 'giveaway' | 'pickup',
 *                         or null for a row created before migration 023, which
 *                         is described neutrally rather than guessed at.
 */
export function swapRowDescriptor(
  receiverPresent: boolean,
  swapKind?: string | null,
): SwapRowDescriptor {
  if (!receiverPresent) {
    return { kind: 'Open coverage', arrow: '→', hint: 'gives up → finding coverage' }
  }
  if (swapKind === 'trade') {
    return { kind: 'Trade', arrow: '↔', hint: 'two-way — both give up a shift' }
  }
  if (swapKind === 'giveaway' || swapKind === 'pickup') {
    return { kind: 'Pickup', arrow: '→', hint: 'gives up → picks up' }
  }
  // Unknown (pre-023 row). Don't assert one-way — that mislabel is the bug.
  return { kind: 'Swap', arrow: '→', hint: 'gives up → picks up (kind not recorded)' }
}

/**
 * The NOUN to use when talking to a manager about a request.
 *
 * Rule 0b — the Swaps tab chip, the confirmation message the manager reads after
 * clicking Approve, and the activity_log summary must all call the same thing by
 * the same name. Before L4b, `src/lib/swaps/decide.ts` hard-coded "swap"
 * everywhere: a manager who approved a two-way TRADE was told "the swap is
 * approved and the schedule's updated" while the activity feed recorded
 * "Approved shift swap: A → B" — a one-way arrow for a two-way move.
 *
 * Lower-case, for use mid-sentence ("the trade is approved"). Capitalise at the
 * call site when it starts one.
 */
export function swapNounFor(swapKind?: string | null): 'trade' | 'pickup' | 'swap' {
  if (swapKind === 'trade') return 'trade'
  if (swapKind === 'giveaway' || swapKind === 'pickup') return 'pickup'
  // Unknown kind (pre-023 row): the umbrella word is the only honest one.
  return 'swap'
}
