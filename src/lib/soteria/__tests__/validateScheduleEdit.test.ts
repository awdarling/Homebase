// Runtime test harness for the deterministic schedule-edit validator.
// Homebase has no test runner yet, so this mirrors Aegis's engine smoke-test
// pattern: a plain Node script with assertions, run via ts-node. The validator
// imports only TYPES from '@/lib/types' (erased at runtime), so --transpile-only
// needs no path-alias resolution.
//
// Run:  npx ts-node --transpile-only --project tsconfig.scripts.json \
//         src/lib/soteria/__tests__/validateScheduleEdit.test.ts

import {
  validateScheduleEdit,
  type ValidatorAssignment,
  type ValidatorEmployee,
  type ValidatorAvailability,
  type ValidateScheduleEditInput,
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

const WEEK_START = '2026-06-22' // Monday
const WED = '2026-06-24' // Wednesday (dow 3)

const emp = (id: string, roles: string[], maxHrs = 40): ValidatorEmployee => ({
  id, name: id, qualified_roles: roles, max_weekly_hours: maxHrs,
})
const allWeekAvail = (): ValidatorAvailability[] =>
  [0, 1, 2, 3, 4, 5, 6].map(d => ({ day_of_week: d, start_time: '00:00', end_time: '23:59' }))
const pmShift = (empId: string, date = WED): ValidatorAssignment => ({
  employee_id: empId, employee_name: empId, date, shift_name: 'PM', role: 'Lifeguard',
  start_time: '13:00:00', end_time: '21:00:00', hours: 8,
})

function run(
  assignments: ValidatorAssignment[],
  touched: string[],
  employees: ValidatorEmployee[],
  opts: Partial<ValidateScheduleEditInput> = {},
) {
  const employeesById = new Map(employees.map(e => [e.id, e]))
  const availByEmp = opts.availByEmp ?? new Map(employees.map(e => [e.id, allWeekAvail()]))
  return validateScheduleEdit({
    weekStart: WEEK_START,
    proposedAssignments: assignments,
    touchedEmployeeIds: touched,
    employeesById,
    availByEmp,
    customByEmp: opts.customByEmp ?? new Map(),
    timeOff: opts.timeOff ?? [],
    conflicts: opts.conflicts ?? [],
  })
}

// ── THE BUG: custom availability must block an otherwise-allowed swap ──────────
{
  const a = emp('A', ['Lifeguard'])
  // Custom availability: only Mondays 09:00–12:00 this week. A PM Wed shift is impossible.
  const custom: CustomAvailability = {
    id: 'ca-A', employee_id: 'A', company_id: 'c', type: 'date_limited',
    end_date: null, cycle_weeks: null, cycle_start_date: null,
    patterns: [{ day_of_week: 1, start_time: '09:00', end_time: '12:00' }],
    active: true, created_at: '2026-01-01T00:00:00Z',
  }
  const issues = run([pmShift('A')], ['A'], [a], { customByEmp: new Map([['A', custom]]) })
  expect(
    issues.some(i => i.code === 'custom_availability' && i.severity === 'error'),
    'custom availability blocks a swap the manager tried to make (the reported bug)',
  )
}

// Control: same shift, NO custom availability + full normal availability → allowed.
{
  const a = emp('A', ['Lifeguard'])
  const issues = run([pmShift('A')], ['A'], [a])
  expect(issues.length === 0, 'fully-available qualified employee on a normal shift → no issues')
}

// Expired custom availability falls back to normal availability (not blocking).
{
  const a = emp('A', ['Lifeguard'])
  const expired: CustomAvailability = {
    id: 'ca-exp', employee_id: 'A', company_id: 'c', type: 'date_limited',
    end_date: '2026-06-01', cycle_weeks: null, cycle_start_date: null,
    patterns: [{ day_of_week: 1, start_time: '09:00', end_time: '12:00' }],
    active: true, created_at: '2026-01-01T00:00:00Z',
  }
  const issues = run([pmShift('A')], ['A'], [a], { customByEmp: new Map([['A', expired]]) })
  expect(issues.length === 0, 'expired custom availability falls back to normal availability (no false block)')
}

// Rotating custom availability: week 1 of the cycle covers the Wed PM shift → allowed.
{
  const a = emp('A', ['Lifeguard'])
  const rotating: CustomAvailability = {
    id: 'ca-rot', employee_id: 'A', company_id: 'c', type: 'rotating',
    end_date: null, cycle_weeks: 2, cycle_start_date: WEEK_START,
    patterns: [
      { week: 1, days: [{ day_of_week: 3, start_time: '09:00', end_time: '23:00' }] },
      { week: 2, days: [] },
    ],
    active: true, created_at: '2026-01-01T00:00:00Z',
  }
  const issues = run([pmShift('A')], ['A'], [a], { customByEmp: new Map([['A', rotating]]) })
  expect(issues.length === 0, 'rotating custom availability week 1 covers the shift → no issue')
}

// ── other hard rules ──────────────────────────────────────────────────────────
{
  const a = emp('A', ['Greeter']) // not a Lifeguard
  const issues = run([pmShift('A')], ['A'], [a])
  expect(issues.some(i => i.code === 'not_qualified'), 'unqualified role is flagged')
}
{
  const a = emp('A', ['Lifeguard'])
  const issues = run([pmShift('A')], ['A'], [a], {
    timeOff: [{ employee_id: 'A', start_date: '2026-06-23', end_date: '2026-06-25' }],
  })
  expect(issues.some(i => i.code === 'time_off'), 'assignment during approved time off is flagged')
}
{
  const a = emp('A', ['Lifeguard'], 4) // 4h cap, two 8h shifts = 16h
  const issues = run([pmShift('A', '2026-06-23'), pmShift('A', WED)], ['A'], [a])
  expect(issues.some(i => i.code === 'max_hours'), 'exceeding weekly hours is flagged')
}
{
  const a = emp('A', ['Lifeguard', 'Headguard'])
  const am: ValidatorAssignment = {
    employee_id: 'A', employee_name: 'A', date: WED, shift_name: 'AM', role: 'Headguard',
    start_time: '11:00:00', end_time: '15:30:00', hours: 4.5,
  }
  const issues = run([am, pmShift('A')], ['A'], [a]) // AM 11–15:30 overlaps PM 13–21
  expect(issues.some(i => i.code === 'double_booking'), 'overlapping same-day shifts are flagged as double-booking')
}
{
  const a = emp('A', ['Lifeguard'])
  const b = emp('B', ['Lifeguard'])
  const issues = run([pmShift('A'), pmShift('B')], ['A'], [a, b], {
    conflicts: [{ employee_id_1: 'A', employee_id_2: 'B', severity: 'never' }],
  })
  expect(issues.some(i => i.code === 'banned_pair'), 'a never-together pair co-staffed in one cell is flagged')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll validateScheduleEdit checks passed.')
}
