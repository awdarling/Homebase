// Runtime test harness for existing-schedule inference (pillar 2 follow-on).
// Mirrors the SOTERIA-CHECK-1 pattern: a plain Node script, run via ts-node.
//
// Run:  npx ts-node --transpile-only --project tsconfig.scripts.json \
//         src/lib/soteria/__tests__/scheduleInference.test.ts

import { inferShiftStructureFromSchedule, type ScheduleRowInput } from '../scheduleInference'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures++
  }
}

const row = (shift_name: string, role: string, day_of_week: number, start_time = '09:00', end_time = '17:00'): ScheduleRowInput =>
  ({ shift_name, role, day_of_week, start_time, end_time });

// ── Basic structure: one shift, its days, and a role requirement ─────────────
{
  const { bundle } = inferShiftStructureFromSchedule([
    row('Morning', 'Lifeguard', 1), row('Morning', 'Lifeguard', 2), row('Morning', 'Lifeguard', 3),
  ])
  const st = bundle.shift_types?.[0]
  expect(bundle.shift_types?.length === 1, 'distinct shift name yields one shift type')
  expect(JSON.stringify(st?.days_active) === JSON.stringify([1, 2, 3]), 'days_active is the union of days seen, sorted')
  expect(st?.start_time === '09:00' && st?.end_time === '17:00', 'hours are carried from the rows')
  expect(!!(st?.role_requirements?.length === 1 && st?.role_requirements?.[0]?.required_count === 1), 'a single-guard shift needs 1 of that role')
  expect(bundle.roles?.some(r => r.name === 'Lifeguard'), 'roles seen in the schedule are included for creation')
}

// ── required_count = max staffed on any single day ───────────────────────────
{
  const { bundle } = inferShiftStructureFromSchedule([
    row('AM', 'Lifeguard', 1), row('AM', 'Lifeguard', 1),           // Monday: 2 lifeguards
    row('AM', 'Lifeguard', 2),                                       // Tuesday: 1 lifeguard
    row('AM', 'Headguard', 1),                                       // Monday: 1 headguard
  ])
  const st = bundle.shift_types?.find(s => s.name === 'AM')
  const lg = st?.role_requirements?.find(r => r.accepted_roles[0] === 'Lifeguard')
  const hg = st?.role_requirements?.find(r => r.accepted_roles[0] === 'Headguard')
  expect(lg?.required_count === 2, 'lifeguard count is the busiest single day (2), not the total')
  expect(hg?.required_count === 1, 'headguard count is 1')
}

// ── Modal hours win when a shift has mixed times ─────────────────────────────
{
  const { bundle } = inferShiftStructureFromSchedule([
    row('Eve', 'Lifeguard', 1, '17:00', '21:00'),
    row('Eve', 'Lifeguard', 2, '17:00', '21:00'),
    row('Eve', 'Lifeguard', 3, '18:00', '21:00'), // odd one out
  ])
  const st = bundle.shift_types?.[0]
  expect(st?.start_time === '17:00', 'the most common start time is chosen')
}

// ── Multiple shifts kept distinct (case-insensitive) ─────────────────────────
{
  const { bundle } = inferShiftStructureFromSchedule([
    row('Morning', 'Lifeguard', 1), row('morning', 'Lifeguard', 2), row('Evening', 'Lifeguard', 5),
  ])
  expect(bundle.shift_types?.length === 2, 'shift names are merged case-insensitively into distinct shifts')
}

// ── Bad rows skipped + warned ────────────────────────────────────────────────
{
  const res = inferShiftStructureFromSchedule([
    { shift_name: 'Morning', role: 'Lifeguard', day_of_week: 1, start_time: '09:00', end_time: '17:00' },
    { shift_name: '', role: 'Lifeguard', day_of_week: 1 },
    { shift_name: 'Morning', role: 'Lifeguard', day_of_week: 9 },
  ])
  expect(res.bundle.shift_types?.length === 1, 'rows with no shift name or a bad day are dropped')
  expect(res.warnings.some(w => w.includes('Skipped') && w.includes('2')), 'the two bad rows are reported')
}

// ── A shift with no readable hours is skipped with guidance ──────────────────
{
  const res = inferShiftStructureFromSchedule([
    { shift_name: 'Mystery', role: 'Lifeguard', day_of_week: 1 },
  ])
  expect((res.bundle.shift_types?.length ?? 0) === 0, 'a shift with no times is not invented')
  expect(res.warnings.some(w => w.includes('Mystery') && w.includes('hours')), 'the manager is told to add the hours')
}

// ── A shift with hours but no roles still gets created (slots added later) ────
{
  const res = inferShiftStructureFromSchedule([
    { shift_name: 'Open', day_of_week: 1, start_time: '08:00', end_time: '12:00' },
  ])
  expect(res.bundle.shift_types?.length === 1, 'a roleless shift with hours is still set up')
  expect(res.warnings.some(w => w.includes('Open') && w.includes('no roles')), 'the missing roles are flagged')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll scheduleInference checks passed.')
}
