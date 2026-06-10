import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import * as os from 'os'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import type { Schedule, ScheduleTemplate } from '../src/lib/types'
import {
  buildScheduleGrid,
  type ShiftMeta,
  type EventRow,
} from '../src/lib/schedule/buildScheduleGrid'
import { renderScheduleGridXlsx } from '../src/lib/schedule/renderScheduleGridXlsx'
import { renderScheduleGridHtml } from '../src/lib/schedule/renderScheduleGridHtml'

function expect(cond: boolean, msg: string) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1) }
  else console.log('✓ ' + msg)
}

// ── Synthetic fixture ────────────────────────────────────────────────────────
//
// Week of Mon Jun 1 2026 → Sun Jun 7 2026 (the spec ASCII shows Jun 2–8 but
// our fixture uses 1–7; the dates are arbitrary, the layout is what matters).
//
// 5 shifts × 7 days
// 1 gap: Thursday AM Weekday Lifeguard, 2 required / 0 filled (kind='gap')
// 1 closed day: Sunday with event 'Memorial Day'

const COMPANY_ID = '00000000-0000-0000-0000-000000000001'
const COMPANY_NAME = 'Watermark Country Club'

const SHIFTS = [
  { name: 'AM Weekday',  start_time: '11:30', end_time: '15:30', days_active: ['monday','tuesday','wednesday','thursday','friday'] },
  { name: 'AM Weekend',  start_time: '09:30', end_time: '15:30', days_active: ['saturday','sunday'] },
  { name: 'Mid',         start_time: '14:30', end_time: '18:30', days_active: ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] },
  { name: 'PM Weekday',  start_time: '15:30', end_time: '21:30', days_active: ['monday','tuesday','wednesday','thursday','friday'] },
  { name: 'PM Weekend',  start_time: '15:30', end_time: '21:30', days_active: ['saturday','sunday'] },
] satisfies ShiftMeta[]

function makeAssignment(args: { date: string; shift: string; emp_id: string; emp_name: string; role: string; start: string; end: string }) {
  return {
    date: args.date,
    employee_id: args.emp_id,
    employee_name: args.emp_name,
    shift_name: args.shift,
    role: args.role,
    start_time: args.start,
    end_time: args.end,
    hours: 4,
  }
}

const ASSIGNMENTS = [
  // AM Weekday — Audrey M-F + a 2nd person varied
  makeAssignment({ date: '2026-06-01', shift: 'AM Weekday', emp_id: 'e-audrey', emp_name: 'Audrey Miller',    role: 'Lifeguard', start: '11:30', end: '15:30' }),
  makeAssignment({ date: '2026-06-01', shift: 'AM Weekday', emp_id: 'e-karsten', emp_name: 'Karsten Brown',   role: 'Lifeguard', start: '11:30', end: '15:30' }),
  makeAssignment({ date: '2026-06-02', shift: 'AM Weekday', emp_id: 'e-audrey', emp_name: 'Audrey Miller',    role: 'Lifeguard', start: '11:30', end: '15:30' }),
  makeAssignment({ date: '2026-06-02', shift: 'AM Weekday', emp_id: 'e-karsten', emp_name: 'Karsten Brown',   role: 'Lifeguard', start: '11:30', end: '15:30' }),
  makeAssignment({ date: '2026-06-03', shift: 'AM Weekday', emp_id: 'e-audrey', emp_name: 'Audrey Miller',    role: 'Lifeguard', start: '11:30', end: '15:30' }),
  makeAssignment({ date: '2026-06-03', shift: 'AM Weekday', emp_id: 'e-letzia', emp_name: 'Letzia Park',      role: 'Lifeguard', start: '11:30', end: '15:30' }),
  // 2026-06-04 (Thursday): gap — no assignments, 2 required
  makeAssignment({ date: '2026-06-05', shift: 'AM Weekday', emp_id: 'e-audrey', emp_name: 'Audrey Miller',    role: 'Lifeguard', start: '11:30', end: '15:30' }),
  makeAssignment({ date: '2026-06-05', shift: 'AM Weekday', emp_id: 'e-ian',    emp_name: 'Ian Park',         role: 'Lifeguard', start: '11:30', end: '15:30' }),
  // AM Weekend — Sat only (Sun closed)
  makeAssignment({ date: '2026-06-06', shift: 'AM Weekend', emp_id: 'e-kori',   emp_name: 'Kori Allen',       role: 'Lifeguard', start: '09:30', end: '15:30' }),
  makeAssignment({ date: '2026-06-06', shift: 'AM Weekend', emp_id: 'e-ally',   emp_name: 'Ally Roberts',     role: 'Lifeguard', start: '09:30', end: '15:30' }),
  // PM Weekend — Sat
  makeAssignment({ date: '2026-06-06', shift: 'PM Weekend', emp_id: 'e-mia',    emp_name: 'Mia Lopez',        role: 'Lifeguard', start: '15:30', end: '21:30' }),
  // Mid — every weekday + Sat
  makeAssignment({ date: '2026-06-01', shift: 'Mid', emp_id: 'e-jay',  emp_name: 'Jay Park',  role: 'Manager', start: '14:30', end: '18:30' }),
  makeAssignment({ date: '2026-06-02', shift: 'Mid', emp_id: 'e-jay',  emp_name: 'Jay Park',  role: 'Manager', start: '14:30', end: '18:30' }),
  makeAssignment({ date: '2026-06-03', shift: 'Mid', emp_id: 'e-jay',  emp_name: 'Jay Park',  role: 'Manager', start: '14:30', end: '18:30' }),
  makeAssignment({ date: '2026-06-04', shift: 'Mid', emp_id: 'e-jay',  emp_name: 'Jay Park',  role: 'Manager', start: '14:30', end: '18:30' }),
  makeAssignment({ date: '2026-06-05', shift: 'Mid', emp_id: 'e-jay',  emp_name: 'Jay Park',  role: 'Manager', start: '14:30', end: '18:30' }),
  makeAssignment({ date: '2026-06-06', shift: 'Mid', emp_id: 'e-jay',  emp_name: 'Jay Park',  role: 'Manager', start: '14:30', end: '18:30' }),
]

const GAPS = [
  { date: '2026-06-04', shift_name: 'AM Weekday', role: 'Lifeguard', required_count: 2, filled_count: 0, reason: 'no qualified candidates' },
]

const SCHEDULE: Schedule = {
  id: 'sched-smoke',
  company_id: COMPANY_ID,
  week_start: '2026-06-01',
  week_end: '2026-06-07',
  status: 'draft',
  generated_by: 'smoke',
  generated_at: '2026-06-01T00:00:00.000Z',
  approved_at: null,
  distributed_at: null,
  data: {
    assignments: ASSIGNMENTS,
    gaps: GAPS,
    summary: '',
    closed_dates: ['2026-06-07'],  // Sunday closed
  },
  staffing_report: null,
}

const TEMPLATE: ScheduleTemplate = {
  id: 'tmpl-smoke',
  company_id: COMPANY_ID,
  layout_type: 'shift-rows-day-columns',
  row_config: SHIFTS.map((s, i) => ({ id: s.name, label: s.name, height: 120, visible: true, order: i })),
  column_config: [
    // week_start=Monday → order = (day - 1 + 7) % 7
    { day: 0, label: 'Sunday',    width: 100, color: '#8B0000', visible: true, order: 6 },
    { day: 1, label: 'Monday',    width: 100, color: '#FF8C00', visible: true, order: 0 },
    { day: 2, label: 'Tuesday',   width: 100, color: '#DAA520', visible: true, order: 1 },
    { day: 3, label: 'Wednesday', width: 100, color: '#556B2F', visible: true, order: 2 },
    { day: 4, label: 'Thursday',  width: 100, color: '#00008B', visible: true, order: 3 },
    { day: 5, label: 'Friday',    width: 100, color: '#4B0082', visible: true, order: 4 },
    { day: 6, label: 'Saturday',  width: 100, color: '#4169E1', visible: true, order: 5 },
  ],
  color_config: { by: 'day', map: {} },
  display_options: { show_photos: false, font_size: 'sm', show_hours: true, show_role: true, show_start_end: false, compact: false },
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
}

const EVENTS: EventRow[] = [
  { date: '2026-06-07', title: 'Memorial Day' },
]

// ── Build grid ───────────────────────────────────────────────────────────────

const grid = buildScheduleGrid({ schedule: SCHEDULE, template: TEMPLATE, companyName: COMPANY_NAME, shifts: SHIFTS, events: EVENTS })

// Grid sanity assertions
expect(grid.columns.length === 7, `grid has 7 columns (got ${grid.columns.length})`)
expect(grid.columns[0].dayLabel === 'Monday', `first column is Monday (got ${grid.columns[0].dayLabel})`)
expect(grid.columns[6].dayLabel === 'Sunday', `last column is Sunday (got ${grid.columns[6].dayLabel})`)
expect(grid.columns[6].isClosed === true, 'Sunday column is flagged closed')
expect(grid.columns[6].closureTitle === 'Memorial Day', `Sunday closure title is 'Memorial Day' (got ${grid.columns[6].closureTitle})`)
expect(grid.rows.length === 5, `grid has 5 shift rows (got ${grid.rows.length})`)
expect(grid.rows[0].label === 'AM Weekday', `first shift row is AM Weekday (got ${grid.rows[0].label})`)

// Thursday is column index 3 (Mon=0,Tue=1,Wed=2,Thu=3)
const thuAmWeekdayCell = grid.rows[0].cells[3]
expect(thuAmWeekdayCell.kind === 'gap', `Thursday AM Weekday cell is 'gap' (got '${thuAmWeekdayCell.kind}')`)
expect(thuAmWeekdayCell.gapRole === 'Lifeguard', `gap cell records role 'Lifeguard'`)
expect(thuAmWeekdayCell.unfilledCount === 2, `gap cell records 2 unfilled`)

// Saturday AM Weekend cell should have Kori + Ally
const satIdx = grid.columns.findIndex(c => c.dayLabel === 'Saturday')
const satAmWeekendCell = grid.rows[1].cells[satIdx]
expect(satAmWeekendCell.kind === 'filled', `Saturday AM Weekend is 'filled'`)
expect(
  satAmWeekendCell.employeeDisplayNames.includes('Ally') && satAmWeekendCell.employeeDisplayNames.includes('Kori'),
  `Sat AM Weekend cell shows Kori + Ally first names (got ${JSON.stringify(satAmWeekendCell.employeeDisplayNames)})`,
)

// Sunday is closed — every cell in that column is kind='closed'
for (const row of grid.rows) {
  if (row.cells[6].kind !== 'closed') {
    console.error(`✗ Sunday cell in row ${row.label} should be closed, got ${row.cells[6].kind}`)
    process.exit(1)
  }
}
console.log('✓ Every Sunday cell across all rows is kind=\'closed\'')

// First-name collision: Audrey Miller + Audrey would collide if duplicated.
// We have multiple Park last-names (Jay, Letzia, Ian) — no first-name collision
// among those, so they render as bare first names.
const audreyCell = grid.rows[0].cells[0]  // Mon AM Weekday
expect(
  audreyCell.employeeDisplayNames.includes('Audrey'),
  `Audrey renders as bare first name (got ${JSON.stringify(audreyCell.employeeDisplayNames)})`,
)

// ── Excel formatter (exceljs; renderer is now async) ─────────────────────────

async function main() {
  const xlsxBuf = await renderScheduleGridXlsx(grid)
  expect(xlsxBuf.byteLength > 0, `xlsx buffer is non-empty (${xlsxBuf.byteLength} bytes)`)

  const tmpXlsx = path.join(os.tmpdir(), `tmp-smoke-schedule-grid-${process.pid}.xlsx`)
  fs.writeFileSync(tmpXlsx, xlsxBuf)

  // Read the exceljs-written workbook back with SheetJS to confirm the file is a
  // valid, standard .xlsx and that the logical content (values + merges) survived.
  const wb = XLSX.read(xlsxBuf, { type: 'buffer' })
  expect(wb.SheetNames.includes('Schedule'), `workbook has 'Schedule' sheet`)
  const ws = wb.Sheets['Schedule']

  // Row 0 is the title row (merged).
  expect(
    String(ws['A1']?.v ?? '').startsWith('Watermark Country Club — Week of'),
    `A1 contains company-name + week-range header (got "${String(ws['A1']?.v ?? '')}")`,
  )

  // Row 2 is the day-header row: A3='Shift', B3='Monday\nJun 1', ..., H3='Sunday\nJun 7'.
  expect(String(ws['A3']?.v ?? '') === 'Shift', `A3='Shift' (got "${String(ws['A3']?.v ?? '')}")`)
  expect(
    String(ws['B3']?.v ?? '').startsWith('Monday'),
    `B3 day-header is Monday (got "${String(ws['B3']?.v ?? '')}")`,
  )
  expect(
    String(ws['H3']?.v ?? '').startsWith('Sunday'),
    `H3 day-header is Sunday (got "${String(ws['H3']?.v ?? '')}")`,
  )

  // Row 3 is first shift (AM Weekday). A4 contains 'AM Weekday'.
  expect(String(ws['A4']?.v ?? '').startsWith('AM Weekday'), `A4 shift label is 'AM Weekday'`)
  // E4 is Thursday cell for AM Weekday → should contain 'UNFILLED — Lifeguard'.
  expect(
    String(ws['E4']?.v ?? '').includes('UNFILLED'),
    `E4 (Thursday AM Weekday) contains 'UNFILLED' (got "${String(ws['E4']?.v ?? '')}")`,
  )
  expect(
    String(ws['E4']?.v ?? '').includes('Lifeguard'),
    `E4 (Thursday AM Weekday) contains role 'Lifeguard'`,
  )

  // H4 is Sunday closed-day cell for the first shift row — should contain CLOSED — Memorial Day.
  expect(
    String(ws['H4']?.v ?? '').includes('CLOSED'),
    `H4 (Sun, first row) contains 'CLOSED' (got "${String(ws['H4']?.v ?? '')}")`,
  )
  expect(
    String(ws['H4']?.v ?? '').includes('Memorial Day'),
    `H4 includes event title 'Memorial Day'`,
  )

  // Closed-day vertical merge: rows 3..7 (0-indexed) of column 7 should be merged.
  const merges = ws['!merges'] ?? []
  const sundayClosureMerge = merges.find(m => m.s.c === 7 && m.e.c === 7 && m.s.r === 3 && m.e.r === 7)
  expect(!!sundayClosureMerge, `Sunday closure column has a vertical merge across all 5 shift rows`)

  // exceljs-specific: confirm real cell styling now reaches the file (the whole
  // point of the swap — the SheetJS community build dropped these). Re-read with
  // exceljs so we can inspect fills/fonts/freeze that SheetJS does not surface.
  const ewb = new ExcelJS.Workbook()
  await ewb.xlsx.readFile(tmpXlsx)
  const ews = ewb.getWorksheet('Schedule')!
  const titleFill = (ews.getCell('A1').fill as ExcelJS.FillPattern)
  expect(titleFill?.type === 'pattern' && !!titleFill.fgColor?.argb, `A1 has a real solid fill (got ${JSON.stringify(titleFill?.fgColor)})`)
  const gapCell = ews.getCell('E4')
  const gapFill = (gapCell.fill as ExcelJS.FillPattern)
  expect(gapFill?.fgColor?.argb === 'FFFDECEC', `E4 gap cell has the red gap fill (got ${gapFill?.fgColor?.argb})`)
  expect((gapCell.font?.color?.argb) === 'FFB91C1C', `E4 gap text is red (got ${gapCell.font?.color?.argb})`)
  const frozen = ews.views?.[0]
  expect(frozen?.state === 'frozen' && frozen.xSplit === 1 && frozen.ySplit === 3, `header row + label column are frozen (got ${JSON.stringify(frozen)})`)

  try { fs.unlinkSync(tmpXlsx) } catch { /* best-effort cleanup */ }

  // ── HTML formatter (PDF path renders from this same HTML) ──────────────────

  const html = renderScheduleGridHtml(grid)
  expect(html.includes('<!DOCTYPE html>'), `HTML output is a full document`)
  expect(html.includes('Watermark Country Club'), `HTML contains company name`)
  expect(html.includes('Week of Jun 1–7, 2026'), `HTML contains week-range label`)
  expect(html.includes('UNFILLED — Lifeguard'), `HTML contains gap text 'UNFILLED — Lifeguard'`)
  expect(html.includes('CLOSED — Memorial Day'), `HTML contains closure label 'CLOSED — Memorial Day'`)
  expect(html.includes('Kori') && html.includes('Ally'), `HTML contains employee first names in cells`)
  expect(html.includes('@media print'), `HTML has print CSS rules`)
  expect(html.includes('size: landscape'), `HTML print CSS is landscape`)
  expect(html.includes('rowspan="5"'), `HTML closure cell uses rowspan=5 (one per shift row)`)
  expect(html.includes('— Aegis'), `HTML footer mentions Aegis attribution`)

  // Cross-formatter parity: the same grid drives both downloads, so the gap and
  // closure text that appears in the Excel cells must also appear in the PDF/HTML.
  expect(
    String(ws['E4']?.v ?? '').includes('Lifeguard') && html.includes('UNFILLED — Lifeguard'),
    `Excel + PDF/HTML agree on the Thursday Lifeguard gap`,
  )
  expect(
    String(ws['H4']?.v ?? '').includes('Memorial Day') && html.includes('CLOSED — Memorial Day'),
    `Excel + PDF/HTML agree on the Sunday closure`,
  )

  // ── DOWNLOAD-500 regression: real-shaped ScheduleData the original fixture
  //    never had. Both renderers must handle each WITHOUT throwing. Before the
  //    null-guard fix, case (1) threw in buildScheduleGrid (.trim() on null),
  //    500-ing BOTH the Excel and PDF downloads. ──────────────────────────────
  const mkSchedule = (data: Schedule['data']): Schedule => ({
    id: 'sched-real', company_id: COMPANY_ID,
    week_start: '2026-06-01', week_end: '2026-06-07',
    status: 'draft', generated_by: 'smoke', generated_at: '2026-06-01T00:00:00.000Z',
    approved_at: null, distributed_at: null, data, staffing_report: null,
  })
  async function rendersClean(label: string, schedule: Schedule, evs: EventRow[] = []) {
    try {
      const g = buildScheduleGrid({ schedule, template: TEMPLATE, companyName: COMPANY_NAME, shifts: SHIFTS, events: evs })
      const xlsxBuf2 = await renderScheduleGridXlsx(g)
      const html2 = renderScheduleGridHtml(g)
      expect(xlsxBuf2.byteLength > 0 && html2.length > 0, `real-shaped: ${label} → Excel + PDF both render (no throw)`)
    } catch (e) {
      console.error(`✗ real-shaped: ${label} THREW → ${e instanceof Error ? e.message : e}`)
      process.exit(1)
    }
  }
  // (1) null/empty employee_name — the DOWNLOAD-500 prime suspect.
  await rendersClean('null + empty employee_name', mkSchedule({
    assignments: [
      { date: '2026-06-01', employee_id: 'e1', employee_name: null as unknown as string, shift_name: 'AM Weekday', role: 'Lifeguard', start_time: '11:30', end_time: '15:30', hours: 4 },
      { date: '2026-06-02', employee_id: 'e2', employee_name: '', shift_name: 'AM Weekday', role: 'Lifeguard', start_time: '11:30', end_time: '15:30', hours: 4 },
    ],
    gaps: [], summary: '', closed_dates: [],
  }))
  // (2) an all-gaps day (no assignments, an unfilled requirement).
  await rendersClean('all-gaps day', mkSchedule({
    assignments: [],
    gaps: [{ date: '2026-06-04', shift_name: 'AM Weekday', role: 'Lifeguard', required_count: 2, filled_count: 0, reason: 'no candidates' }],
    summary: '', closed_dates: [],
  }))
  // (3) a completely empty schedule (no assignments, no gaps).
  await rendersClean('empty schedule (no assignments, no gaps)', mkSchedule({ assignments: [], gaps: [], summary: '', closed_dates: [] }))
  // (4) multiple closed days.
  await rendersClean('multiple closed days', mkSchedule({ assignments: [], gaps: [], summary: '', closed_dates: ['2026-06-01', '2026-06-04', '2026-06-07'] }),
    [{ date: '2026-06-01', title: 'Holiday A' }, { date: '2026-06-07', title: 'Holiday B' }])

  console.log('\n✓ All smoke-schedule-grid-download assertions passed')
}

main().catch(err => { console.error(err); process.exit(1) })
