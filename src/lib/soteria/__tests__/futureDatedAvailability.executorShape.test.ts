// Runtime harness for Feature A (future-dated availability, SAVE side).
// Homebase has no test runner; this mirrors the validateScheduleEdit harness — a
// plain ts-node assertion script.
//
// Run:  npx ts-node --transpile-only --project tsconfig.scripts.json \
//         src/lib/soteria/__tests__/futureDatedAvailability.executorShape.test.ts
//
// What it locks: the EXACT custom_availability row the Soteria executor
// (src/app/api/soteria/execute/route.ts, set_custom_availability case) now writes
// for the request Jack hit — "make Maria weekends-only starting <future date>":
//   { type:'date_limited', effective_start_date:<future>, end_date:null (open-ended),
//     patterns:<weekends>, cycle_weeks:null, cycle_start_date:null, active:true }
// and proves that shape round-trips through the shared resolver: dormant until the
// start week, then applied — the whole point of the feature.

import {
  resolveEffectiveAvailability,
  type ValidatorAvailability,
} from '../validateScheduleEdit'
import type { CustomAvailability } from '@/lib/types'

let failures = 0
function expect(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures++
  }
}

const allWeekAvail = (): ValidatorAvailability[] =>
  [0, 1, 2, 3, 4, 5, 6].map(d => ({ day_of_week: d, start_time: '00:00', end_time: '23:59' }))

// Weekends-only pattern (Sun + Sat).
const WEEKENDS = [
  { day_of_week: 0, start_time: '09:00', end_time: '17:00' },
  { day_of_week: 6, start_time: '09:00', end_time: '17:00' },
]

const START = '2026-08-31' // a future Monday (week start)
const BEFORE_WEEK = '2026-08-24' // the Monday before START
const START_WEEK = '2026-08-31' // the week that begins on START
const AFTER_WEEK = '2026-09-07' // a later week

// The row the executor inserts for a PERMANENT future-start change: end_date null.
const permanentFutureStart: CustomAvailability = {
  id: 'ca-fs-perm', employee_id: 'A', company_id: 'c', type: 'date_limited',
  effective_start_date: START, end_date: null,
  cycle_weeks: null, cycle_start_date: null,
  patterns: WEEKENDS, active: true, created_at: '2026-08-12T00:00:00Z',
}

// Dormant for a week that starts BEFORE the effective start.
{
  const eff = resolveEffectiveAvailability(BEFORE_WEEK, allWeekAvail(), permanentFutureStart)
  expect(!eff.customApplied, 'future-start override is dormant for the week before effective_start_date (employee keeps normal availability)')
}

// Applies for the week that starts ON the effective start (inclusive).
{
  const eff = resolveEffectiveAvailability(START_WEEK, allWeekAvail(), permanentFutureStart)
  expect(eff.customApplied, 'future-start override applies on the effective_start_date week (inclusive)')
}

// Still applies for a later week — open-ended (end_date null = permanent from START).
{
  const eff = resolveEffectiveAvailability(AFTER_WEEK, allWeekAvail(), permanentFutureStart)
  expect(eff.customApplied, 'open-ended future-start override (end_date null) still applies weeks later — it never reverts')
}

// The temporary-future-window shape (start + end) the executor also supports:
// applies inside the window, gone after the end.
const futureWindow: CustomAvailability = {
  ...permanentFutureStart, id: 'ca-fs-win', end_date: '2026-09-30',
}
{
  const inWindow = resolveEffectiveAvailability(START_WEEK, allWeekAvail(), futureWindow)
  expect(inWindow.customApplied, 'future window override applies inside [start, end]')
  const afterEnd = resolveEffectiveAvailability('2026-10-05', allWeekAvail(), futureWindow)
  expect(!afterEnd.customApplied, 'future window override is gone after end_date (reverts to normal)')
}

if (failures > 0) {
  console.error(`\n${failures} futureDatedAvailability check(s) failed.`)
  process.exit(1)
}
console.log('\nAll futureDatedAvailability executor-shape checks passed.')
