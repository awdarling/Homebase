// Runtime test for the "Who's Out" summarization (Home dashboard).
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register --project tsconfig.scripts.json \
//         src/lib/time-off/__tests__/out-summary.test.ts

import { buildOutRows, fmtClock, partialTimeLabel, type TORequestLike } from '../out-summary'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const RS = '2026-08-03'
const RE = '2026-08-09'

// ── clock formatting ───────────────────────────────────────────────────────
expect(fmtClock('09:00') === '9:00 AM', 'fmtClock 09:00 -> 9:00 AM')
expect(fmtClock('13:00') === '1:00 PM', 'fmtClock 13:00 -> 1:00 PM')
expect(fmtClock('00:30') === '12:30 AM', 'fmtClock 00:30 -> 12:30 AM')
expect(fmtClock('12:00') === '12:00 PM', 'fmtClock 12:00 -> 12:00 PM')
expect(fmtClock(null) === null, 'fmtClock null -> null')
expect(
  partialTimeLabel([{ date: '2026-08-05', type: 'custom_hours', start_time: '09:00', end_time: '13:00' }]) === '9:00 AM – 1:00 PM',
  'partialTimeLabel single window',
)

// ── Sam Rivera: the real sandbox case (4 requests, 3 days, 1 partial, 1 dupe) ─
const sam: TORequestLike[] = [
  { id: 's1', employee: { id: 'sam', name: 'Sam Rivera', primary_role: 'guard' }, start_date: '2026-08-05', end_date: '2026-08-05', reason: "a doctor's appointment", time_off_type: 'partial', partial_days: [{ date: '2026-08-05', type: 'custom_hours', start_time: '09:00', end_time: '13:00' }] },
  { id: 's2', employee: { id: 'sam', name: 'Sam Rivera', primary_role: 'guard' }, start_date: '2026-08-06', end_date: '2026-08-06', reason: 'a family thing', time_off_type: 'full_day', partial_days: null },
  { id: 's3', employee: { id: 'sam', name: 'Sam Rivera', primary_role: 'guard' }, start_date: '2026-08-07', end_date: '2026-08-07', reason: 'personal reasons', time_off_type: 'full_day', partial_days: null },
  { id: 's4', employee: { id: 'sam', name: 'Sam Rivera', primary_role: 'guard' }, start_date: '2026-08-07', end_date: '2026-08-07', reason: 'personal reasons', time_off_type: 'full_day', partial_days: null },
]
const samRow = buildOutRows(sam, RS, RE)[0]
expect(samRow.days === 3, `Sam counts 3 distinct days (got ${samRow.days})`)
expect(samRow.segments.length === 3, `Sam has 3 segments after dedup of the doubled Aug 7 (got ${samRow.segments.length})`)
expect(samRow.partialDays === 1, `Sam has 1 partial day (got ${samRow.partialDays})`)
expect(samRow.summary === '3 requests · 1 partial', `Sam summary reads "3 requests · 1 partial" (got "${samRow.summary}")`)
const samSeg0 = samRow.segments[0]
expect(samSeg0.dateLabel === 'Aug 5' && samSeg0.isPartial && samSeg0.timeLabel === '9:00 AM – 1:00 PM' && samSeg0.reason === "a doctor's appointment", 'Sam seg 1: Aug 5 partial 9–1 doctor')
expect(samRow.segments[1].dateLabel === 'Aug 6' && !samRow.segments[1].isPartial && samRow.segments[1].reason === 'a family thing', 'Sam seg 2: Aug 6 full-day family')
expect(samRow.segments[2].dateLabel === 'Aug 7' && samRow.segments[2].reason === 'personal reasons', 'Sam seg 3: Aug 7 personal (dupe collapsed)')

// ── Coalescing: two contiguous same-reason full days become one range ───────
const coalesce: TORequestLike[] = [
  { id: 'c1', employee: { id: 'x', name: 'X', primary_role: 'guard' }, start_date: '2026-08-06', end_date: '2026-08-06', reason: 'personal', time_off_type: 'full_day' },
  { id: 'c2', employee: { id: 'x', name: 'X', primary_role: 'guard' }, start_date: '2026-08-07', end_date: '2026-08-07', reason: 'personal', time_off_type: 'full_day' },
]
const cRow = buildOutRows(coalesce, RS, RE)[0]
expect(cRow.segments.length === 1 && cRow.segments[0].dateLabel === 'Aug 6 – Aug 7', 'Contiguous same-reason full days coalesce to one range')

// ── Single full-day request stays a clean one-line row ─────────────────────
const single: TORequestLike[] = [
  { id: 'o1', employee: { id: 'y', name: 'Y', primary_role: 'Lifeguard' }, start_date: '2026-08-06', end_date: '2026-08-06', reason: 'personal reasons', time_off_type: 'full_day' },
]
const sRow = buildOutRows(single, RS, RE)[0]
expect(sRow.segments.length === 1 && sRow.reason === 'personal reasons', 'Single request -> one segment, reason preserved')

// ── Window clamping: a request spilling past the week is clamped ────────────
const spill: TORequestLike[] = [
  { id: 'p1', employee: { id: 'z', name: 'Z', primary_role: 'Headguard' }, start_date: '2026-08-08', end_date: '2026-08-12', reason: 'personal', time_off_type: 'full_day' },
]
const spillRow = buildOutRows(spill, RS, RE)[0]
expect(spillRow.days === 2, `Spillover clamps to 2 in-window days Aug 8–9 (got ${spillRow.days})`)

// ── Partial-only employee (two separate partials, different reasons) ────────
const partials: TORequestLike[] = [
  { id: 'k1', employee: { id: 'k', name: 'Katie', primary_role: 'Lifeguard' }, start_date: '2026-08-03', end_date: '2026-08-03', reason: 'appointment', time_off_type: 'partial', partial_days: [{ date: '2026-08-03', type: 'custom_hours', start_time: '08:30', end_time: '12:00' }] },
  { id: 'k2', employee: { id: 'k', name: 'Katie', primary_role: 'Lifeguard' }, start_date: '2026-08-04', end_date: '2026-08-04', reason: 'appointment', time_off_type: 'partial', partial_days: [{ date: '2026-08-04', type: 'custom_hours', start_time: '08:30', end_time: '12:00' }] },
]
const kRow = buildOutRows(partials, RS, RE)[0]
expect(kRow.partialDays === 2, `Katie has 2 partial days (got ${kRow.partialDays})`)
expect(kRow.segments[0].timeLabel === '8:30 AM – 12:00 PM', 'Katie partial window formatted 8:30 AM – 12:00 PM')

if (failures > 0) { console.error(`\n${failures} test(s) failed`); process.exit(1) }
console.log('\nAll out-summary tests passed')
