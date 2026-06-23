// TEMPLATE-EDIT-2 slice 3: row models for the alternate schedule layouts.
//
// The default layout puts SHIFTS on the rows and days on the columns. The two
// alternate layouts re-pivot the same assignments:
//   - employee-rows-day-columns: one row per person, each cell = the shift(s)
//     they work that day.
//   - role-rows-day-columns: one row per role, each cell = everyone working
//     that role that day.
// This module is the pure, deterministic re-pivot (no React, no DB) so it can
// be unit-tested; the renderer just maps the returned rows onto the grid.

import type { ScheduleAssignment } from '@/lib/types'

export interface AltGridRow {
  id: string                                   // employee_id, or role name
  label: string                                // display label for the row
  cellsByDate: Record<string, ScheduleAssignment[]>
}

function sortAssignments(list: ScheduleAssignment[]): ScheduleAssignment[] {
  // Stable, readable order within a cell: by start time, then shift, then name.
  return [...list].sort((a, b) =>
    (a.start_time || '').localeCompare(b.start_time || '') ||
    (a.shift_name || '').localeCompare(b.shift_name || '') ||
    (a.employee_name || '').localeCompare(b.employee_name || ''))
}

function finalize(
  rows: Map<string, { label: string; cells: Map<string, ScheduleAssignment[]> }>,
  order: (a: { label: string }, b: { label: string }) => number,
): AltGridRow[] {
  return Array.from(rows.entries())
    .map(([id, r]) => ({ id, label: r.label, cells: r.cells }))
    .sort(order)
    .map(r => {
      const cellsByDate: Record<string, ScheduleAssignment[]> = {}
      for (const [date, list] of Array.from(r.cells.entries())) {
        cellsByDate[date] = sortAssignments(list)
      }
      return { id: r.id, label: r.label, cellsByDate }
    })
}

/** One row per employee (sorted by name); each cell = that person's shifts that day. */
export function buildEmployeeRowModel(assignments: ScheduleAssignment[]): AltGridRow[] {
  const rows = new Map<string, { label: string; cells: Map<string, ScheduleAssignment[]> }>()
  for (const a of assignments ?? []) {
    if (!a?.employee_id) continue
    let row = rows.get(a.employee_id)
    if (!row) { row = { label: a.employee_name || a.employee_id, cells: new Map() }; rows.set(a.employee_id, row) }
    const cell = row.cells.get(a.date) ?? []
    cell.push(a)
    row.cells.set(a.date, cell)
  }
  return finalize(rows, (x, y) => x.label.localeCompare(y.label))
}

/** One row per role; each cell = everyone working that role that day. */
export function buildRoleRowModel(assignments: ScheduleAssignment[], roleOrder?: string[]): AltGridRow[] {
  const rows = new Map<string, { label: string; cells: Map<string, ScheduleAssignment[]> }>()
  for (const a of assignments ?? []) {
    const role = (a?.role || '').trim()
    if (!role) continue
    let row = rows.get(role)
    if (!row) { row = { label: role, cells: new Map() }; rows.set(role, row) }
    const cell = row.cells.get(a.date) ?? []
    cell.push(a)
    row.cells.set(a.date, cell)
  }
  const orderIndex = new Map((roleOrder ?? []).map((r, i) => [r.toLowerCase(), i]))
  return finalize(rows, (x, y) => {
    const ix = orderIndex.has(x.label.toLowerCase()) ? orderIndex.get(x.label.toLowerCase())! : Number.MAX_SAFE_INTEGER
    const iy = orderIndex.has(y.label.toLowerCase()) ? orderIndex.get(y.label.toLowerCase())! : Number.MAX_SAFE_INTEGER
    return ix - iy || x.label.localeCompare(y.label)
  })
}
