// L4b — the manager-facing copy for a swap / pickup / TRADE decision.
//
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register \
//         --project tsconfig.scripts.json src/lib/swaps/__tests__/decide-copy.test.ts
//
// WHY THIS FILE EXISTS
//
// Before L4b, `decideSwapRequest` hard-coded the word "swap" in every string it
// produced. A manager who approved a two-way TRADE was told "the swap is
// approved and the schedule's updated", and the activity feed recorded
// "Approved shift swap: A → B on Aug 3" — one arrow, one date, for a change that
// moved two shifts on two days. Nothing tested any of it, which is how the
// comment "Trades stay on the email magic-link button" survived in three files
// while being implemented in none.
//
// Every assertion below fails against the pre-L4b copy.

import { swapDecisionCopy } from '../decide'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

// Requester gives up Aug 3; receiver gives BACK Aug 7 (migration 023 semantics:
// target_shift_* is the shift the RECEIVER hands to the requester).
const TRADE = {
  requesterName: 'Bennet',
  receiverName: 'Rosa',
  shiftDate: '2026-08-03',
  swapKind: 'trade',
  targetShiftDate: '2026-08-07',
}
const PICKUP = {
  requesterName: 'Bennet',
  receiverName: 'Rosa',
  shiftDate: '2026-08-03',
  swapKind: 'pickup',
}

// ── The noun matches what the row actually is ────────────────────────────────
expect(swapDecisionCopy(TRADE).noun === 'trade', 'a trade is called a trade');
expect(swapDecisionCopy(PICKUP).noun === 'pickup', 'a pickup is called a pickup');
expect(swapDecisionCopy({ ...PICKUP, swapKind: 'giveaway' }).noun === 'pickup',
  'a giveaway reads as a pickup to the manager');
expect(swapDecisionCopy({ ...PICKUP, swapKind: null }).noun === 'swap',
  'an unknown (pre-023) kind falls back to the neutral umbrella word');
expect(swapDecisionCopy(TRADE).Noun === 'Trade', 'sentence-initial form is capitalised');

// ── A trade is only described as one when we can name BOTH shifts ────────────
expect(swapDecisionCopy(TRADE).isTrade === true, 'kind=trade + a return shift → describable trade');
expect(swapDecisionCopy({ ...TRADE, targetShiftDate: null }).isTrade === false,
  'kind=trade with NO return shift is not described as a trade — we cannot name the second day');

// ── Approval message: name who ends up on which day ──────────────────────────
const tradeApproved = swapDecisionCopy(TRADE).message('approved', 2)
expect(/trade is approved/.test(tradeApproved), 'THE FIX: approving a trade does not say "the swap is approved"');
expect(!/\bswap\b/i.test(tradeApproved), 'the trade approval message never uses the word "swap"');
expect(/Bennet now works Aug 7/.test(tradeApproved),
  'the requester is told they now work the RETURN shift (Aug 7), not that they are off');
expect(/Rosa now works Aug 3/.test(tradeApproved),
  'the receiver is named on the shift they took over (Aug 3)');
expect(/Both people were notified/.test(tradeApproved), 'notification count is surfaced when > 0');
expect(!/Both people were notified/.test(swapDecisionCopy(TRADE).message('approved', 0)),
  'and suppressed when nobody was notified');

const pickupApproved = swapDecisionCopy(PICKUP).message('approved', 2)
expect(/the pickup is approved/.test(pickupApproved), 'a one-way pickup still reads as a pickup');
expect(!/Aug 7/.test(pickupApproved), 'a one-way pickup never mentions a return shift');

// ── Denial message ───────────────────────────────────────────────────────────
expect(swapDecisionCopy(TRADE).message('denied', 2).startsWith('Done — the trade is denied.'),
  'denying a trade says trade');
expect(swapDecisionCopy(PICKUP).message('denied', 0) === 'Done — the pickup is denied.',
  'denying a pickup says pickup');

// ── activity_log summary: a trade shows BOTH days and a two-way arrow ────────
const tradeSummary = swapDecisionCopy(TRADE).summary('approved')
expect(/↔/.test(tradeSummary), 'the trade summary uses the two-way arrow');
expect(/Aug 3/.test(tradeSummary) && /Aug 7/.test(tradeSummary),
  'THE FIX: the trade summary records BOTH dates — the old one recorded only the requester\'s');
expect(/shift trade/.test(tradeSummary), 'and calls it a trade');

const pickupSummary = swapDecisionCopy(PICKUP).summary('approved')
expect(pickupSummary === 'Approved shift pickup: Bennet → Rosa on Aug 3',
  'a one-way summary keeps the one-way arrow and single date');
expect(swapDecisionCopy(PICKUP).summary('denied').startsWith('Denied '), 'denials are summarised as denials');

// ── Dates are parsed in LOCAL time, never new Date('YYYY-MM-DD') ─────────────
// (that shifts the day back for anyone behind UTC — the schedule would name the
// wrong day.)
expect(/Aug 3/.test(swapDecisionCopy(PICKUP).summary('approved')),
  'Aug 3 stays Aug 3 — no UTC-midnight off-by-one');

// ── Missing names degrade to plain English, not "undefined" ──────────────────
const anon = swapDecisionCopy({ shiftDate: '2026-08-03', swapKind: 'pickup' })
expect(!/undefined/.test(anon.summary('approved')) && !/undefined/.test(anon.message('approved', 1)),
  'absent names never render as "undefined"');

if (failures > 0) { console.error(`\n${failures} swap-copy check(s) FAILED.`); process.exit(1) }
console.log('\nAll swap decision copy checks passed.')
