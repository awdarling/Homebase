// Runtime test for the W-3 flag review display (J-1d, DRIFT_REGISTER §N7).
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register --project tsconfig.scripts.json \
//         src/lib/schedule/__tests__/w3FlagDisplay.test.ts

import { describeReviewFlag, reviewableFlags } from '../flagDisplay'
import { coverageFlagKey } from '../coverageFlagDismiss'
import type { FlaggedIssue } from '@/lib/types'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

// Mia's real week-of-Aug-17 shape (Aegis W-1 branch 3 produces this).
const zero: FlaggedIssue = {
  type: 'zero_shifts',
  date: '2026-08-17',
  description: 'Mia Shaffer: 0 shifts — unavailable on this day/time (7 slots). availability Sun–Sat 09:00–12:00; time off Aug 17–21 09:00–13:00 and 15:00–21:00.',
  metadata: {
    employee_id: 'mia', employee_name: 'Mia Shaffer',
    reasons: { 'unavailable on this day/time': 7 },
    availability: 'Sun–Sat 09:00–12:00',
    time_off: 'Aug 17–21 09:00–13:00 and 15:00–21:00',
    eligible_slots: 0,
  },
}
const dbl: FlaggedIssue = {
  type: 'double_booking',
  date: '2026-08-19',
  description: 'Katie Schillaci holds two overlapping shifts on Aug 19',
  metadata: {
    employee_id: 'katie', employee_name: 'Katie Schillaci',
    shifts: [
      { shift_name: 'AM Weekday', role: 'Lifeguard', start_time: '11:00', end_time: '15:30' },
      { shift_name: 'Afternoon', role: 'Lifeguard', start_time: '15:00', end_time: '20:15' },
    ],
  },
}
const sex: FlaggedIssue = {
  type: 'unsatisfied_sex_coverage',
  date: '2026-08-18',
  description: '',
  metadata: { time_window: { start: '13:00', end: '17:00' }, missing_sex: 'female', on_duty: [{ name: 'Rob', role: 'Lifeguard', sex: 'male' }] },
}
const mix: FlaggedIssue = { type: 'unsatisfied_attribute_mix', date: '2026-08-18', shift_name: 'AM', description: 'x', metadata: {} }

// ── zero_shifts renders, red, named, with the engine's own words ────────────
{
  const d = describeReviewFlag(zero)!
  expect(!!d, 'zero_shifts flag is renderable')
  expect(d.tone === 'red', 'zero_shifts is red (a real problem, not a judgement call)')
  expect(d.title === 'Mia Shaffer: no shifts this week', `title names the person (got "${d.title}")`)
  expect(d.lines[0].includes('availability Sun–Sat 09:00–12:00'), 'detail carries the engine description verbatim')
}

// ── double_booking renders with both shifts ─────────────────────────────────
{
  const d = describeReviewFlag(dbl)!
  expect(d.tone === 'red', 'double_booking is red')
  expect(d.title === 'Katie Schillaci is double-booked', 'double_booking title names the person')
  expect(d.lines.some(l => l.includes('AM Weekday') && l.includes('Afternoon')), 'both overlapping shifts are named')
}

// ── sex coverage renders exactly as before W-3 ──────────────────────────────
{
  const d = describeReviewFlag(sex)!
  expect(d.title === 'No female guard on duty', 'sex-coverage title unchanged')
  expect(d.lines[0].includes('13:00–17:00'), 'sex-coverage window line unchanged')
  expect(d.tone === 'amber', 'sex-coverage stays amber')
}

// ── attribute_mix stays unrendered (explicitly, as before) ──────────────────
expect(describeReviewFlag(mix) === null, 'unsatisfied_attribute_mix is still not shown')

// ── review list: red before amber; the unknown type dropped ─────────────────
{
  const list = reviewableFlags([sex, mix, zero, dbl])
  expect(list.length === 3, `3 of 4 flags renderable (got ${list.length})`)
  expect(list[0].display.tone === 'red' && list[1].display.tone === 'red' && list[2].display.tone === 'amber', 'red flags sort first')
}

// ── dismiss keys: per-person for the new types; sex-coverage key UNCHANGED ──
{
  expect(coverageFlagKey(zero) === 'zero_shifts|2026-08-17|mia', `zero_shifts keys on the person (got "${coverageFlagKey(zero)}")`)
  const zero2 = { ...zero, metadata: { ...zero.metadata, employee_id: 'katie' } }
  expect(coverageFlagKey(zero) !== coverageFlagKey(zero2 as FlaggedIssue), 'two same-day zero-shift flags do NOT share a dismiss key')
  expect(coverageFlagKey(sex) === 'unsatisfied_sex_coverage|2026-08-18|13:00|17:00|female', 'W-1 sex-coverage keys keep their exact shape (stored dismissals survive)')
}

if (failures > 0) { console.error(`\n${failures} check(s) failed.`); process.exit(1) }
console.log('\nAll w3FlagDisplay checks passed.')
