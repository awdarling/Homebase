// Runtime test: the printed/emailed grid marks approved call-outs exactly as
// the on-screen card greys them (Alexander, 2026-08-27 — the shift STAYS on
// the schedule; the download must not disagree with the screen).
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register --project tsconfig.scripts.json \
//         src/lib/schedule/__tests__/w3CalledOutGrid.test.ts

import { buildScheduleGrid } from '../buildScheduleGrid'
import type { Schedule, ScheduleTemplate } from '@/lib/types'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const template: ScheduleTemplate = {
  id: 't', company_id: 'c', layout_type: 'shift-rows-day-columns',
  row_config: [{ id: 'Afternoon', label: 'Afternoon', height: 120, visible: true, order: 0 }],
  column_config: [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, label: 'D', width: 180, color: '#888', visible: true, order: day })),
  color_config: { by: 'none', map: {} },
  display_options: { show_photos: false, font_size: 'sm', show_hours: true, show_role: true, show_start_end: false, compact: false },
  created_at: '', updated_at: '',
}

const schedule = {
  id: 's', company_id: 'c', week_start: '2026-08-24', week_end: '2026-08-30',
  status: 'published', generated_by: 'aegis', generated_at: '', published_at: '',
  data: {
    assignments: [
      { date: '2026-08-24', employee_id: 'mia', employee_name: 'Mia Shaffer', shift_name: 'Afternoon', role: 'Lifeguard', start_time: '15:00', end_time: '20:15', hours: 5.25, called_out: true },
      { date: '2026-08-24', employee_id: 'rosa', employee_name: 'Rosa Alvarez', shift_name: 'Afternoon', role: 'Lifeguard', start_time: '15:00', end_time: '20:15', hours: 5.25 },
    ],
    gaps: [],
  },
} as unknown as Schedule

const grid = buildScheduleGrid({ schedule, template, companyName: 'Watermark', shifts: [], events: [] })
const names = grid.rows.flatMap(r => r.cells.flatMap(cell => cell.employees.map(e => e.name)))
expect(names.includes('Mia Shaffer (called out)'), `the called-out assignment is marked (got: ${JSON.stringify(names)})`)
expect(names.includes('Rosa Alvarez'), 'a normal assignment is untouched')
expect(!names.includes('Mia Shaffer'), 'the called-out name never appears unmarked')

if (failures > 0) { console.error(`\n${failures} check(s) failed.`); process.exit(1) }
console.log('\nAll w3CalledOutGrid checks passed.')
