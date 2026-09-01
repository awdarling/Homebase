import ExcelJS from 'exceljs'

// Why exceljs and not the SheetJS community build (`xlsx`) here too:
// `xlsx` on npm has two open HIGH-severity advisories (prototype pollution,
// ReDoS) with no fixed version published to the npm registry — SheetJS only
// ships patched builds through their own CDN, which is a worse supply-chain
// trade than reusing a dependency we already vet and run in production.
// exceljs is already Homebase's writer for the schedule-grid .xlsx download
// (see src/lib/schedule/renderScheduleGridXlsx.ts) and carries no advisory
// of its own — its one audit flag is a moderate, non-exploitable-here
// insecure-randomness note on its `uuid` dependency, not a parsing bug.
//
// This function replaces `XLSX.read(buf).SheetNames[0]` + `sheet_to_csv` for
// the one call site that reads an uploaded spreadsheet in the Soteria chat
// (src/app/api/soteria/route.ts): first worksheet, cell text, CSV-escaped.

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Reads the first worksheet of an .xlsx file and renders it as CSV text,
 * the same shape `XLSX.utils.sheet_to_csv` produced. Trailing fully-empty
 * rows are dropped; cell text (not raw value) is used so dates/formulas
 * render the way a person looking at the sheet would read them.
 */
export async function spreadsheetToCsv(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  // exceljs's own @types/node (bundled with its published types) resolves to a
  // structurally different `Buffer` than this project's — same nominal clash
  // renderScheduleGridXlsx.ts casts around on the write side. `as any` here is
  // a type-only bypass; at runtime this is a real, ordinary Node Buffer.
  await workbook.xlsx.load(buffer as any)

  const worksheet = workbook.worksheets[0]
  if (!worksheet) return ''

  const lines: string[] = []
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = []
    const cellCount = row.actualCellCount > 0 ? row.cellCount : 0
    for (let col = 1; col <= cellCount; col++) {
      cells.push(csvEscape(row.getCell(col).text ?? ''))
    }
    lines.push(cells.join(','))
  })

  return lines.join('\n')
}
