// Runtime test harness for buildScheduleGrid — mirrors the validator harness
// (a plain ts-node assertion script, since Homebase has no test runner). This
// module imports from '@/lib/...', so run with the tsconfig-paths loader:
//
//   npx ts-node --transpile-only -r tsconfig-paths/register \
//     --project tsconfig.scripts.json \
//     src/lib/schedule/__tests__/buildScheduleGrid.test.ts
//
// Finding 2: the download/print path 500'd on a drifted template row (missing
// column_config / row_config / display_options). buildScheduleGrid now null-
// guards those, so a malformed template degrades gracefully instead of throwing.

import { buildScheduleGrid } from '../buildScheduleGrid'
import type { Schedule, ScheduleTemplate } from '@/lib/types'

let failures = 0
function expect(cond: boolean, msg: string): void {
  if (cond) console.log(`✓ ${msg}`)
  else { console.error(`✗ ${msg}`); failures++ }
}

const schedule: Schedule = {
  data: { assignments: [], gaps: [], closed_dates: [] },
  week_start: '2026-06-22',
  week_end: '2026-06-28',
} as unknown as Schedule

const wellFormedTemplate: ScheduleTemplate = {
  layout_type: 'shift-rows-day-columns',
  column_config: [
    { day: 1, label: 'Mon', order: 0, visible: true, width: 100, color: null },
  ],
  row_config: [
    { shift_name: 'AM', order: 0, visible: true },
  ],
  display_options: { show_role: true },
  color_config: { by: 'day', map: {} },
} as unknown as ScheduleTemplate

// Baseline: a well-formed template builds a grid.
{
  const grid = buildScheduleGrid({ schedule, template: wellFormedTemplate, companyName: 'Co', shifts: [], events: [] })
  expect(!!grid && Array.isArray(grid.columns), 'well-formed template builds a grid')
}

// Finding 2: a drifted template missing column_config / row_config /
// display_options must NOT throw (previously a 500 on the download path).
{
  const drifted = { layout_type: 'shift-rows-day-columns' } as unknown as ScheduleTemplate
  let threw = false
  let grid: ReturnType<typeof buildScheduleGrid> | null = null
  try {
    grid = buildScheduleGrid({ schedule, template: drifted, companyName: 'Co', shifts: [], events: [] })
  } catch {
    threw = true
  }
  expect(!threw, 'a template missing column_config/row_config/display_options does not throw')
  expect(!!grid && Array.isArray(grid.columns) && grid.columns.length === 0, 'missing column_config yields an empty column list, not a crash')
}

// Explicit nulls (drift where the keys exist but are null) are also tolerated.
{
  const nulled = {
    layout_type: 'shift-rows-day-columns',
    column_config: null, row_config: null, display_options: null,
  } as unknown as ScheduleTemplate
  let threw = false
  try {
    buildScheduleGrid({ schedule, template: nulled, companyName: 'Co', shifts: [], events: [] })
  } catch {
    threw = true
  }
  expect(!threw, 'null column_config/row_config/display_options do not throw')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll buildScheduleGrid checks passed.')
}
