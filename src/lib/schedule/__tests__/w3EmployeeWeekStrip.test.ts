// Runtime test for the W-3 per-employee availability + time-off strip (J-1d).
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register --project tsconfig.scripts.json \
//         src/lib/schedule/__tests__/w3EmployeeWeekStrip.test.ts
//
// Jack's complaint, verbatim: Mia had 0 shifts because "home page is saying
// she's busy both 9am–1pm and 3pm–9pm" while a 9–12 availability override sat
// on another screen. The strip puts all three facts on the schedule itself.

import { buildEmployeeWeekStrips, describeWindows } from '../employeeWeekStrip'
import type { Availability, CustomAvailability } from '@/lib/types'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const WEEK_START = '2026-08-17'
const WEEK_END = '2026-08-23'
const TODAY = '2026-08-18'

const avail = (employee_id: string, day_of_week: number, start_time: string, end_time: string): Availability =>
  ({ id: `${employee_id}-${day_of_week}`, employee_id, company_id: 'c', day_of_week, start_time, end_time })

const override = (employee_id: string, end_date: string | null, active = true): CustomAvailability => ({
  id: `o-${employee_id}`, employee_id, company_id: 'c', type: 'date_limited',
  end_date, cycle_weeks: null, cycle_start_date: null,
  patterns: [0, 1, 2, 3, 4, 5, 6].map(d => ({ day_of_week: d, start_time: '09:00', end_time: '12:00' })),
  active, created_at: '2026-08-14T00:00:00Z',
})

// ── describeWindows compacts runs ───────────────────────────────────────────
expect(
  describeWindows([1, 2, 3, 4, 5].map(d => ({ day_of_week: d, start_time: '09:00', end_time: '15:30' }))) === 'Mon–Fri 9:00 AM–3:30 PM',
  'consecutive days with one window collapse to a range',
)
expect(describeWindows([]) === 'none set', 'no windows reads "none set"')

// ── Mia: current override + two approved partial time-offs ──────────────────
{
  const strips = buildEmployeeWeekStrips({
    employeeIds: ['mia', 'rosa'],
    availability: [avail('mia', 1, '09:00', '20:15'), avail('rosa', 6, '09:00', '15:30')],
    overrides: [override('mia', '2026-08-23')],
    approvedTimeOff: [
      { employee_id: 'mia', start_date: '2026-08-17', end_date: '2026-08-21', time_off_type: 'partial', partial_days: [{ date: '2026-08-17', type: 'custom_hours', start_time: '09:00', end_time: '13:00' }] },
      { employee_id: 'mia', start_date: '2026-08-17', end_date: '2026-08-21', time_off_type: 'partial', partial_days: [{ date: '2026-08-17', type: 'custom_hours', start_time: '15:00', end_time: '21:00' }] },
    ],
    weekStart: WEEK_START, weekEnd: WEEK_END, today: TODAY,
  })
  const mia = strips['mia']
  expect(mia.availability.includes('override'), 'a CURRENT override is labelled as one')
  expect(mia.availability.includes('thru Aug 23'), 'the override end date is shown')
  expect(mia.availability.includes('9:00 AM–12:00 PM'), 'the override hours (the 9–12 that excluded every AM shift) are visible')
  expect(mia.timeOff.startsWith('Off: '), 'approved time off is on the same strip')
  expect(mia.timeOff.includes('9:00 AM – 1:00 PM'), 'partial windows show real hours')

  const rosa = strips['rosa']
  expect(rosa.availability === 'Avail: Sat 9:00 AM–3:30 PM', `no override → normal availability (got "${rosa.availability}")`)
  expect(rosa.timeOff === '', 'no approved time off → empty (renders nothing)')
}

// ── an EXPIRED override never shows (C-1's whole lesson) ────────────────────
{
  const strips = buildEmployeeWeekStrips({
    employeeIds: ['mia'],
    availability: [avail('mia', 1, '09:00', '20:15')],
    overrides: [override('mia', '2026-06-05')], // active=true but ended in June
    approvedTimeOff: [],
    weekStart: WEEK_START, weekEnd: WEEK_END, today: TODAY,
  })
  expect(!strips['mia'].availability.includes('override'), 'active=true with a past end_date is NOT "in force" (isCustomAvailabilityCurrent decides)')
  expect(strips['mia'].availability.includes('Mon 9:00 AM–8:15 PM'), 'the normal availability shows instead')
}

// ── time off outside the displayed week is not shown ────────────────────────
{
  const strips = buildEmployeeWeekStrips({
    employeeIds: ['mia'],
    availability: [],
    overrides: [],
    approvedTimeOff: [{ employee_id: 'mia', start_date: '2026-09-01', end_date: '2026-09-02', time_off_type: 'full_day', partial_days: null }],
    weekStart: WEEK_START, weekEnd: WEEK_END, today: TODAY,
  })
  expect(strips['mia'].timeOff === '', 'next month\'s time off stays off this week\'s strip')
}

if (failures > 0) { console.error(`\n${failures} check(s) failed.`); process.exit(1) }
console.log('\nAll w3EmployeeWeekStrip checks passed.')
