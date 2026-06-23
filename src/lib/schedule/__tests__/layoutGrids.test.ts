// Runtime test harness for the alternate-layout row models (TEMPLATE-EDIT-2).
// Mirrors the SOTERIA-CHECK-1 pattern: a plain Node script, run via ts-node.
//
// Run:  npx ts-node --transpile-only --project tsconfig.scripts.json \
//         src/lib/schedule/__tests__/layoutGrids.test.ts

import { buildEmployeeRowModel, buildRoleRowModel } from '../layoutGrids'
import type { ScheduleAssignment } from '@/lib/types'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const a = (over: Partial<ScheduleAssignment>): ScheduleAssignment => ({
  date: '2026-05-04', employee_id: 'e1', employee_name: 'Ann', employee_photo: null,
  shift_name: 'Morning', role: 'Lifeguard', start_time: '09:00', end_time: '17:00', hours: 8, ...over,
})

const MON = '2026-05-04'
const TUE = '2026-05-05'

// ── Employee rows: one row per person, sorted by name ────────────────────────
{
  const rows = buildEmployeeRowModel([
    a({ employee_id: 'e2', employee_name: 'Zoe', date: MON }),
    a({ employee_id: 'e1', employee_name: 'Ann', date: MON }),
    a({ employee_id: 'e1', employee_name: 'Ann', date: TUE, shift_name: 'Evening' }),
  ])
  expect(rows.length === 2, 'one row per distinct employee')
  expect(rows[0].label === 'Ann' && rows[1].label === 'Zoe', 'employee rows are sorted by name')
  expect(rows[0].cellsByDate[MON].length === 1 && rows[0].cellsByDate[TUE].length === 1, "an employee's shifts land in their own day cells")
}

// ── Employee rows: same person, two shifts one day (a double) ────────────────
{
  const rows = buildEmployeeRowModel([
    a({ date: MON, shift_name: 'Morning', start_time: '09:00' }),
    a({ date: MON, shift_name: 'Evening', start_time: '17:00' }),
  ])
  expect(rows.length === 1 && rows[0].cellsByDate[MON].length === 2, 'two shifts on one day both appear in the cell')
  expect(rows[0].cellsByDate[MON][0].shift_name === 'Morning', 'cell assignments are ordered by start time')
}

// ── Role rows: one row per role, everyone on that role that day ───────────────
{
  const rows = buildRoleRowModel([
    a({ employee_id: 'e1', employee_name: 'Ann', role: 'Lifeguard', date: MON }),
    a({ employee_id: 'e2', employee_name: 'Bo', role: 'Lifeguard', date: MON }),
    a({ employee_id: 'e3', employee_name: 'Cy', role: 'Manager', date: MON }),
  ])
  expect(rows.length === 2, 'one row per distinct role')
  const lg = rows.find(r => r.label === 'Lifeguard')
  expect(lg?.cellsByDate[MON].length === 2, 'both lifeguards share the Lifeguard row cell that day')
}

// ── Role rows honor an explicit role order, else alphabetical ─────────────────
{
  const rows = buildRoleRowModel([
    a({ role: 'Lifeguard' }), a({ role: 'Manager' }), a({ role: 'Headguard' }),
  ], ['Manager', 'Headguard', 'Lifeguard'])
  expect(rows.map(r => r.label).join(',') === 'Manager,Headguard,Lifeguard', 'roles follow the provided order')
}
{
  const rows = buildRoleRowModel([a({ role: 'Manager' }), a({ role: 'Headguard' })])
  expect(rows.map(r => r.label).join(',') === 'Headguard,Manager', 'roles fall back to alphabetical with no order given')
}

// ── Rows missing the key field are skipped ───────────────────────────────────
{
  const empRows = buildEmployeeRowModel([a({ employee_id: '' })])
  expect(empRows.length === 0, 'assignment with no employee_id is skipped in employee model')
  const roleRows = buildRoleRowModel([a({ role: '' })])
  expect(roleRows.length === 0, 'assignment with no role is skipped in role model')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll layoutGrids checks passed.')
}
