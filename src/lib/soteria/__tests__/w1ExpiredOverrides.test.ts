// W-1 / C-1 + J-2 (2026-08-26): Soteria must not describe an availability
// override that has already ended. Mirrors Aegis's isOverrideCurrent.
//
// Named after the transcript it fixes: Jenna Stibitz's July-16 override was
// still `active = true` on Aug 22 and would have been described to Jack as a
// live temporary schedule.
//
// Run:  npx tsx src/lib/soteria/__tests__/w1ExpiredOverrides.test.ts

import { isCustomAvailabilityCurrent, todayInTimezone } from '../validateScheduleEdit'

let failures = 0
function expect(cond: boolean, msg: string): void {
  if (cond) console.log(`✓ ${msg}`)
  else { console.error(`✗ ${msg}`); failures++ }
}

const TODAY = '2026-08-22'

expect(isCustomAvailabilityCurrent({ active: true, end_date: '2026-07-16' }, TODAY) === false, 'Jenna: active row that ended July 16 is NOT current on Aug 22')
expect(isCustomAvailabilityCurrent({ active: true, end_date: '2026-06-05' }, TODAY) === false, 'Katie: active row that ended June 5 is NOT current')
expect(isCustomAvailabilityCurrent({ active: true, end_date: TODAY }, TODAY) === true, 'a row ending today is still current')
expect(isCustomAvailabilityCurrent({ active: true, end_date: '2026-09-07' }, TODAY) === true, 'a row ending in the future is current')
expect(isCustomAvailabilityCurrent({ active: true, end_date: null }, TODAY) === true, 'an open-ended active row is current')
expect(isCustomAvailabilityCurrent({ active: false, end_date: null }, TODAY) === false, 'an inactive row is never current')
expect(isCustomAvailabilityCurrent(null, TODAY) === false, 'null is not current')

// The filter the Soteria route applies to the raw `active = true` list.
const raw = [
  { id: 'jenna', active: true, end_date: '2026-07-16' },
  { id: 'mya', active: true, end_date: '2026-06-06' },
  { id: 'live', active: true, end_date: '2026-09-07' },
  { id: 'open', active: true, end_date: null },
]
const kept = raw.filter(r => isCustomAvailabilityCurrent(r, TODAY)).map(r => r.id)
expect(kept.join(',') === 'live,open', `Soteria context keeps only the live overrides (got: ${kept.join(',')})`)

// Tenant-local date, not the server clock: at 03:00Z on Aug 23 it is still Aug 22 in Detroit.
const at3amZ = new Date('2026-08-23T03:00:00Z')
expect(todayInTimezone('America/Detroit', at3amZ) === '2026-08-22', 'todayInTimezone uses the company timezone (Detroit is still Aug 22)')
expect(todayInTimezone('UTC', at3amZ) === '2026-08-23', 'todayInTimezone: UTC is Aug 23')
expect(/^\d{4}-\d{2}-\d{2}$/.test(todayInTimezone('Not/AZone', at3amZ)), 'a bad zone falls back to a valid date')

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nAll w1ExpiredOverrides checks passed.')
