// B5 — labels for the action-result pages + Swaps tab.
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register \
//         --project tsconfig.scripts.json src/lib/aegis-actions/__tests__/labels.test.ts

import { actionResultTitle, swapRowDescriptor } from '../labels'

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
const open = swapRowDescriptor(false)
const taken = swapRowDescriptor(true)
expect(open.arrow === '→' && taken.arrow === '→', 'both use a one-way arrow (→), never ↔');
expect(open.kind === 'Open coverage', 'no receiver → "Open coverage"');
expect(taken.kind === 'Pickup', 'receiver present → "Pickup"');
expect(/gives up/.test(taken.hint) && /picks up/.test(taken.hint), 'assigned hint reads "gives up → picks up"');

if (failures > 0) { console.error(`\n${failures} label check(s) FAILED.`); process.exit(1) }
console.log('\nAll labels checks passed.')
