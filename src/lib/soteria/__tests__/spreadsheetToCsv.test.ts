// Runtime test harness for spreadsheetToCsv — the S-6 replacement for the
// `xlsx` (SheetJS) reader that used to parse a manager's uploaded spreadsheet
// in the Soteria chat (src/app/api/soteria/route.ts). No prior test covered
// that parsing path at all; this is new coverage, not a port of an old one.
//
// Run:  npx tsx src/lib/soteria/__tests__/spreadsheetToCsv.test.ts

import ExcelJS from 'exceljs'
import { spreadsheetToCsv } from '../spreadsheetToCsv'

let failures = 0
function expect(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures++
  }
}

async function buildXlsx(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  rows.forEach(r => ws.addRow(r))
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}

async function main() {
  // ── basic round trip ──────────────────────────────────────────────────────
  {
    const buf = await buildXlsx([
      ['Name', 'Role', 'Hours'],
      ['Audrey Miller', 'Lifeguard', 20],
      ['Jay Park', 'Manager', 40],
    ])
    const csv = await spreadsheetToCsv(buf)
    const lines = csv.split('\n')
    expect(lines.length === 3, `three rows produce three CSV lines (got ${lines.length})`)
    expect(lines[0] === 'Name,Role,Hours', `header row renders plain (got "${lines[0]}")`)
    expect(lines[1] === 'Audrey Miller,Lifeguard,20', `data row renders plain, numbers as text (got "${lines[1]}")`)
    expect(lines[2] === 'Jay Park,Manager,40', `second data row renders plain (got "${lines[2]}")`)
  }

  // ── CSV escaping: commas, quotes, newlines ────────────────────────────────
  {
    const buf = await buildXlsx([
      ['Note'],
      ['Smith, John'],
      ['She said "hi"'],
      ['Line one\nLine two'],
    ])
    const csv = await spreadsheetToCsv(buf)
    const lines = csv.split('\n')
    // The embedded-newline row itself spans two CSV lines once quoted, so index
    // by content rather than position.
    expect(lines.some(l => l === '"Smith, John"'), `a value containing a comma is quoted (got ${JSON.stringify(lines)})`)
    expect(lines.some(l => l === '"She said ""hi"""'), `embedded quotes are doubled per CSV convention (got ${JSON.stringify(lines)})`)
    expect(csv.includes('"Line one\nLine two"'), `an embedded newline is preserved inside a quoted field`)
  }

  // ── only the first worksheet is read ──────────────────────────────────────
  {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('First').addRow(['a', 'b'])
    wb.addWorksheet('Second').addRow(['x', 'y'])
    const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer)
    const csv = await spreadsheetToCsv(buf)
    expect(csv === 'a,b', `only the first worksheet is read, later sheets ignored (got "${csv}")`)
  }

  // ── empty workbook / empty sheet ──────────────────────────────────────────
  {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Empty')
    const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer)
    const csv = await spreadsheetToCsv(buf)
    expect(csv === '', `a worksheet with no rows produces empty CSV text (got "${JSON.stringify(csv)}")`)
  }

  // ── not a valid .xlsx file — caller's try/catch is the real guard, but the
  //    function itself must throw rather than silently return garbage ───────
  {
    let threw = false
    try {
      await spreadsheetToCsv(Buffer.from('not an xlsx file'))
    } catch {
      threw = true
    }
    expect(threw, `an invalid buffer throws (the route's own try/catch is what turns this into the friendly "could not parse" message)`)
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`)
    process.exit(1)
  } else {
    console.log('\nAll spreadsheetToCsv checks passed.')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
