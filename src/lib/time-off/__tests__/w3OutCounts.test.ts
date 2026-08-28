// Runtime test for W-3's honest Who's Out counts (Jack's audit, "also seen").
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register --project tsconfig.scripts.json \
//         src/lib/time-off/__tests__/w3OutCounts.test.ts
//
// "9 of 23 staff out — 39% out" counted five people who each miss a four-hour
// window as fully out. The card now says "3 out · 5 partly out" — no percent.

import { buildOutRows, summarizeOutCounts, partialTimeLabel, type TORequestLike } from '../out-summary'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const RS = '2026-08-17'
const RE = '2026-08-23'
const emp = (id: string) => ({ id, name: id, primary_role: 'guard' })
const fullDay = (id: string, date: string): TORequestLike =>
  ({ id: `${id}-${date}`, employee: emp(id), start_date: date, end_date: date, reason: null, time_off_type: 'full_day', partial_days: null })
const partial = (id: string, date: string): TORequestLike =>
  ({ id: `${id}-${date}-p`, employee: emp(id), start_date: date, end_date: date, reason: null, time_off_type: 'partial', partial_days: [{ date, type: 'custom_hours', start_time: '09:00', end_time: '13:00' }] })

// ── 3 fully out + 5 partly out ──────────────────────────────────────────────
{
  const reqs: TORequestLike[] = [
    fullDay('a', '2026-08-18'), fullDay('b', '2026-08-19'), fullDay('c', '2026-08-20'),
    partial('d', '2026-08-18'), partial('e', '2026-08-18'), partial('f', '2026-08-19'),
    partial('g', '2026-08-20'), partial('h', '2026-08-21'),
  ]
  const rows = buildOutRows(reqs, RS, RE)
  const counts = summarizeOutCounts(rows)
  expect(counts.full === 3, `3 fully out (got ${counts.full})`)
  expect(counts.partial === 5, `5 partly out (got ${counts.partial})`)
}

// ── a person with BOTH a full day and a partial day counts as OUT ───────────
{
  const rows = buildOutRows([fullDay('a', '2026-08-18'), partial('a', '2026-08-19')], RS, RE)
  const counts = summarizeOutCounts(rows)
  expect(counts.full === 1 && counts.partial === 0, 'one full day anywhere makes the person "out", not "partly out"')
}

// ── §N11: a shift_off partial carries a name AND hours — show both ──────────
{
  const label = partialTimeLabel([{ date: '2026-08-21', type: 'shift_off', shift_name: 'AM Weekday', start_time: '11:00', end_time: '15:30' }])
  expect(label === 'AM Weekday shift, 11:00 AM – 3:30 PM', `shift_off with times shows both (got "${label}")`)
  const bare = partialTimeLabel([{ date: '2026-08-21', type: 'shift_off', shift_name: 'AM Weekday' }])
  expect(bare === 'AM Weekday shift', 'shift_off without times still names the shift')
  const custom = partialTimeLabel([{ date: '2026-08-21', type: 'custom_hours', start_time: '09:00', end_time: '13:00' }])
  expect(custom === '9:00 AM – 1:00 PM', 'custom_hours unchanged')
}

if (failures > 0) { console.error(`\n${failures} check(s) failed.`); process.exit(1) }
console.log('\nAll w3OutCounts checks passed.')
