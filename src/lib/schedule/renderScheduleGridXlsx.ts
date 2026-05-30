import * as XLSX from 'xlsx'
import type { ScheduleGrid } from './buildScheduleGrid'

// Note on styling: the SheetJS community build does not write cell styles
// (fills/fonts) into the produced .xlsx. We still attach `s` style hints —
// any reader that does honor them (the paid xlsx-style fork, Excel-side
// conditional formatting workflows) will pick them up — but the visual
// distinction we rely on for unfilled / closed cells is the CELL TEXT
// itself (e.g. "UNFILLED — Lifeguard", "CLOSED — Memorial Day"), not the
// fill colour. Borders and merges DO render in the community build.

const HDR_CORNER_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: '1A1A2E' } },
  font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 12 },
  alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
}

const HDR_DAY_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: '2A2A4E' } },
  font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 11 },
  alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
}

const SHIFT_LABEL_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: 'F0F0F4' } },
  font: { color: { rgb: '1A1A2E' }, bold: true, sz: 10 },
  alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
}

const FILLED_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: 'F4F4F8' } },
  font: { color: { rgb: '1A1A2E' }, sz: 10 },
  alignment: { vertical: 'top', horizontal: 'left', wrapText: true },
}

const EMPTY_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
  alignment: { vertical: 'top', horizontal: 'left', wrapText: true },
}

const GAP_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: 'FDECEC' } },
  font: { color: { rgb: 'B91C1C' }, bold: true, sz: 10 },
  alignment: { vertical: 'top', horizontal: 'left', wrapText: true },
}

const CLOSED_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: 'EEEEEE' } },
  font: { color: { rgb: '666666' }, italic: true, sz: 10 },
  alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
}

const FOOTER_STYLE = {
  font: { color: { rgb: '666666' }, sz: 9, italic: true },
  alignment: { vertical: 'center', horizontal: 'left' },
}

function cellTextForGrid(cell: import('./buildScheduleGrid').GridCell, gapRoleLabel: (role: string) => string): string {
  if (cell.kind === 'closed') return ''  // closed cells render via merge; only the top cell shows text
  if (cell.kind === 'empty') return ''
  const lines: string[] = [...cell.employeeDisplayNames]
  if (cell.kind === 'gap' || cell.kind === 'partial') {
    lines.push(gapRoleLabel(cell.gapRole ?? ''))
  }
  return lines.join('\n')
}

// Layout:
//   Row 1: company name + week range (merged across all columns)
//   Row 2: empty spacer
//   Row 3: corner cell + day-of-week headers (with date subscript)
//   Row 4..: one row per visible shift; col 0 is the shift label
//   Final row: generated-at timestamp + "Aegis" footer
export function renderScheduleGridXlsx(grid: ScheduleGrid): Buffer {
  const totalCols = 1 + grid.columns.length

  type Cell = { v: string; s?: Record<string, unknown> }
  const rows: Cell[][] = []

  // Title row
  const titleRow: Cell[] = Array.from({ length: totalCols }, () => ({ v: '', s: HDR_CORNER_STYLE }))
  titleRow[0] = { v: `${grid.companyName} — Week of ${grid.weekRangeLabel}`, s: HDR_CORNER_STYLE }
  rows.push(titleRow)

  // Spacer
  rows.push(Array.from({ length: totalCols }, () => ({ v: '' })))

  // Day headers
  const headerRow: Cell[] = [{ v: 'Shift', s: HDR_CORNER_STYLE }]
  for (const col of grid.columns) {
    headerRow.push({ v: `${col.dayLabel}\n${col.shortDate}`, s: HDR_DAY_STYLE })
  }
  rows.push(headerRow)

  // Shift rows
  const merges: XLSX.Range[] = []
  // Title merge spans the whole title row.
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } })

  const SHIFT_ROW_OFFSET = 3  // 0-indexed row where shift data starts

  // We need to detect contiguous closed cells per column so we can vertically
  // merge them. The simplest case: a whole column is closed (every cell in
  // the column has kind === 'closed'). For now we handle that case — partial
  // closures aren't a real-world scenario yet.
  for (let rIdx = 0; rIdx < grid.rows.length; rIdx++) {
    const row = grid.rows[rIdx]
    const sheetRowIdx = SHIFT_ROW_OFFSET + rIdx
    const shiftLabelText = row.meta ? `${row.label}\n${row.meta}` : row.label
    const xlsxRow: Cell[] = [{ v: shiftLabelText, s: SHIFT_LABEL_STYLE }]
    for (const cell of row.cells) {
      let style: Record<string, unknown>
      let text: string
      switch (cell.kind) {
        case 'closed':
          style = CLOSED_STYLE
          // Top row gets the label; subsequent rows are blanked and will be
          // hidden under the vertical merge.
          text = rIdx === 0 ? closureCellLabel(grid.columns[xlsxRow.length - 1]) : ''
          break
        case 'gap':
          style = GAP_STYLE
          text = cellTextForGrid(cell, role => `UNFILLED — ${role}`.trim())
          break
        case 'partial':
          style = GAP_STYLE
          text = cellTextForGrid(cell, role => `UNFILLED — ${role}`.trim())
          break
        case 'filled':
          style = FILLED_STYLE
          text = cellTextForGrid(cell, () => '')
          break
        case 'empty':
        default:
          style = EMPTY_STYLE
          text = ''
          break
      }
      xlsxRow.push({ v: text, s: style })
    }
    rows.push(xlsxRow)
  }

  // Vertical merge for each fully-closed column.
  grid.columns.forEach((col, cIdx) => {
    if (!col.isClosed) return
    const sheetCol = cIdx + 1  // shift-label column is col 0
    merges.push({
      s: { r: SHIFT_ROW_OFFSET, c: sheetCol },
      e: { r: SHIFT_ROW_OFFSET + grid.rows.length - 1, c: sheetCol },
    })
  })

  // Footer
  const footerRow: Cell[] = Array.from({ length: totalCols }, () => ({ v: '' }))
  const footerLabel = `Generated ${formatGeneratedAt(grid.generatedAt)} — Aegis`
  footerRow[0] = { v: footerLabel, s: FOOTER_STYLE }
  rows.push(footerRow)
  // Merge footer across all columns.
  merges.push({
    s: { r: rows.length - 1, c: 0 },
    e: { r: rows.length - 1, c: totalCols - 1 },
  })

  // Build sheet.
  const aoa = rows.map(r => r.map(c => c.v))
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // Re-attach style hints.
  rows.forEach((row, rIdx) => {
    row.forEach((cell, cIdx) => {
      if (!cell.s) return
      const addr = XLSX.utils.encode_cell({ r: rIdx, c: cIdx })
      const existing = ws[addr] ?? { t: 's', v: cell.v }
      ws[addr] = { ...existing, t: 's', v: cell.v, s: cell.s }
    })
  })

  ws['!cols'] = [
    { wch: 18 },  // shift label
    ...grid.columns.map(() => ({ wch: 16 })),  // ~100px per day column
  ]

  // Row heights: title, spacer, header, shift rows (taller for stacked names), footer.
  ws['!rows'] = [
    { hpt: 28 },
    { hpt: 8 },
    { hpt: 32 },
    ...grid.rows.map(() => ({ hpt: 60 })),
    { hpt: 18 },
  ]

  ws['!merges'] = merges

  // Freeze row 1 (day headers) and column A (shift names). SheetJS doesn't
  // expose typed freeze panes in this community build, so we set the
  // properties as untyped fields on the sheet — Excel honours them on open.

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Schedule')

  // Persist a freeze hint via the sheet's pane definitions. The community
  // build will keep it in the workbook XML; Excel honours it on open.
  // Freeze at the header row (row 4 = SHIFT_ROW_OFFSET + 1, 1-indexed) and
  // at column B (after the shift-label column).
  ;(ws as Record<string, unknown>)['!freeze'] = { xSplit: 1, ySplit: SHIFT_ROW_OFFSET + 1 }

  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return out
}

function closureCellLabel(col: import('./buildScheduleGrid').GridColumn): string {
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
