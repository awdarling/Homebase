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

// How a manager-facing swap_requests row should read. These rows are one-way
// handoffs — the requesting employee gives up a shift and the receiving employee
// picks it up (two-way trades ride the email path and don't create these rows) —
// so the row uses a directional arrow, never the bidirectional ↔ that implied a
// mutual swap. When there is no receiver yet, coverage is still being found.
export interface SwapRowDescriptor {
  /** Short chip label: an assigned pickup vs. a still-open coverage request. */
  kind: string
  /** One-way arrow between the giver and the taker. */
  arrow: string
  /** Micro-caption under the two names. */
  hint: string
}

export function swapRowDescriptor(receiverPresent: boolean): SwapRowDescriptor {
  return receiverPresent
    ? { kind: 'Pickup', arrow: '→', hint: 'gives up → picks up' }
    : { kind: 'Open coverage', arrow: '→', hint: 'gives up → finding coverage' }
}
