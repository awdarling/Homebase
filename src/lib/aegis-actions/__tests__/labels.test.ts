// B5 — labels for the action-result pages + Swaps tab.
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register \
//         --project tsconfig.scripts.json src/lib/aegis-actions/__tests__/labels.test.ts

import { actionResultTitle, swapRowDescriptor, swapNounFor } from '../labels'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

// ── Titles distinguish one-way pickup from two-way trade ─────────────────────
expect(actionResultTitle('swap_pickup') === 'Pick Up Shift', 'swap_pickup → "Pick Up Shift" (not "Swap Pickup")');
expect(!/swap/i.test(actionResultTitle('swap_pickup')), 'a pickup title never contains the word "swap"');
expect(actionResultTitle('swap_agree') === 'Confirm Trade', 'swap_agree → "Confirm Trade"');
expect(actionResultTitle('swap_decline') === 'Decline Trade', 'swap_decline → "Decline Trade"');
expect(actionResultTitle('swap_trade_select') === 'Choose a Shift to Trade', 'swap_trade_select → "Choose a Shift to Trade"');

// ── Time-off / availability titles read as English, not "Approve To" ─────────
expect(actionResultTitle('approve_to') === 'Approve Time Off', 'approve_to → "Approve Time Off"');
expect(actionResultTitle('deny_to') === 'Deny Time Off', 'deny_to → "Deny Time Off"');
expect(actionResultTitle('confirm_distribution') === 'Send Schedule', 'confirm_distribution → "Send Schedule"');

// ── Unknown action types still get a sane title-cased fallback ───────────────
expect(actionResultTitle('some_new_action') === 'Some New Action', 'unknown action → title-cased fallback');

// ── Swap row descriptors are one-way, and label open vs. assigned ───────────
// L4b — REWRITTEN. The old assertions pinned the BUG: every row with a receiver
// was labelled "Pickup" with a one-way arrow, on the false assumption that
// "two-way trades don't create these rows". They do, and the tab showed live
// Approve/Deny buttons for them — so a manager approved a TRADE believing it was
// a one-way pickup.
const open = swapRowDescriptor(false)
const pickup = swapRowDescriptor(true, 'pickup')
const giveaway = swapRowDescriptor(true, 'giveaway')
const trade = swapRowDescriptor(true, 'trade')
const unknown = swapRowDescriptor(true, null)

expect(open.kind === 'Open coverage' && open.arrow === '→', 'no receiver → "Open coverage", one-way arrow');
expect(pickup.kind === 'Pickup' && pickup.arrow === '→', 'a pickup is one-way (→)');
expect(giveaway.kind === 'Pickup' && giveaway.arrow === '→', 'a giveaway reads as a pickup to the manager — one-way');
expect(/gives up/.test(pickup.hint) && /picks up/.test(pickup.hint), 'one-way hint reads "gives up → picks up"');

expect(trade.kind === 'Trade', 'THE FIX: a trade is labelled "Trade", not "Pickup"');
expect(trade.arrow === '↔', 'a trade gets the bidirectional arrow it always deserved');
expect(/two-way/.test(trade.hint), 'and the hint says two-way, so the manager knows two shifts move');

expect(unknown.kind === 'Swap', 'a pre-023 row with no kind is described neutrally...');
expect(/not recorded/.test(unknown.hint), '...and says so, rather than asserting one-way');

// ── The chip and the decision copy use the SAME noun (Rule 0b) ──────────────
expect(swapNounFor('trade') === 'trade', 'swapNounFor: trade → "trade"');
expect(swapNounFor('pickup') === 'pickup', 'swapNounFor: pickup → "pickup"');
expect(swapNounFor('giveaway') === 'pickup', 'swapNounFor: giveaway → "pickup" (same thing to a manager)');
expect(swapNounFor(null) === 'swap', 'swapNounFor: unknown kind → the neutral umbrella word');
expect(swapNounFor(undefined) === 'swap', 'swapNounFor: absent kind → the neutral umbrella word');
// The chip label and the noun must agree, or the tab says "Trade" while the
// confirmation the manager reads afterwards says "swap".
for (const k of ['trade', 'pickup', 'giveaway']) {
  const chip = swapRowDescriptor(true, k).kind.toLowerCase()
  const noun = swapNounFor(k)
  expect(chip === noun, `chip "${chip}" and noun "${noun}" agree for kind=${k}`);
}

if (failures > 0) { console.error(`\n${failures} label check(s) FAILED.`); process.exit(1) }
console.log('\nAll labels checks passed.')
