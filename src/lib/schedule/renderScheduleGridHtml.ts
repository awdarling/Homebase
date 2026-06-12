import type { ScheduleGrid, GridColumn } from './buildScheduleGrid'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function closureLabel(col: GridColumn): string {
  return col.closureTitle ? `CLOSED — ${col.closureTitle}` : 'CLOSED'
}

function formatGeneratedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Renders a print-optimized HTML page containing the canonical week grid.
// The manager opens it in a new tab and uses Cmd+P → Save as PDF.
// Designed to fit on a single landscape Letter page.
export function renderScheduleGridHtml(grid: ScheduleGrid): string {
  const totalColumns = grid.columns.length

  // Each day header takes its own template color (closed → grey), matching the
  // on-screen DayHeader instead of a single shared navy. Half the all-blue fix.
  const headerCells = grid.columns.map(col => {
    const bg = col.isClosed ? '#4b5563' : col.color
    return `
    <th class="day-col" style="background:${bg}">
      <div class="day-label">${escapeHtml(col.dayLabel)}</div>
      <div class="day-date">${escapeHtml(col.shortDate)}</div>
    </th>
  `
  }).join('')

  const bodyRows = grid.rows.map((row, rIdx) => {
    const labelCell = `
      <th class="shift-label">
        <div class="shift-label-name">${escapeHtml(row.label)}</div>
        ${row.meta ? `<div class="shift-label-meta">${escapeHtml(row.meta)}</div>` : ''}
      </th>
    `
    const dataCells = row.cells.map((cell, cIdx) => {
      const col = grid.columns[cIdx]
      // Cell fill now comes from the shared resolver's per-day template color
      // (cell.appearance.fill), set inline — replacing the fixed per-kind
      // background classes that ignored template color ("all-blue" bug). Text
      // styling (gap red, closed grey-italic) stays in the classes.
      const fill = cell.appearance.fill
      if (cell.kind === 'closed') {
        // Only the first shift row owns the merged closure cell; later rows
        // skip the column entirely.
        if (rIdx !== 0) return ''
        return `
          <td class="cell cell-closed" rowspan="${grid.rows.length}" style="background:${fill}">
            <div class="closed-text">${escapeHtml(closureLabel(col))}</div>
          </td>
        `
      }
      if (cell.kind === 'empty') {
        return `<td class="cell cell-empty" style="background:${fill}"></td>`
      }
      // Per assignment: full name + its role line (when present) — mirrors the
      // on-screen card. `role` is already show_role-gated in buildScheduleGrid.
      const employeeLines = (cell.employees ?? [])
        .map(e => `<div class="cell-emp"><div class="cell-name">${escapeHtml(e.name)}</div>${e.role ? `<div class="cell-role">${escapeHtml(e.role)}</div>` : ''}</div>`)
        .join('')
      if (cell.kind === 'filled') {
        return `<td class="cell cell-filled" style="background:${fill}">${employeeLines}</td>`
      }
      // gap or partial
      const gapText = cell.gapRole
        ? `UNFILLED — ${escapeHtml(cell.gapRole)}`
        : 'UNFILLED'
      return `
        <td class="cell cell-${cell.kind}" style="background:${fill}">
          ${employeeLines}
          <div class="cell-gap">${gapText}</div>
        </td>
      `
    }).join('')
    return `<tr>${labelCell}${dataCells}</tr>`
  }).join('')

  const title = `${grid.companyName} — Week of ${grid.weekRangeLabel}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #1a1a2e;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    max-width: 1100px;
    margin: 0 auto;
    padding: 24px 20px 60px;
  }
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    margin-bottom: 18px;
    padding: 12px 16px;
    background: #f3f3f7;
    border: 1px solid #d4d4dc;
    border-radius: 8px;
  }
  .toolbar-hint { font-size: 12px; color: #555; }
  .print-btn {
    background: #1a1a2e;
    color: #ffffff;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .doc-header {
    margin-bottom: 14px;
  }
  .doc-company {
    font-size: 20px;
    font-weight: 700;
    color: #1a1a2e;
    margin: 0;
    letter-spacing: -0.01em;
  }
  .doc-range {
    font-size: 13px;
    color: #555;
    margin-top: 2px;
  }
  .grid-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 11px;
  }
  .grid-table th, .grid-table td {
    border: 1px solid #b8b8c8;
    vertical-align: top;
    padding: 6px 8px;
    overflow: hidden;
    /* Body cells + day headers carry inline template colors — force them to
       print rather than letting the browser drop backgrounds. */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .grid-table thead th {
    background: #1a1a2e;
    color: #ffffff;
    font-weight: 600;
    text-align: center;
    padding: 8px 6px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .grid-table thead th.day-col { width: ${Math.max(8, Math.floor(86 / totalColumns))}%; }
  .day-label {
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .day-date {
    font-size: 12px;
    font-weight: 500;
    color: #d4d4e4;
    margin-top: 2px;
  }
  .shift-label {
    width: 14%;
    background: #f0f0f4;
    text-align: left;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .shift-label-name {
    font-weight: 700;
    font-size: 12px;
    color: #1a1a2e;
  }
  .shift-label-meta {
    font-size: 10px;
    color: #666;
    margin-top: 2px;
  }
  .cell {
    min-height: 56px;
    height: 56px;
  }
  /* Cell backgrounds are set inline from the shared resolver (per-day template
     color); the old per-kind background fills lived here and are now removed.
     Only structural / text styling remains. */
  .cell-closed {
    text-align: center;
    vertical-align: middle;
  }
  .closed-text {
    color: #666;
    font-style: italic;
    font-weight: 600;
    font-size: 12px;
    letter-spacing: 0.04em;
  }
  .cell-emp {
    margin-bottom: 3px;
  }
  .cell-name {
    color: #1a1a2e;
    line-height: 1.45;
  }
  .cell-role {
    color: #555;
    font-size: 10px;
    line-height: 1.2;
  }
  .cell-gap, .cell-partial .cell-gap, .cell-gap div.cell-gap {
    /* The .cell-gap text inside partial/gap cells. */
  }
  .cell .cell-gap {
    color: #b91c1c;
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 0.02em;
    margin-top: 3px;
  }
  .doc-footer {
    margin-top: 12px;
    font-size: 10px;
    color: #777;
    font-style: italic;
    text-align: right;
  }

  @media print {
    @page {
      size: landscape;
      margin: 0.5in;
    }
    body, html { background: #ffffff; }
    .toolbar { display: none !important; }
    .page { max-width: 100%; padding: 0; }
    .grid-table { font-size: 10px; }
    .grid-table th, .grid-table td { padding: 4px 6px; }
    .cell { min-height: 48px; height: 48px; }
  }
</style>
</head>
<body>
  <div class="page">
    <div class="toolbar">
      <div class="toolbar-hint">Use Cmd+P (Mac) or Ctrl+P (Windows) to save as PDF.</div>
      <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
    </div>

    <header class="doc-header">
      <h1 class="doc-company">${escapeHtml(grid.companyName)}</h1>
      <div class="doc-range">Week of ${escapeHtml(grid.weekRangeLabel)}</div>
    </header>

    <table class="grid-table">
      <thead>
        <tr>
          <th class="shift-label">Shift</th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    </table>

    <div class="doc-footer">Generated ${escapeHtml(formatGeneratedAt(grid.generatedAt))} — Aegis</div>
  </div>
</body>
</html>`
}
