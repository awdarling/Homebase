import ExcelJS from 'exceljs'
import type { ScheduleGrid, GridCell, GridColumn } from './buildScheduleGrid'

// Why exceljs and not the SheetJS community build:
// the community `xlsx` build silently drops cell styles (fills/fonts) when it
// writes the .xlsx — so the gap-red / closed-grey / dark headers we attach
// never reached the file, and the only visual signal was the cell TEXT. exceljs
// writes real fills, fonts, borders, merges, frozen panes, column widths, and
// row heights, so the downloaded sheet now looks like the in-app grid. The cell
// TEXT still carries the meaning ("UNFILLED — Lifeguard", "CLOSED — …") so the
// sheet is legible even in monochrome.
//
// This renderer walks the SAME `ScheduleGrid` that the print/PDF HTML renderer
// walks (see buildScheduleGrid.ts), so the two downloads stay in lockstep on
// shifts, roles, employee names, gaps and closures.

// ── Palette (ARGB; the leading FF is the alpha/opacity byte exceljs expects) ──
const C = {
  headerDark: 'FF1A1A2E',
  headerDay: 'FF2A2A4E',
  shiftLabel: 'FFF0F0F4',
  filled: 'FFF4F4F8',
  empty: 'FFFFFFFF',
  gapFill: 'FFFDECEC',
  gapText: 'FFB91C1C',
  closedFill: 'FFEEEEEE',
  closedText: 'FF666666',
  white: 'FFFFFFFF',
  ink: 'FF1A1A2E',
  muted: 'FF666666',
  gridline: 'FFDDDDDD',
} as const

interface CellStyle {
  fill?: string
  fontColor?: string
  bold?: boolean
  italic?: boolean
  size?: number
  hAlign?: 'left' | 'center' | 'right'
  vAlign?: 'top' | 'middle' | 'bottom'
  border?: boolean
}

function thin(): Partial<ExcelJS.Border> {
  return { style: 'thin', color: { argb: C.gridline } }
}

function applyStyle(cell: ExcelJS.Cell, s: CellStyle): void {
  if (s.fill) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: s.fill } }
  }
  cell.font = {
    color: { argb: s.fontColor ?? C.ink },
    bold: s.bold ?? false,
    italic: s.italic ?? false,
    size: s.size ?? 10,
  }
  cell.alignment = {
    vertical: s.vAlign ?? 'top',
    horizontal: s.hAlign ?? 'left',
    wrapText: true,
  }
  if (s.border) {
    cell.border = { top: thin(), left: thin(), bottom: thin(), right: thin() }
  }
}

const STYLE = {
  title: { fill: C.headerDark, fontColor: C.white, bold: true, size: 12, hAlign: 'center', vAlign: 'middle' } as CellStyle,
  dayHeader: { fill: C.headerDay, fontColor: C.white, bold: true, size: 11, hAlign: 'center', vAlign: 'middle', border: true } as CellStyle,
  cornerHeader: { fill: C.headerDark, fontColor: C.white, bold: true, size: 11, hAlign: 'center', vAlign: 'middle', border: true } as CellStyle,
  shiftLabel: { fill: C.shiftLabel, fontColor: C.ink, bold: true, size: 10, hAlign: 'left', vAlign: 'middle', border: true } as CellStyle,
  filled: { fill: C.filled, fontColor: C.ink, size: 10, hAlign: 'left', vAlign: 'top', border: true } as CellStyle,
  empty: { fill: C.empty, hAlign: 'left', vAlign: 'top', border: true } as CellStyle,
  gap: { fill: C.gapFill, fontColor: C.gapText, bold: true, size: 10, hAlign: 'left', vAlign: 'top', border: true } as CellStyle,
  closed: { fill: C.closedFill, fontColor: C.closedText, italic: true, size: 10, hAlign: 'center', vAlign: 'middle', border: true } as CellStyle,
  footer: { fontColor: C.muted, italic: true, size: 9, hAlign: 'left', vAlign: 'middle' } as CellStyle,
} as const

function cellTextForGrid(cell: GridCell, gapRoleLabel: (role: string) => string): string {
  if (cell.kind === 'closed') return '' // closed cells render via merge; only the top cell shows text
  if (cell.kind === 'empty') return ''
  const lines: string[] = [...(cell.employeeDisplayNames ?? [])]
  if (cell.kind === 'gap' || cell.kind === 'partial') {
    lines.push(gapRoleLabel(cell.gapRole ?? ''))
  }
  return lines.join('\n')
}

// Layout (1-indexed sheet rows):
//   Row 1: company name + week range (merged across all columns)
//   Row 2: empty spacer
//   Row 3: corner "Shift" cell + day-of-week headers (with date subscript)
//   Row 4..: one row per visible shift; col A is the shift label
//   Final row: generated-at timestamp + "Aegis" footer (merged)
export async function renderScheduleGridXlsx(grid: ScheduleGrid): Promise<Buffer> {
  const totalCols = 1 + grid.columns.length

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Aegis'
  // Guard the workbook timestamp: exceljs serializes wb.created via
  // .toISOString(), which throws "Invalid time value" on an Invalid Date.
  // Fall back to now if generatedAt is missing/malformed.
  const created = new Date(grid.generatedAt)
  wb.created = isNaN(created.getTime()) ? new Date() : created
  const ws = wb.addWorksheet('Schedule', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }],
  })

  // Column widths: shift label wider, day columns ~100px.
  ws.getColumn(1).width = 18
  for (let c = 2; c <= totalCols; c++) ws.getColumn(c).width = 16

  // ── Row 1: title ──
  const titleRow = ws.addRow([`${grid.companyName} — Week of ${grid.weekRangeLabel}`, ...Array(totalCols - 1).fill('')])
  titleRow.height = 28
  applyStyle(titleRow.getCell(1), STYLE.title)
  ws.mergeCells(1, 1, 1, totalCols)

  // ── Row 2: spacer ──
  const spacer = ws.addRow(Array(totalCols).fill(''))
  spacer.height = 8

  // ── Row 3: day headers ──
  const headerVals = ['Shift', ...grid.columns.map(col => `${col.dayLabel}\n${col.shortDate}`)]
  const headerRow = ws.addRow(headerVals)
  headerRow.height = 32
  applyStyle(headerRow.getCell(1), STYLE.cornerHeader)
  grid.columns.forEach((_, i) => applyStyle(headerRow.getCell(i + 2), STYLE.dayHeader))

  // ── Shift rows ──
  const SHIFT_FIRST_SHEET_ROW = 4 // 1-indexed row of the first shift row
  grid.rows.forEach((row, rIdx) => {
    const labelText = row.meta ? `${row.label}\n${row.meta}` : row.label
    const values: string[] = [labelText]
    for (let cIdx = 0; cIdx < row.cells.length; cIdx++) {
      const cell = row.cells[cIdx]
      switch (cell.kind) {
        case 'closed':
          // Only the first (top) shift row shows the closure label; lower rows
          // are blank and hidden under the vertical merge.
          values.push(rIdx === 0 ? closureCellLabel(grid.columns[cIdx]) : '')
          break
        case 'gap':
        case 'partial':
          values.push(cellTextForGrid(cell, role => `UNFILLED — ${role}`.trim()))
          break
        case 'filled':
          values.push(cellTextForGrid(cell, () => ''))
          break
        case 'empty':
        default:
          values.push('')
          break
      }
    }
    const xlsxRow = ws.addRow(values)
    xlsxRow.height = 60
    applyStyle(xlsxRow.getCell(1), STYLE.shiftLabel)
    row.cells.forEach((cell, cIdx) => {
      const target = xlsxRow.getCell(cIdx + 2)
      switch (cell.kind) {
        case 'closed': applyStyle(target, STYLE.closed); break
        case 'gap':
        case 'partial': applyStyle(target, STYLE.gap); break
        case 'filled': applyStyle(target, STYLE.filled); break
        default: applyStyle(target, STYLE.empty); break
      }
    })
  })

  // Vertical merge for each fully-closed column (so the closure label spans the
  // whole column, matching the in-app render).
  grid.columns.forEach((col, cIdx) => {
    if (!col.isClosed) return
    const sheetCol = cIdx + 2 // col A is the shift label
    ws.mergeCells(
      SHIFT_FIRST_SHEET_ROW,
      sheetCol,
      SHIFT_FIRST_SHEET_ROW + grid.rows.length - 1,
      sheetCol,
    )
  })

  // ── Footer ──
  const footerLabel = `Generated ${formatGeneratedAt(grid.generatedAt)} — Aegis`
  const footerRow = ws.addRow([footerLabel, ...Array(totalCols - 1).fill('')])
  footerRow.height = 18
  applyStyle(footerRow.getCell(1), STYLE.footer)
  ws.mergeCells(footerRow.number, 1, footerRow.number, totalCols)

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}

function closureCellLabel(col: GridColumn): string {
  if (!col.isClosed) return ''
  return col.closureTitle ? `CLOSED — ${col.closureTitle}` : 'CLOSED'
}

function formatGeneratedAt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export { closureCellLabel }
