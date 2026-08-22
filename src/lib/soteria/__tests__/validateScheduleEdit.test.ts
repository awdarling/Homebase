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
  resolveEffectiveAvailability,
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

const emp = (id: string, roles: string[], maxHrs = 40, extra: Partial<ValidatorEmployee> = {}): ValidatorEmployee => ({
  id, name: id, qualified_roles: roles, max_weekly_hours: maxHrs, ...extra,
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
    maxConsecutiveDays: opts.maxConsecutiveDays,
    touchedCells: opts.touchedCells,
    shiftTypes: opts.shiftTypes,
    shiftRequirements: opts.shiftRequirements,
    experienceRules: opts.experienceRules,
    sexCoverage: opts.sexCoverage,
  })
}

// ── THE BUG: custom availability must block an otherwise-allowed swap ──────────
{
  const a = emp('A', ['Lifeguard'])
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
  const issues = run([am, pmShift('A')], ['A'], [a])
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

// ── SOTERIA-SCOPE-1: new deterministic checks ──────────────────────────────────

// consecutive days: 4 in a row, guideline 3 → non-blocking reminder
{
  const a = emp('A', ['Lifeguard'])
  const days = ['2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25'].map(d => pmShift('A', d))
  const issues = run(days, ['A'], [a], { maxConsecutiveDays: 3 })
  const c = issues.find(i => i.code === 'consecutive_days')
  expect(!!c && c.severity === 'warning', 'working more days in a row than the guideline is a (non-blocking) reminder')
}
// consecutive days: exactly at the guideline → no reminder
{
  const a = emp('A', ['Lifeguard'])
  const days = ['2026-06-22', '2026-06-23', '2026-06-24'].map(d => pmShift('A', d))
  const issues = run(days, ['A'], [a], { maxConsecutiveDays: 3 })
  expect(!issues.some(i => i.code === 'consecutive_days'), 'working exactly the guideline number of days is fine')
}

// sex coverage: two males on duty, rule needs 1 male + 1 female → warn missing female
{
  const m1 = emp('M1', ['Lifeguard'], 40, { sex: 'male' })
  const m2 = emp('M2', ['Lifeguard'], 40, { sex: 'male' })
  const issues = run([pmShift('M1'), pmShift('M2')], ['M1', 'M2'], [m1, m2], {
    touchedCells: new Set(['PM||' + WED]),
    sexCoverage: { attribute: 'sex', minimums: { male: 1, female: 1 }, population_roles: ['Lifeguard', 'Headguard'] },
  })
  const c = issues.find(i => i.code === 'sex_coverage')
  expect(!!c && c.severity === 'warning', 'an all-male on-duty window trips the 1-male-1-female coverage rule (warning)')
}
// sex coverage: one male + one female → satisfied, no warning
{
  const m1 = emp('M1', ['Lifeguard'], 40, { sex: 'male' })
  const f1 = emp('F1', ['Lifeguard'], 40, { sex: 'female' })
  const issues = run([pmShift('M1'), pmShift('F1')], ['M1', 'F1'], [m1, f1], {
    touchedCells: new Set(['PM||' + WED]),
    sexCoverage: { attribute: 'sex', minimums: { male: 1, female: 1 }, population_roles: ['Lifeguard', 'Headguard'] },
  })
  expect(!issues.some(i => i.code === 'sex_coverage'), 'a mixed-sex on-duty window satisfies the coverage rule')
}

// veteran rule: all_veterans shift with a non-veteran → warning
{
  const nonVet = emp('N', ['Lifeguard'], 40, { is_veteran: false })
  const issues = run([pmShift('N')], ['N'], [nonVet], {
    touchedCells: new Set(['PM||' + WED]),
    shiftTypes: [{ id: 'st-pm', name: 'PM', start_time: '13:00:00', end_time: '21:00:00', days_active: [0, 1, 2, 3, 4, 5, 6] }],
    experienceRules: [{ shift_type_id: 'st-pm', days_of_week: null, role: null, mode: 'all_veterans', min_count: null, season_start: null, season_end: null, active: true }],
  })
  const c = issues.find(i => i.code === 'veteran_rule')
  expect(!!c && c.severity === 'warning', 'a non-veteran on a veterans-only shift is flagged (warning)')
}
// veteran rule: veteran on the same shift → satisfied
{
  const vet = emp('V', ['Lifeguard'], 40, { is_veteran: true })
  const issues = run([pmShift('V')], ['V'], [vet], {
    touchedCells: new Set(['PM||' + WED]),
    shiftTypes: [{ id: 'st-pm', name: 'PM', start_time: '13:00:00', end_time: '21:00:00', days_active: [0, 1, 2, 3, 4, 5, 6] }],
    experienceRules: [{ shift_type_id: 'st-pm', days_of_week: null, role: null, mode: 'all_veterans', min_count: null, season_start: null, season_end: null, active: true }],
  })
  expect(!issues.some(i => i.code === 'veteran_rule'), 'a veteran satisfies a veterans-only shift')
}

// understaffing: shift needs 2 Lifeguards, only 1 filled → warning
{
  const a = emp('A', ['Lifeguard'])
  const issues = run([pmShift('A')], ['A'], [a], {
    touchedCells: new Set(['PM||' + WED]),
    shiftTypes: [{ id: 'st-pm', name: 'PM', start_time: '13:00:00', end_time: '21:00:00', days_active: [0, 1, 2, 3, 4, 5, 6] }],
    shiftRequirements: [{ shift_type_id: 'st-pm', role: 'Lifeguard', required_count: 2, accepted_roles: ['Lifeguard'] }],
  })
  const c = issues.find(i => i.code === 'understaffed')
  expect(!!c && c.severity === 'warning', 'a shift left short of its required count is flagged (warning)')
}
// understaffing: required count met → no warning
{
  const a = emp('A', ['Lifeguard'])
  const b = emp('B', ['Lifeguard'])
  const issues = run([pmShift('A'), pmShift('B')], ['A'], [a, b], {
    touchedCells: new Set(['PM||' + WED]),
    shiftTypes: [{ id: 'st-pm', name: 'PM', start_time: '13:00:00', end_time: '21:00:00', days_active: [0, 1, 2, 3, 4, 5, 6] }],
    shiftRequirements: [{ shift_type_id: 'st-pm', role: 'Lifeguard', required_count: 2, accepted_roles: ['Lifeguard'] }],
  })
  expect(!issues.some(i => i.code === 'understaffed'), 'a shift with its required count filled is not flagged')
}

// A pre-existing gap the edit did NOT touch is NOT re-surfaced (no noise).
{
  const a = emp('A', ['Lifeguard'])
  const issues = run([pmShift('A', WED)], ['A'], [a], {
    touchedCells: new Set(['PM||' + WED]),
    shiftTypes: [{ id: 'st-pm', name: 'PM', start_time: '13:00:00', end_time: '21:00:00', days_active: [0, 1, 2, 3, 4, 5, 6] }],
    shiftRequirements: [{ shift_type_id: 'st-pm', role: 'Lifeguard', required_count: 1, accepted_roles: ['Lifeguard'] }],
  })
  // A different day's cell (Thu) is understaffed in reality but wasn't touched → not checked.
  expect(!issues.some(i => i.code === 'understaffed'), 'untouched cells are not re-flagged (scoped to the edit)')
}

// ── Finding 1: partial-day time off must NOT block a non-overlapping shift ──────
// pmShift is WED 13:00–21:00.

// The reported live false-positive: a 09:00–13:00 partial off no longer blocks a
// PM shift that starts at 13:00 (touching, not overlapping).
{
  const a = emp('A', ['Lifeguard'])
  const issues = run([pmShift('A')], ['A'], [a], {
    timeOff: [{
      employee_id: 'A', start_date: WED, end_date: WED, time_off_type: 'partial',
      partial_days: [{ date: WED, type: 'custom_hours', start_time: '09:00', end_time: '13:00' }],
    }],
  })
  expect(!issues.some(i => i.code === 'time_off'), 'partial morning-off does NOT block a non-overlapping PM shift (the reported false positive)')
}

// A partial off-window that DOES overlap the shift still blocks.
{
  const a = emp('A', ['Lifeguard'])
  const issues = run([pmShift('A')], ['A'], [a], {
    timeOff: [{
      employee_id: 'A', start_date: WED, end_date: WED, time_off_type: 'partial',
      partial_days: [{ date: WED, type: 'custom_hours', start_time: '12:00', end_time: '23:59' }],
    }],
  })
  expect(issues.some(i => i.code === 'time_off'), 'partial off-window overlapping the shift still blocks (true positive)')
}

// A full-day time off still blocks (regression guard for the common case).
{
  const a = emp('A', ['Lifeguard'])
  const issues = run([pmShift('A')], ['A'], [a], {
    timeOff: [{ employee_id: 'A', start_date: WED, end_date: WED, time_off_type: 'full_day' }],
  })
  expect(issues.some(i => i.code === 'time_off'), 'full_day time off still blocks the whole day')
}

// A partial off on a DIFFERENT day than the shift does not block.
{
  const a = emp('A', ['Lifeguard'])
  const issues = run([pmShift('A', WED)], ['A'], [a], {
    timeOff: [{
      employee_id: 'A', start_date: '2026-06-22', end_date: '2026-06-26', time_off_type: 'partial',
      partial_days: [{ date: '2026-06-25', type: 'custom_hours', start_time: '00:00', end_time: '23:59' }],
    }],
  })
  expect(!issues.some(i => i.code === 'time_off'), 'a partial off on another day does not block this shift')
}

// shift_off partial: blocks only the named shift.
{
  const a = emp('A', ['Lifeguard'])
  const matchIssues = run([pmShift('A')], ['A'], [a], {
    timeOff: [{
      employee_id: 'A', start_date: WED, end_date: WED, time_off_type: 'partial',
      partial_days: [{ date: WED, type: 'shift_off', shift_name: 'PM', start_time: null, end_time: null }],
    }],
  })
  expect(matchIssues.some(i => i.code === 'time_off'), 'shift_off partial blocks the matching named shift')
  const noMatchIssues = run([pmShift('A')], ['A'], [a], {
    timeOff: [{
      employee_id: 'A', start_date: WED, end_date: WED, time_off_type: 'partial',
      partial_days: [{ date: WED, type: 'shift_off', shift_name: 'AM', start_time: null, end_time: null }],
    }],
  })
  expect(!noMatchIssues.some(i => i.code === 'time_off'), 'shift_off partial for a different shift does not block')
}

// Back-compat: a legacy time-off row with no time_off_type still blocks whole-day.
{
  const a = emp('A', ['Lifeguard'])
  const issues = run([pmShift('A')], ['A'], [a], {
    timeOff: [{ employee_id: 'A', start_date: '2026-06-23', end_date: '2026-06-25' }],
  })
  expect(issues.some(i => i.code === 'time_off'), 'legacy time-off row (no type) still blocks whole-day')
}

// ── Finding 3: future-effective custom availability must NOT apply early ────────
// The symmetric start gate: a custom override applies only for weeks whose
// week_start is on/after effective_start_date. WEEK_START = 2026-06-22 (Mon).
const NARROW_MON = [{ day_of_week: 1, start_time: '09:00', end_time: '12:00' }] // only Mon 9–12

// effective_start_date in the FUTURE relative to the week → custom does not apply.
{
  const custom: CustomAvailability = {
    id: 'ca-fut', employee_id: 'A', company_id: 'c', type: 'date_limited',
    effective_start_date: '2026-07-06', end_date: null,
    cycle_weeks: null, cycle_start_date: null,
    patterns: NARROW_MON, active: true, created_at: '2026-01-01T00:00:00Z',
  }
  const eff = resolveEffectiveAvailability(WEEK_START, allWeekAvail(), custom)
  expect(!eff.customApplied, 'a future-effective override does NOT apply to an earlier week (resolver falls back to normal)')
}

// A future-effective override does not block a shift this week (end-to-end).
{
  const a = emp('A', ['Lifeguard'])
  const custom: CustomAvailability = {
    id: 'ca-fut2', employee_id: 'A', company_id: 'c', type: 'date_limited',
    effective_start_date: '2026-07-06', end_date: null,
    cycle_weeks: null, cycle_start_date: null,
    patterns: NARROW_MON, active: true, created_at: '2026-01-01T00:00:00Z',
  }
  const issues = run([pmShift('A')], ['A'], [a], { customByEmp: new Map([['A', custom]]) })
  expect(!issues.some(i => i.code === 'custom_availability'), 'future-effective override does not block this week’s shift')
}

// effective_start_date on/before the week → the override applies (and here it
// does NOT cover the Wed PM shift, so it correctly blocks).
{
  const a = emp('A', ['Lifeguard'])
  const custom: CustomAvailability = {
    id: 'ca-now', employee_id: 'A', company_id: 'c', type: 'date_limited',
    effective_start_date: '2026-06-15', end_date: null,
    cycle_weeks: null, cycle_start_date: null,
    patterns: NARROW_MON, active: true, created_at: '2026-01-01T00:00:00Z',
  }
  const eff = resolveEffectiveAvailability(WEEK_START, allWeekAvail(), custom)
  expect(eff.customApplied, 'an override whose effective start is on/before the week applies')
  const issues = run([pmShift('A')], ['A'], [a], { customByEmp: new Map([['A', custom]]) })
  expect(issues.some(i => i.code === 'custom_availability'), 'an active override that doesn’t cover the shift still blocks')
}

// effective_start_date exactly == weekStart → applies (inclusive boundary).
{
  const custom: CustomAvailability = {
    id: 'ca-eq', employee_id: 'A', company_id: 'c', type: 'date_limited',
    effective_start_date: WEEK_START, end_date: null,
    cycle_weeks: null, cycle_start_date: null,
    patterns: NARROW_MON, active: true, created_at: '2026-01-01T00:00:00Z',
  }
  const eff = resolveEffectiveAvailability(WEEK_START, allWeekAvail(), custom)
  expect(eff.customApplied, 'effective_start_date == week_start applies (inclusive)')
}

// null effective_start_date → applies immediately (back-compat, unchanged).
{
  const custom: CustomAvailability = {
    id: 'ca-null', employee_id: 'A', company_id: 'c', type: 'date_limited',
    effective_start_date: null, end_date: null,
    cycle_weeks: null, cycle_start_date: null,
    patterns: NARROW_MON, active: true, created_at: '2026-01-01T00:00:00Z',
  }
  const eff = resolveEffectiveAvailability(WEEK_START, allWeekAvail(), custom)
  expect(eff.customApplied, 'null effective_start_date applies immediately (back-compat)')
}

// ── Departing-employee advisory — NARROWED by L1 ──────────────────────────────
// WEEK_START = 2026-06-22 (Mon); week end = 2026-06-28. WED = 2026-06-24.
//
// Feature B fired this for ANY assigned person whose last_day fell on or before
// the week, because the Aegis builder ignored last_day completely. L1 makes the
// builder gate per date (engine/eligibility.ts isPastLastDay), so the trigger is
// now the actual defect: an assignment DATE strictly AFTER the last day. The
// boundary is `>`, never `>=` — the employee works their last day.
const TUE = '2026-06-23'
const THU = '2026-06-25'
const FRI = '2026-06-26'
{
  // THE NARROWING: scheduled ON their last day → NOT flagged. Pre-L1 this
  // warned on every correctly-built final week, which trained managers to
  // dismiss the advisory.
  const a = emp('A', ['Lifeguard'], 40, { last_day: WED })
  const issues = run([pmShift('A', WED)], ['A'], [a])
  expect(!issues.some(i => i.code === 'departing_employee'), 'working ON the last day is legitimate and is not flagged')
}
{
  // Scheduled BEFORE their last day → not flagged either.
  const a = emp('A', ['Lifeguard'], 40, { last_day: WED })
  const issues = run([pmShift('A', TUE)], ['A'], [a])
  expect(!issues.some(i => i.code === 'departing_employee'), 'working before the last day is not flagged')
}
{
  // THE REAL DEFECT: scheduled AFTER their last day → one non-blocking warning.
  // Post-L1 the builder cannot produce this, so it means a hand edit.
  const a = emp('A', ['Lifeguard'], 40, { last_day: WED })
  const issues = run([pmShift('A', THU)], ['A'], [a])
  const dep = issues.filter(i => i.code === 'departing_employee')
  expect(dep.length === 1, 'a shift after the last day is flagged once')
  expect(dep[0]?.severity === 'warning', 'the departing-employee flag is a NON-BLOCKING warning, never an error')
  expect(!issues.some(i => i.code === 'departing_employee' && i.severity === 'error'), 'departing-employee never blocks publishing')
  expect(dep[0]?.description.includes(THU) === true, 'the warning names the offending date')
}
{
  // Mixed week — legitimate days AND an over-run day. Flagged once, and the
  // message must name ONLY the offending dates, not the whole week.
  const a = emp('A', ['Lifeguard'], 40, { last_day: WED })
  const issues = run([pmShift('A', TUE), pmShift('A', WED), pmShift('A', THU), pmShift('A', FRI)], ['A'], [a])
  const dep = issues.filter(i => i.code === 'departing_employee')
  expect(dep.length === 1, 'a departing employee is flagged once, not once per shift')
  expect(dep[0]?.description.includes(THU) && dep[0]?.description.includes(FRI) === true, 'both offending dates are named')
  expect(dep[0]?.description.includes(TUE) === false, 'a legitimate pre-departure day is NOT named as a problem')
}
{
  // last_day BEFORE the week (already gone) → every assigned day is after it.
  const a = emp('A', ['Lifeguard'], 40, { last_day: '2026-06-01' })
  const issues = run([pmShift('A')], ['A'], [a])
  expect(issues.some(i => i.code === 'departing_employee'), 'an employee whose last day is before the week is flagged when still scheduled')
}
{
  // last_day AFTER this week → no flag (nothing is past it).
  const a = emp('A', ['Lifeguard'], 40, { last_day: '2026-07-15' })
  const issues = run([pmShift('A')], ['A'], [a])
  expect(!issues.some(i => i.code === 'departing_employee'), 'a future last day beyond this week does not flag this week')
}
{
  // no last_day → no flag (back-compat).
  const a = emp('A', ['Lifeguard'])
  const issues = run([pmShift('A')], ['A'], [a])
  expect(!issues.some(i => i.code === 'departing_employee'), 'an employee with no last day is never flagged')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll validateScheduleEdit checks passed.')
}
