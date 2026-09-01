import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import * as os from 'os'
import ExcelJS from 'exceljs'
import type { Schedule, ScheduleTemplate } from '../src/lib/types'
import {
  buildScheduleGrid,
  type ShiftMeta,
  type EventRow,
} from '../src/lib/schedule/buildScheduleGrid'
import { renderScheduleGridXlsx } from '../src/lib/schedule/renderScheduleGridXlsx'
import { renderScheduleGridHtml } from '../src/lib/schedule/renderScheduleGridHtml'
import { hexToArgb, blendOnWhite, resolveCellAppearance } from '../src/lib/schedule/resolveCellAppearance'

function expect(cond: boolean, msg: string) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1) }
  else console.log('✓ ' + msg)
}

// Reads a single cell's value out of an in-memory .xlsx buffer. Replaces the
// old `XLSX.read(buf).Sheets['Schedule'][addr]?.v` one-liner — SheetJS (the
// `xlsx` package) is gone from this repo (S-6: no fixed version on npm for
// its two open HIGH advisories). exceljs is already the writer, so it reads
// its own output back too.
async function cellValue(buf: Buffer, sheet: string, addr: string): Promise<unknown> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as any) // same exceljs/@types-node Buffer nominal clash as spreadsheetToCsv.ts
  return wb.getWorksheet(sheet)?.getCell(addr).value
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
  deleted_at: null,
  published_at: null,
  archived_at: null,
  superseded_by: null,
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

// Saturday AM Weekend cell should have Kori Allen + Ally Roberts — FULL names +
// role, matching the on-screen card (not collision-resolved first names).
const satIdx = grid.columns.findIndex(c => c.dayLabel === 'Saturday')
const satAmWeekendCell = grid.rows[1].cells[satIdx]
expect(satAmWeekendCell.kind === 'filled', `Saturday AM Weekend is 'filled'`)
expect(
  satAmWeekendCell.employees.some(e => e.name === 'Ally Roberts') && satAmWeekendCell.employees.some(e => e.name === 'Kori Allen'),
  `Sat AM Weekend cell shows FULL names Kori Allen + Ally Roberts (got ${JSON.stringify(satAmWeekendCell.employees)})`,
)
expect(
  satAmWeekendCell.employees.every(e => e.role === 'Lifeguard'),
  `Sat AM Weekend cell carries each assignment's role (got ${JSON.stringify(satAmWeekendCell.employees)})`,
)

// Sunday is closed — every cell in that column is kind='closed'
for (const row of grid.rows) {
  if (row.cells[6].kind !== 'closed') {
    console.error(`✗ Sunday cell in row ${row.label} should be closed, got ${row.cells[6].kind}`)
    process.exit(1)
  }
}
console.log('✓ Every Sunday cell across all rows is kind=\'closed\'')

// Filled cell carries the FULL name (first + last) AND the role per assignment,
// matching the on-screen card — this is the name+role regression guard at the
// grid level (the download used to drop the last name + role).
const audreyCell = grid.rows[0].cells[0]  // Mon AM Weekday
expect(
  audreyCell.employees.some(e => e.name === 'Audrey Miller' && e.role === 'Lifeguard'),
  `Audrey renders as full name 'Audrey Miller' with role 'Lifeguard' (got ${JSON.stringify(audreyCell.employees)})`,
)

// ── Excel formatter (exceljs; renderer is now async) ─────────────────────────

async function main() {
  const xlsxBuf = await renderScheduleGridXlsx(grid)
  expect(xlsxBuf.byteLength > 0, `xlsx buffer is non-empty (${xlsxBuf.byteLength} bytes)`)

  const tmpXlsx = path.join(os.tmpdir(), `tmp-smoke-schedule-grid-${process.pid}.xlsx`)
  fs.writeFileSync(tmpXlsx, xlsxBuf)

  // Read the exceljs-written workbook back — with exceljs — to confirm the file
  // is a valid, standard .xlsx and that the logical content (values + merges +
  // styling) survived. (Previously this cross-checked with a second library,
  // SheetJS's `xlsx`; that package is gone from this repo — S-6, two open HIGH
  // advisories with no fixed version on npm — so exceljs now reads its own
  // output back, and also carries the style checks that only it could do.)
  const ewb = new ExcelJS.Workbook()
  await ewb.xlsx.readFile(tmpXlsx)
  expect(!!ewb.getWorksheet('Schedule'), `workbook has 'Schedule' sheet`)
  const ews = ewb.getWorksheet('Schedule')! // existence just asserted above; expect() exits on failure
  const wsCell = (addr: string) => ews.getCell(addr).value

  // Row 0 is the title row (merged).
  expect(
    String(wsCell('A1') ?? '').startsWith('Watermark Country Club — Week of'),
    `A1 contains company-name + week-range header (got "${String(wsCell('A1') ?? '')}")`,
  )

  // Row 2 is the day-header row: A3='Shift', B3='Monday\nJun 1', ..., H3='Sunday\nJun 7'.
  expect(String(wsCell('A3') ?? '') === 'Shift', `A3='Shift' (got "${String(wsCell('A3') ?? '')}")`)
  expect(
    String(wsCell('B3') ?? '').startsWith('Monday'),
    `B3 day-header is Monday (got "${String(wsCell('B3') ?? '')}")`,
  )
  expect(
    String(wsCell('H3') ?? '').startsWith('Sunday'),
    `H3 day-header is Sunday (got "${String(wsCell('H3') ?? '')}")`,
  )

  // Row 3 is first shift (AM Weekday). A4 contains 'AM Weekday'.
  expect(String(wsCell('A4') ?? '').startsWith('AM Weekday'), `A4 shift label is 'AM Weekday'`)
  // NAME+ROLE regression guard (Excel): B4 is Monday AM Weekday (Audrey Miller +
  // Karsten Brown, both Lifeguard). The download used to drop the LAST NAME and
  // the ROLE — assert both reach the cell text now.
  const b4 = String(wsCell('B4') ?? '')
  expect(b4.includes('Audrey Miller'), `B4 contains FULL name 'Audrey Miller' incl. last name (got "${b4}")`)
  expect(b4.includes('Karsten Brown'), `B4 contains FULL name 'Karsten Brown' incl. last name (got "${b4}")`)
  expect(b4.includes('Lifeguard'), `B4 contains the assignment role 'Lifeguard' (got "${b4}")`)
  // E4 is Thursday cell for AM Weekday → should contain 'UNFILLED — Lifeguard'.
  expect(
    String(wsCell('E4') ?? '').includes('UNFILLED'),
    `E4 (Thursday AM Weekday) contains 'UNFILLED' (got "${String(wsCell('E4') ?? '')}")`,
  )
  expect(
    String(wsCell('E4') ?? '').includes('Lifeguard'),
    `E4 (Thursday AM Weekday) contains role 'Lifeguard'`,
  )

  // H4 is Sunday closed-day cell for the first shift row — should contain CLOSED — Memorial Day.
  expect(
    String(wsCell('H4') ?? '').includes('CLOSED'),
    `H4 (Sun, first row) contains 'CLOSED' (got "${String(wsCell('H4') ?? '')}")`,
  )
  expect(
    String(wsCell('H4') ?? '').includes('Memorial Day'),
    `H4 includes event title 'Memorial Day'`,
  )

  // Closed-day vertical merge: H4..H8 (the 5 shift rows in the Sunday column)
  // must all be merged into one block sharing the same master (top-left) cell.
  const sundayCol = ['H4', 'H5', 'H6', 'H7', 'H8'].map(addr => ews.getCell(addr))
  const sundayMerged = sundayCol.every(c => c.isMerged)
  const sundaySameMaster = sundayCol.every(c => c.master.address === sundayCol[0].master.address)
  expect(sundayMerged && sundaySameMaster, `Sunday closure column has a vertical merge across all 5 shift rows`)

  // exceljs-specific: confirm real cell styling reaches the file (the whole
  // point of the swap away from SheetJS's community build — it dropped these).
  const titleFill = (ews.getCell('A1').fill as ExcelJS.FillPattern)
  expect(titleFill?.type === 'pattern' && !!titleFill.fgColor?.argb, `A1 has a real solid fill (got ${JSON.stringify(titleFill?.fgColor)})`)
  const gapCell = ews.getCell('E4')
  const gapFill = (gapCell.fill as ExcelJS.FillPattern)
  // Post template-unification: a gap cell is no longer painted a flat red box.
  // It carries the Thursday day tint (col '#00008B' blended onto white at the
  // shared 0.06 alpha) — matching the on-screen grid, which shows a day-tinted
  // cell with a red gap pill — while the gap TEXT stays red.
  const thuTint = hexToArgb(blendOnWhite('#00008B', 0.06)) // 'FFF0F0F8'
  expect(gapFill?.fgColor?.argb === thuTint, `E4 gap cell carries the Thursday day tint ${thuTint} (got ${gapFill?.fgColor?.argb})`)
  expect((gapCell.font?.color?.argb) === 'FFB91C1C', `E4 gap text is still red (got ${gapCell.font?.color?.argb})`)
  const frozen = ews.views?.[0]
  expect(frozen?.state === 'frozen' && frozen.xSplit === 1 && frozen.ySplit === 3, `header row + label column are frozen (got ${JSON.stringify(frozen)})`)

  // ── ALL-BLUE REGRESSION GUARD ──────────────────────────────────────────────
  //
  // The bug this fix targets: the download forked its own color logic and
  // collapsed every per-day color into ONE shared navy (headers) / near-white
  // (cells), so the download looked nothing like the on-screen grid. A single-
  // column check could pass while still broken, so we assert TWO columns with
  // DISTINCT known template colors each reach the file as their OWN color —
  // never a shared default. (Cell color here is template DAY color, per the
  // resolveCellAppearance contract; this codebase has no role-color path.)
  const OLD_SHARED_NAVY = 'FF2A2A4E' // the single fill the forked code used for every day header
  const monHeaderFill = (ews.getCell('B3').fill as ExcelJS.FillPattern)?.fgColor?.argb // Monday '#FF8C00'
  const thuHeaderFill = (ews.getCell('E3').fill as ExcelJS.FillPattern)?.fgColor?.argb // Thursday '#00008B'
  expect(monHeaderFill === hexToArgb('#FF8C00'), `Monday header is its own orange ${hexToArgb('#FF8C00')} (got ${monHeaderFill})`)
  expect(thuHeaderFill === hexToArgb('#00008B'), `Thursday header is its own dark-blue ${hexToArgb('#00008B')} (got ${thuHeaderFill})`)
  expect(monHeaderFill !== thuHeaderFill, `two day headers are DISTINCT colors, not collapsed to one`)
  expect(monHeaderFill !== OLD_SHARED_NAVY && thuHeaderFill !== OLD_SHARED_NAVY, `neither day header fell back to the old shared navy`)

  // Filled body cells carry their own per-day tint too (not a single grey).
  const monBodyFill = (ews.getCell('B4').fill as ExcelJS.FillPattern)?.fgColor?.argb // Mon AM Weekday (filled)
  expect(monBodyFill === hexToArgb(blendOnWhite('#FF8C00', 0.06)), `Monday filled cell carries the Monday tint ${hexToArgb(blendOnWhite('#FF8C00', 0.06))} (got ${monBodyFill})`)
  expect(monBodyFill !== gapFill?.fgColor?.argb, `Monday and Thursday cells are DISTINCT tints, not one shared fill`)

  try { fs.unlinkSync(tmpXlsx) } catch { /* best-effort cleanup */ }

  // ── HTML formatter (PDF path renders from this same HTML) ──────────────────

  const html = renderScheduleGridHtml(grid)
  expect(html.includes('<!DOCTYPE html>'), `HTML output is a full document`)
  expect(html.includes('Watermark Country Club'), `HTML contains company name`)
  expect(html.includes('Week of Jun 1–7, 2026'), `HTML contains week-range label`)
  expect(html.includes('UNFILLED — Lifeguard'), `HTML contains gap text 'UNFILLED — Lifeguard'`)
  expect(html.includes('CLOSED — Memorial Day'), `HTML contains closure label 'CLOSED — Memorial Day'`)
  // NAME+ROLE regression guard (PDF/HTML): FULL names (incl. last name) + role
  // must render, matching the on-screen card — the content the download dropped.
  expect(html.includes('Kori Allen') && html.includes('Ally Roberts'), `HTML contains FULL employee names incl. last name`)
  expect(html.includes('Audrey Miller'), `HTML contains full name 'Audrey Miller' (last name restored)`)
  expect(html.includes('class="cell-role">Lifeguard<'), `HTML renders the assignment role line 'Lifeguard'`)
  expect(html.includes('@media print'), `HTML has print CSS rules`)
  expect(html.includes('size: landscape'), `HTML print CSS is landscape`)

  // ALL-BLUE REGRESSION GUARD (PDF/HTML side): the two day headers must render
  // their OWN template colors inline, not a single shared background.
  expect(html.includes('style="background:#FF8C00"'), `HTML Monday header renders its own orange inline`)
  expect(html.includes('style="background:#00008B"'), `HTML Thursday header renders its own dark-blue inline`)
  expect(
    html.includes(`style="background:${blendOnWhite('#FF8C00', 0.06)}"`),
    `HTML Monday body cells carry the Monday day tint inline (${blendOnWhite('#FF8C00', 0.06)})`,
  )
  expect(
    !html.includes('.cell-filled { background:'),
    `dead per-kind background CSS was removed from the HTML renderer`,
  )
  expect(html.includes('rowspan="5"'), `HTML closure cell uses rowspan=5 (one per shift row)`)
  expect(html.includes('— Aegis'), `HTML footer mentions Aegis attribution`)

  // Cross-formatter parity: the same grid drives both downloads, so the gap and
  // closure text that appears in the Excel cells must also appear in the PDF/HTML.
  expect(
    String(wsCell('E4') ?? '').includes('Lifeguard') && html.includes('UNFILLED — Lifeguard'),
    `Excel + PDF/HTML agree on the Thursday Lifeguard gap`,
  )
  expect(
    String(wsCell('H4') ?? '').includes('Memorial Day') && html.includes('CLOSED — Memorial Day'),
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
    approved_at: null, distributed_at: null, deleted_at: null,
    published_at: null, archived_at: null, superseded_by: null, data, staffing_report: null,
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

  // (5) DOWNLOAD-500 (this fix): shift_types.days_active is number[] in the DB
  //     (day indices 0–6), NOT the string[] this smoke's fixture used. The
  //     download routes fetch days_active and pass it straight into
  //     buildScheduleGrid → compactDaysLabel, which called d.toLowerCase() and
  //     threw "d.toLowerCase is not a function" on a number — 500-ing BOTH the
  //     Excel and PDF downloads. Exercise the real number[] shape here.
  try {
    const numberShifts = [
      { name: 'AM Weekday', start_time: '11:30', end_time: '15:30', days_active: [1, 2, 3, 4, 5] },      // Mon–Fri
      { name: 'AM Weekend', start_time: '09:30', end_time: '15:30', days_active: [0, 6] },                // Sun + Sat
    ] satisfies ShiftMeta[]
    const sched = mkSchedule({
      assignments: [
        { date: '2026-06-01', employee_id: 'e1', employee_name: 'Audrey Miller', shift_name: 'AM Weekday', role: 'Lifeguard', start_time: '11:30', end_time: '15:30', hours: 4 },
      ],
      gaps: [], summary: '', closed_dates: [],
    })
    const g = buildScheduleGrid({ schedule: sched, template: TEMPLATE, companyName: COMPANY_NAME, shifts: numberShifts, events: [] })
    const xlsxBuf3 = await renderScheduleGridXlsx(g)
    const html3 = renderScheduleGridHtml(g)
    expect(xlsxBuf3.byteLength > 0 && html3.length > 0, `number[] days_active (real DB shape) → Excel + PDF both render (no throw)`)
    // The Mon–Fri shift's meta label must compact correctly from numeric indices.
    expect(g.rows[0].meta?.includes('Mon–Fri') ?? false, `number[] days_active compacts to 'Mon–Fri' (got '${g.rows[0].meta}')`)
  } catch (e) {
    console.error(`✗ number[] days_active THREW → ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  }

  // ── CONTRACT CASE: a per-shift template color overrides the plain day color ──
  //
  // Exercises the resolver directly (no saveTemplate dependency — that path is a
  // known-broken Piece 2 item). Documents the contract Pieces 2/3 inherit: when
  // the template specifies a color for this position (here via color_config
  // by:'shift' → map[rowId]), that template color WINS over the column's day
  // color; with by:'day' it falls back to the column color.
  const shiftOverride = resolveCellAppearance({
    colorConfig: { by: 'shift', map: { 'AM Weekday': '#123456' } },
    columnColor: '#FF8C00',
    rowId: 'AM Weekday',
    kind: 'filled',
  })
  expect(shiftOverride.color === '#123456', `template (per-shift) color wins over day color (got ${shiftOverride.color})`)
  expect(shiftOverride.fill === blendOnWhite('#123456', 0.06), `override flows through to the export fill`)

  const dayFallback = resolveCellAppearance({
    colorConfig: { by: 'shift', map: {} }, // no entry for this row → fall back
    columnColor: '#FF8C00',
    rowId: 'AM Weekday',
    kind: 'filled',
  })
  expect(dayFallback.color === '#FF8C00', `with no template entry, resolver falls back to the day color (got ${dayFallback.color})`)

  // ── NAME + ROLE REGRESSION CASE (the bug this fix targets) ──────────────────
  //
  // A single filled assignment with a known first name, LAST name, and role.
  // Both download renderers must emit the LAST name AND the ROLE — the content
  // the download was dropping (it showed first-name-only, no role). Then with
  // show_role=false the role must NOT appear on either renderer (true parity
  // with the on-screen show_role gate) while the full name still does.
  const nameRoleSched = mkSchedule({
    assignments: [
      { date: '2026-06-01', employee_id: 'e-jv', employee_name: 'Jordan Vasquez', shift_name: 'AM Weekday', role: 'Bartender', start_time: '11:30', end_time: '15:30', hours: 4 },
    ],
    gaps: [], summary: '', closed_dates: [],
  })

  // show_role = true (default TEMPLATE). B4 = Monday AM Weekday cell.
  const gShow = buildScheduleGrid({ schedule: nameRoleSched, template: TEMPLATE, companyName: COMPANY_NAME, shifts: SHIFTS, events: [] })
  const b4Show = String((await cellValue(await renderScheduleGridXlsx(gShow), 'Schedule', 'B4')) ?? '')
  const htmlShow = renderScheduleGridHtml(gShow)
  expect(b4Show.includes('Vasquez'), `Excel filled cell emits the LAST name 'Vasquez' (got "${b4Show.replace(/\n/g, '⏎')}")`)
  expect(b4Show.includes('Bartender'), `Excel filled cell emits the ROLE 'Bartender' (got "${b4Show.replace(/\n/g, '⏎')}")`)
  expect(htmlShow.includes('Jordan Vasquez'), `HTML filled cell emits the full name incl. last name 'Vasquez'`)
  expect(htmlShow.includes('class="cell-role">Bartender<'), `HTML filled cell emits the role line 'Bartender'`)

  // show_role = false → role gated off on BOTH renderers; full name still present.
  const tmplNoRole: ScheduleTemplate = { ...TEMPLATE, display_options: { ...TEMPLATE.display_options, show_role: false } }
  const gHide = buildScheduleGrid({ schedule: nameRoleSched, template: tmplNoRole, companyName: COMPANY_NAME, shifts: SHIFTS, events: [] })
  const b4Hide = String((await cellValue(await renderScheduleGridXlsx(gHide), 'Schedule', 'B4')) ?? '')
  const htmlHide = renderScheduleGridHtml(gHide)
  expect(gHide.rows[0].cells[0].employees[0].role === '', `show_role=false: grid gates the role to '' at the source`)
  expect(b4Hide.includes('Vasquez'), `show_role=false: Excel still shows the name (got "${b4Hide.replace(/\n/g, '⏎')}")`)
  expect(!b4Hide.includes('Bartender'), `show_role=false: Excel hides the role — parity with on-screen (got "${b4Hide.replace(/\n/g, '⏎')}")`)
  expect(htmlHide.includes('Jordan Vasquez') && !htmlHide.includes('Bartender'), `show_role=false: HTML shows the name, hides the role`)

  console.log('\n✓ All smoke-schedule-grid-download assertions passed')
}

main().catch(err => { console.error(err); process.exit(1) })
