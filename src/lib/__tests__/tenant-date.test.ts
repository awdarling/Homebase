// Runtime test for the tenant-timezone date helpers (BILL-1/OPS-1).
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register --project tsconfig.scripts.json \
//         src/lib/__tests__/tenant-date.test.ts

import { todayInTimezone, endOfDayInTimezone, startOfDayInTimezone, addDays } from '../tenant-date'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

// ── endOfDayInTimezone: the boundary OPEN_ITEMS #7 never had ────────────────
{
  const instant = endOfDayInTimezone('2026-09-19', 'America/Detroit')
  expect(instant.toISOString() === '2026-09-20T03:59:59.999Z',
    'Detroit (EDT, UTC-4) end-of-day 2026-09-19 is 2026-09-20T03:59:59.999Z')
}

{
  const naiveUtc = new Date('2026-09-19T23:59:59.999Z')
  const tenantAware = endOfDayInTimezone('2026-09-19', 'America/Detroit')
  expect(tenantAware.toISOString() !== naiveUtc.toISOString(),
    'tenant-timezone end-of-day is NOT the same instant as naive UTC end-of-day')
}

{
  const detroit = endOfDayInTimezone('2026-09-19', 'America/Detroit')
  const la = endOfDayInTimezone('2026-09-19', 'America/Los_Angeles')
  expect(la.getTime() - detroit.getTime() === 3 * 60 * 60 * 1000,
    'Los Angeles (PDT) end-of-day is 3 hours later in UTC than Detroit (EDT) on the same date')
}

{
  const tokyo = endOfDayInTimezone('2026-09-19', 'Asia/Tokyo')
  expect(tokyo.toISOString() === '2026-09-19T14:59:59.999Z',
    'positive UTC offset (Tokyo, UTC+9) resolves correctly too')
}

// ── startOfDayInTimezone ──────────────────────────────────────────────────
{
  const instant = startOfDayInTimezone('2026-09-19', 'America/Detroit')
  expect(instant.toISOString() === '2026-09-19T04:00:00.000Z',
    'Detroit local midnight 2026-09-19 is 2026-09-19T04:00:00.000Z UTC')
}

// ── todayInTimezone ───────────────────────────────────────────────────────
{
  const utcDate = todayInTimezone('UTC', new Date('2026-09-19T23:00:00.000Z'))
  const tokyoDate = todayInTimezone('Asia/Tokyo', new Date('2026-09-19T23:00:00.000Z'))
  expect(utcDate === '2026-09-19' && tokyoDate === '2026-09-20',
    'todayInTimezone can disagree with the UTC calendar date near a day boundary')
}

// ── addDays: pure calendar arithmetic, no tz involved ──────────────────────
{
  expect(addDays('2026-09-26', 7) === '2026-10-03', 'adds across a month boundary')
  expect(addDays('2026-10-29', 7) === '2026-11-05', 'adds across the US fall-back DST transition without drifting')
  expect(addDays('2026-09-01', -1) === '2026-08-31', 'supports negative deltas')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll tenant-date checks passed.')
}
