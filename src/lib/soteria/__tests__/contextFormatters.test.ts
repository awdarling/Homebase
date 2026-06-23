// Runtime test harness for the Pillar-4 context formatters.
// Mirrors the SOTERIA-CHECK-1 pattern: a plain Node script with assertions,
// run via ts-node --transpile-only. The formatters are pure, so no DB/network.
//
// Run:  npx ts-node --transpile-only --project tsconfig.scripts.json \
//         src/lib/soteria/__tests__/contextFormatters.test.ts

import {
  formatDayList,
  formatAvailabilitySection,
  formatCustomAvailabilitySection,
  formatVeteranRulesSection,
} from '../contextFormatters'
import type { Availability, CustomAvailability, ShiftExperienceRule } from '@/lib/types'

let failures = 0
function expect(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures++
  }
}

const emps = [
  { id: 'e1', name: 'Maria' },
  { id: 'e2', name: 'Sam' },
]

const av = (employee_id: string, day_of_week: number, start_time: string, end_time: string): Availability =>
  ({ id: `${employee_id}-${day_of_week}`, employee_id, company_id: 'c1', day_of_week, start_time, end_time })

// ── formatDayList ────────────────────────────────────────────────────────────
expect(formatDayList([0, 6]) === 'Saturdays & Sundays', 'day list orders weekend Saturday-first (Monday-first ordering)')
expect(formatDayList([3]) === 'Wednesdays', 'day list with one day')
expect(formatDayList([1, 3, 5]) === 'Mondays, Wednesdays & Fridays', 'day list with three days uses serial comma + ampersand')
expect(formatDayList([]) === '', 'empty day list is blank')

// ── formatAvailabilitySection ─────────────────────────────────────────────────
{
  const out = formatAvailabilitySection(emps, [
    av('e1', 3, '13:00:00', '21:00:00'),
    av('e1', 1, '09:00:00', '17:00:00'),
  ])
  expect(out.includes('Maria: Mon 09:00–17:00, Wed 13:00–21:00'), 'availability sorted Monday-first with seconds trimmed')
  expect(out.includes('Sam: no recurring availability set'), 'employee with no availability rows is flagged')
}
expect(formatAvailabilitySection([], []) === '', 'no employees → empty availability section')

// ── formatCustomAvailabilitySection ───────────────────────────────────────────
{
  const dateLimited: CustomAvailability = {
    id: 'ca1', employee_id: 'e1', company_id: 'c1', type: 'date_limited',
    end_date: '2026-08-31', cycle_weeks: null, cycle_start_date: null,
    patterns: [{ day_of_week: 1, start_time: '13:00', end_time: '21:00' }],
    active: true, created_at: '',
  }
  const inactive: CustomAvailability = { ...dateLimited, id: 'ca2', employee_id: 'e2', active: false }
  const out = formatCustomAvailabilitySection(emps, [dateLimited, inactive])
  expect(out.includes('Maria: temporary date-limited availability until 2026-08-31 — Mon 13:00–21:00'),
    'date-limited override described with end date and hours')
  expect(!out.includes('Sam'), 'inactive custom availability is excluded')
}
{
  const rotating: CustomAvailability = {
    id: 'ca3', employee_id: 'e2', company_id: 'c1', type: 'rotating',
    end_date: '2026-09-30', cycle_weeks: 2, cycle_start_date: '2026-06-22',
    patterns: [
      { week: 1, days: [{ day_of_week: 6, start_time: '08:00', end_time: '16:00' }] },
      { week: 2, days: [] },
    ],
    active: true, created_at: '',
  }
  const out = formatCustomAvailabilitySection(emps, [rotating])
  expect(out.includes('2-week rotation') && out.includes('starting 2026-06-22') && out.includes('until 2026-09-30'),
    'rotating override states cycle length, start, and end')
  expect(out.includes('Week 1: Sat 08:00–16:00') && out.includes('Week 2: (off)'),
    'rotating override lists each week, marking empty weeks as off')
}
expect(formatCustomAvailabilitySection(emps, []) === '', 'no custom availability → empty section')

// ── formatVeteranRulesSection ─────────────────────────────────────────────────
const shiftNames = new Map<string, string>([['st1', 'Afternoon']])
const rule = (over: Partial<ShiftExperienceRule>): ShiftExperienceRule => ({
  id: 'r1', company_id: 'c1', shift_type_id: 'st1', days_of_week: null, role: null,
  mode: 'all_veterans', min_count: null, season_start: null, season_end: null,
  active: true, created_by: 'soteria', created_at: '', ...over,
});
{
  const out = formatVeteranRulesSection([rule({})], shiftNames)
  expect(out.includes('Afternoon: Veterans only'), 'all_veterans rule resolves shift name and phrasing')
}
{
  const out = formatVeteranRulesSection(
    [rule({ mode: 'min_veterans', min_count: 2, days_of_week: [0, 6], role: 'Lifeguard' })],
    shiftNames,
  )
  expect(out.includes('At least 2 veterans on Saturdays & Sundays (Lifeguard only)'),
    'min_veterans rule shows count, day scope, and role scope')
}
{
  // shift_type_id is nullable in the DB (and the executor writes null) even
  // though the shared type declares it string; cast to represent the real row.
  const out = formatVeteranRulesSection([rule({ shift_type_id: null as unknown as string })], shiftNames)
  expect(out.includes('every shift: Veterans only'), 'rule with no shift_type_id applies to every shift')
}
{
  const out = formatVeteranRulesSection([rule({ active: false })], shiftNames)
  expect(out === '', 'inactive veteran rule is excluded')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll contextFormatters checks passed.')
}
