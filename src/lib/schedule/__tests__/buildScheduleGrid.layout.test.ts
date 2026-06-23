// Runtime test for the download grid builder honoring layout_type (slice 4).
// Mirrors the SOTERIA-CHECK-1 pattern: a plain Node script, run via ts-node.
//
// Run:  npx ts-node --transpile-only --project tsconfig.scripts.json \
//         src/lib/schedule/__tests__/buildScheduleGrid.layout.test.ts

import { buildScheduleGrid } from '../buildScheduleGrid'
import type { Schedule, ScheduleAssignment, ScheduleTemplate } from '@/lib/types'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON = '2026-05-04'
const TUE = '2026-05-05'

const asg = (over: Partial<ScheduleAssignment>): ScheduleAssignment => ({
  date: MON, employee_id: 'e1', employee_name: 'Ann', employee_photo: null,
  shift_name: 'Morning', role: 'Lifeguard', start_time: '09:00', end_time: '17:00', hours: 8, ...over,
})

const assignments: ScheduleAssignment[] = [
  asg({ employee_id: 'e1', employee_name: 'Ann', shift_name: 'Morning', role: 'Lifeguard', date: MON }),
  asg({ employee_id: 'e2', employee_name: 'Bo', shift_name: 'Morning', role: 'Lifeguard', date: MON }),
  asg({ employee_id: 'e1', employee_name: 'Ann', shift_name: 'Evening', role: 'Headguard', date: TUE }),
]

const schedule = {
  id: 's1', company_id: 'c1', week_start: MON, week_end: '2026-05-10',
  data: { assignments, gaps: [] },
} as unknown as Schedule

function tmpl(layout_type: ScheduleTemplate['layout_type']): ScheduleTemplate {
  return {
    id: 't1', company_id: 'c1', layout_type,
    row_config: [{ id: 'Morning', label: 'Morning', height: 80, visible: true, order: 0 }],
    column_config: [0, 1, 2, 3, 4, 5, 6].map(d => ({ day: d, label: DAYS[d], width: 180, color: '#888888', visible: true, order: d })),
    color_config: { by: 'day', map: {} },
    display_options: { show_photos: false, font_size: 'sm', show_hours: true, show_role: true, show_start_end: false, compact: false },
    created_at: '', updated_at: '',
  }
}

function build(layout: ScheduleTemplate['layout_type']) {
  return buildScheduleGrid({ schedule, template: tmpl(layout), companyName: 'Test Co', shifts: [], events: [] })
}
const colIndex = (grid: ReturnType<typeof build>, date: string) => grid.columns.findIndex(c => c.date === date)

// ── Shift-rows (default) still works ─────────────────────────────────────────
{
  const grid = build('shift-rows-day-columns')
  const morning = grid.rows.find(r => r.label === 'Morning')
  const monCell = morning?.cells[colIndex(grid, MON)]
  expect(!!morning, 'shift-rows: a Morning row exists')
  expect(monCell?.employees.map(e => e.name).sort().join(',') === 'Ann,Bo', 'shift-rows: Monday Morning cell names both people')
}

// ── Employee-rows: rows are people, cells name the SHIFT ──────────────────────
{
  const grid = build('employee-rows-day-columns')
  expect(grid.rows.map(r => r.label).join(',') === 'Ann,Bo', 'employee-rows: one row per person, sorted by name')
  const ann = grid.rows.find(r => r.label === 'Ann')!
  const annMon = ann.cells[colIndex(grid, MON)]
  const annTue = ann.cells[colIndex(grid, TUE)]
  expect(annMon.employees[0]?.name === 'Morning', "employee-rows: Ann's Monday cell names her shift (Morning)")
  expect(annMon.employees[0]?.role === 'Lifeguard', 'employee-rows: the shift cell still carries the (gated) role')
  expect(annTue.employees[0]?.name === 'Evening', "employee-rows: Ann's Tuesday cell names her Evening shift")
}

// ── Role-rows: rows are roles, cells name the people ──────────────────────────
{
  const grid = build('role-rows-day-columns')
  const lg = grid.rows.find(r => r.label === 'Lifeguard')!
  const lgMon = lg.cells[colIndex(grid, MON)]
  expect(grid.rows.some(r => r.label === 'Lifeguard') && grid.rows.some(r => r.label === 'Headguard'), 'role-rows: a row per role')
  expect(lgMon.employees.map(e => e.name).sort().join(',') === 'Ann,Bo', 'role-rows: Monday Lifeguard cell names both lifeguards')
}

// ── No-veteran invariant: download cells carry only name + role ──────────────
{
  const grid = build('employee-rows-day-columns')
  const cell = grid.rows.flatMap(r => r.cells).find(c => c.employees.length > 0)!
  expect(JSON.stringify(Object.keys(cell.employees[0]).sort()) === JSON.stringify(['name', 'role']),
    'download cell employees expose ONLY name + role — never veteran status')
}

// ── show_role=false hides roles in employee-rows too ─────────────────────────
{
  const t = tmpl('employee-rows-day-columns')
  t.display_options.show_role = false
  const grid = buildScheduleGrid({ schedule, template: t, companyName: 'Test Co', shifts: [], events: [] })
  const ann = grid.rows.find(r => r.label === 'Ann')!
  const annMon = ann.cells[grid.columns.findIndex(c => c.date === MON)]
  expect(annMon.employees[0]?.role === '', 'employee-rows respects show_role=false (no role line)')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll buildScheduleGrid layout checks passed.')
}
