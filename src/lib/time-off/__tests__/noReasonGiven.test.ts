// W-1 branch 5 — Decision (Alexander, 2026-08-26): a missing reason reads
// "no reason given" on every manager surface; never a dash, never invented.
//
// Run:  npx tsx src/lib/time-off/__tests__/noReasonGiven.test.ts

import { displayReason, NO_REASON_GIVEN } from '../reason'
import { buildOutRows } from '../out-summary'

let failures = 0
function expect(cond: boolean, msg: string): void {
  if (cond) console.log(`✓ ${msg}`)
  else { console.error(`✗ ${msg}`); failures++ }
}

expect(displayReason(null) === NO_REASON_GIVEN, 'null → "no reason given"')
expect(displayReason('') === NO_REASON_GIVEN, 'empty → "no reason given"')
expect(displayReason('  ') === NO_REASON_GIVEN, 'blank → "no reason given"')
expect(displayReason('the competition') === 'the competition', 'a real reason stays')

const rows = buildOutRows([
  { id: 'r1', employee: { id: 'maisey', name: 'Maisey Pell', primary_role: 'Lifeguard' }, start_date: '2026-08-18', end_date: '2026-08-18', reason: null, time_off_type: 'full_day', partial_days: null },
] as never, '2026-08-17', '2026-08-23')
expect(rows.length === 1 && rows[0].segments[0].reason === NO_REASON_GIVEN, `Who's Out shows "no reason given" for a null reason (got: ${rows[0]?.segments[0]?.reason})`)

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nAll noReasonGiven checks passed.')
