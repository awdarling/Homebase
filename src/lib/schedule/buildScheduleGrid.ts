import { parseYMD, toYMD } from '@/lib/utils/dates'
import type {
  Schedule,
  ScheduleAssignment,
  ScheduleGap,
  ScheduleTemplate,
} from '@/lib/types'
import { resolveCellAppearance, type CellAppearance } from './resolveCellAppearance'
import { buildEmployeeRowModel, buildRoleRowModel } from './layoutGrids'
import { compareByRoleThenName } from './cellOrder'

// ── Cell + grid shape ────────────────────────────────────────────────────────
//
// The grid is the canonical week layout shared by Excel + print HTML. It
// resolves shifts → rows and dates → columns from the schedule_template, and
// classifies every (shift, date) cell as filled / gap / partial / empty /
// closed. Both formatters walk this same structure so the two outputs stay
// in lockstep.

export type CellKind =
  | 'empty'      // no assignments, no unfilled requirement
  | 'filled'     // one or more assignments, all required slots filled
  | 'partial'    // one or more assignments AND unfilled slots remaining
  | 'gap'        // no assignments, requirement unfilled
  | 'closed'     // entire day is closed (this cell is suppressed; closure renders once per day)

/** One assigned employee in a cell. `role` is '' when the template hides roles
 *  (`display_options.show_role === false`) or the assignment has no role —
 *  mirroring the on-screen card, which shows the full name and (gated) role.
 *
 *  INVARIANT: this grid feeds the downloadable/shareable schedule (xlsx + print
 *  HTML), which can reach employees. It must NEVER carry veteran status or
 *  veteran shift requirements — that is manager-only (shown only in the in-app
 *  ScheduleRenderer + Employees tab). Do not add an is_veteran field, a VET
 *  badge, or any "Veterans only / ≥N" rule tag to this cell or the rows. */
export interface GridCellEmployee {
  name: string                     // full employee_name (first + last), as on-screen
  role: string                     // assignment role, or '' when gated/absent
}

export interface GridCell {
  kind: CellKind
  shiftId: string
  date: string
  employees: GridCellEmployee[]    // full name + (show_role-gated) role, matching the on-screen render
  gapRole: string | null           // when kind === 'gap' or 'partial'
  unfilledCount: number            // 0 unless gap/partial
  appearance: CellAppearance       // shared template-driven color (see resolveCellAppearance)
}

export interface GridColumn {
  date: string                     // YYYY-MM-DD
  dayLabel: string                 // 'Monday', 'Tuesday', ...
  shortDate: string                // 'Jun 2'
  width: number                    // px hint
  isClosed: boolean
  closureTitle: string | null      // null if no event matches; e.g. 'Memorial Day'
  color: string                    // template day color (hex) — drives the day-header fill
}

export interface GridRow {
  shiftId: string
  label: string                    // 'AM Weekday'
  meta: string | null              // 'Mon–Fri • 11:30–3:30' or null
  height: number                   // px hint
  cells: GridCell[]                // one per visible column
}

export interface ScheduleGrid {
  companyName: string
  weekStart: string
  weekEnd: string
  weekRangeLabel: string           // 'Jun 2–8, 2026'
  generatedAt: string              // ISO timestamp
  columns: GridColumn[]
  rows: GridRow[]
}

// ── Inputs the builder needs from the caller ─────────────────────────────────

export interface ShiftMeta {
  name: string
  start_time: string | null
  end_time: string | null
  // shift_types.days_active is a number[] of day indices (0=Sun … 6=Sat) — see
  // src/lib/types.ts. Tolerate a legacy string[] form too. Informational only.
  days_active: Array<number | string> | null
}

export interface EventRow {
  date: string
  title: string
}

export interface BuildScheduleGridInput {
  schedule: Schedule
  template: ScheduleTemplate
  companyName: string
  shifts: ShiftMeta[]              // for the days-active hint label
  events: EventRow[]               // events whose date falls inside this week
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function eachDate(start: string, end: string): string[] {
  const out: string[] = []
  const cur = parseYMD(start)
  const stop = parseYMD(end)
  while (cur <= stop) {
    out.push(toYMD(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function shortDate(d: string): string {
  return parseYMD(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function dayName(d: string): string {
  return parseYMD(d).toLocaleDateString('en-US', { weekday: 'long' })
}

function weekRangeLabel(start: string, end: string): string {
  const s = parseYMD(start)
  const e = parseYMD(end)
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
  const startFmt = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const endFmt = sameMonth
    ? e.toLocaleDateString('en-US', { day: 'numeric' })
    : e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${startFmt}–${endFmt}, ${e.getFullYear()}`
}

// "Mon–Fri • 11:30–3:30"-style hint under each shift label. Returns null if
// nothing useful to show.
function buildShiftMetaLabel(shift: ShiftMeta | undefined): string | null {
  if (!shift) return null
  const parts: string[] = []
  if (shift.days_active && shift.days_active.length > 0 && shift.days_active.length < 7) {
    parts.push(compactDaysLabel(shift.days_active))
  }
  if (shift.start_time && shift.end_time) {
    parts.push(`${shift.start_time}–${shift.end_time}`)
  }
  return parts.length > 0 ? parts.join(' • ') : null
}

const DAY_ABBREV = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
}

function compactDaysLabel(days: Array<number | string>): string {
  // days_active comes from the DB as number[] (day indices 0–6). Use the number
  // directly; only fall back to the name lookup for a legacy string entry. This
  // is the DOWNLOAD-500 root cause: calling .toLowerCase() on a number threw
  // "d.toLowerCase is not a function" and broke both Excel and PDF downloads.
  const indices = days
    .map(d => (typeof d === 'number' ? d : DAY_INDEX[String(d).toLowerCase()]))
    .filter((i): i is number => typeof i === 'number' && i >= 0 && i <= 6)
    .sort((a, b) => a - b)
  if (indices.length === 0) return ''
  // Detect contiguous Mon–Fri or Sat–Sun ranges.
  const isContiguous = indices.every((n, i) => i === 0 || n === indices[i - 1] + 1)
  if (isContiguous && indices.length >= 2) {
    return `${DAY_ABBREV[indices[0]]}–${DAY_ABBREV[indices[indices.length - 1]]}`
  }
  return indices.map(i => DAY_ABBREV[i]).join(', ')
}

// ── Builder ──────────────────────────────────────────────────────────────────

export function buildScheduleGrid(input: BuildScheduleGridInput): ScheduleGrid {
  const { schedule, template, companyName, shifts, events } = input

  const assignments: ScheduleAssignment[] = schedule.data?.assignments ?? []
  const gaps: ScheduleGap[] = schedule.data?.gaps ?? []
  const closedDates = new Set(schedule.data?.closed_dates ?? [])

  // Closure title lookup. If multiple events share a date, join with " • ".
  const eventTitlesByDate = new Map<string, string[]>()
  for (const e of events) {
    if (!eventTitlesByDate.has(e.date)) eventTitlesByDate.set(e.date, [])
    eventTitlesByDate.get(e.date)!.push(e.title)
  }

  const weekDates = eachDate(schedule.week_start, schedule.week_end)

  // Build columns in template.column_config order.
  const visibleCols = [...template.column_config]
    .filter(c => c.visible)
    .sort((a, b) => a.order - b.order)

  const columns: GridColumn[] = visibleCols
    .map(col => {
      const date = weekDates.find(d => parseYMD(d).getDay() === col.day)
      if (!date) return null
      const closureTitleParts = eventTitlesByDate.get(date) ?? []
      return {
        date,
        dayLabel: col.label || dayName(date),
        shortDate: shortDate(date),
        width: col.width ?? 100,
        isClosed: closedDates.has(date),
        closureTitle: closureTitleParts.length > 0 ? closureTitleParts.join(' • ') : null,
        color: col.color,
      } as GridColumn
    })
    .filter((c): c is GridColumn => c !== null)

  const visibleRows = [...template.row_config]
    .filter(r => r.visible)
    .sort((a, b) => a.order - b.order)

  const shiftByName = new Map(shifts.map(s => [s.name, s]))

  // Indexes for fast cell lookup.
  const asgByKey = new Map<string, ScheduleAssignment[]>()  // shiftId||date
  for (const a of assignments) {
    const key = `${a.shift_name}||${a.date}`
    if (!asgByKey.has(key)) asgByKey.set(key, [])
    asgByKey.get(key)!.push(a)
  }

  const gapByKey = new Map<string, ScheduleGap>()
  for (const g of gaps) {
    if (g.required_count <= g.filled_count) continue
    gapByKey.set(`${g.shift_name}||${g.date}`, g)
  }

  // Role visibility mirrors the on-screen render, which gates the role line on
  // display_options.show_role. A tenant with show_role=false gets no roles in
  // the download either (true parity).
  const showRole = template.display_options.show_role

  // ── Alternate layouts (employees×days / roles×days) ────────────────────────
  // Re-pivot the SAME assignments via the shared pure model so the download
  // matches the on-screen view for the manager's chosen layout. Day columns,
  // widths, and colors still come from the template. The no-veteran download
  // invariant (see GridCellEmployee) holds: cells carry only name + gated role,
  // never veteran status. Editing stays in the shift-rows grid; this is display.
  if (
    template.layout_type === 'employee-rows-day-columns' ||
    template.layout_type === 'role-rows-day-columns'
  ) {
    const isEmployee = template.layout_type === 'employee-rows-day-columns'
    const model = isEmployee ? buildEmployeeRowModel(assignments) : buildRoleRowModel(assignments)
    const ALT_ROW_HEIGHT = 56

    const altRows: GridRow[] = model.map(row => {
      const cells: GridCell[] = columns.map(col => {
        const baseClosed = col.isClosed
        const cellAsgs = baseClosed ? [] : (row.cellsByDate[col.date] ?? [])
        const employees: GridCellEmployee[] = cellAsgs.map(a => isEmployee
          // Employee rows: the person IS the row, so each cell names the SHIFT.
          ? { name: a.shift_name ?? '', role: showRole ? (a.role ?? '') : '' }
          // Role rows: the role IS the row, so each cell names the person.
          : { name: a.employee_name ?? '', role: '' })
        const kind: CellKind = baseClosed ? 'closed' : (employees.length > 0 ? 'filled' : 'empty')
        return {
          kind,
          shiftId: row.id,
          date: col.date,
          employees,
          gapRole: null,
          unfilledCount: 0,
          appearance: resolveCellAppearance({
            colorConfig: template.color_config,
            columnColor: col.color,
            rowId: row.id,
            kind,
          }),
        }
      })
      return { shiftId: row.id, label: row.label, meta: null, height: ALT_ROW_HEIGHT, cells }
    })

    return {
      companyName,
      weekStart: schedule.week_start,
      weekEnd: schedule.week_end,
      weekRangeLabel: weekRangeLabel(schedule.week_start, schedule.week_end),
      generatedAt: new Date().toISOString(),
      columns,
      rows: altRows,
    }
  }

  // Cell builder shared by template rows AND special-event rows, keyed by the
  // shift name (= row.id for template rows, = the event shift's name otherwise).
  function buildCells(shiftId: string): GridCell[] {
    return columns.map(col => {
      if (col.isClosed) {
        return {
          kind: 'closed',
          shiftId,
          date: col.date,
          employees: [],
          gapRole: null,
          unfilledCount: 0,
          appearance: resolveCellAppearance({
            colorConfig: template.color_config,
            columnColor: col.color,
            rowId: shiftId,
            kind: 'closed',
          }),
        }
      }
      const key = `${shiftId}||${col.date}`
      const asgs = asgByKey.get(key) ?? []
      const gap = gapByKey.get(key)
      // Full name + role per assignment, matching the on-screen card exactly
      // (which shows `employee_name` then the role line, role gated by show_role).
      const employees: GridCellEmployee[] = asgs
        .slice()
        .sort(compareByRoleThenName)
        .map(a => ({
          name: a.employee_name ?? '',
          role: showRole ? (a.role ?? '') : '',
        }))
      const unfilled = gap ? (gap.required_count - gap.filled_count) : 0
      let kind: CellKind
      if (asgs.length === 0 && unfilled === 0) kind = 'empty'
      else if (asgs.length === 0 && unfilled > 0) kind = 'gap'
      else if (asgs.length > 0 && unfilled > 0) kind = 'partial'
      else kind = 'filled'
      return {
        kind,
        shiftId,
        date: col.date,
        employees,
        gapRole: gap?.role ?? null,
        unfilledCount: unfilled,
        appearance: resolveCellAppearance({
          colorConfig: template.color_config,
          columnColor: col.color,
          rowId: shiftId,
          kind,
        }),
      }
    })
  }

  const templateRows: GridRow[] = visibleRows.map(row => ({
    shiftId: row.id,
    label: row.label,
    meta: buildShiftMetaLabel(shiftByName.get(row.id)),
    height: row.height ?? 80,
    cells: buildCells(row.id),
  }))

  // Special-event shifts (item 6): one-off shifts the engine added for a
  // specific date (e.g. "Swim Meet 07:00–15:30") live in the schedule data but
  // are NOT template rows — so without this they'd be invisible on the download
  // and to staff. Surface every shift name that appears in assignments/gaps but
  // has no template row, as its own row, so the rendered schedule matches what
  // the engine built and what employees are actually given.
  const templateRowIds = new Set(visibleRows.map(r => r.id))
  const eventNames: string[] = []
  const seenEvent = new Set<string>()
  const eventTimes = new Map<string, { start: string; end: string }>()
  const noteEventShift = (name: string, start?: string, end?: string) => {
    if (!name || templateRowIds.has(name)) return
    if (!seenEvent.has(name)) { seenEvent.add(name); eventNames.push(name) }
    if (start && end && !eventTimes.has(name)) eventTimes.set(name, { start, end })
  }
  for (const a of assignments) noteEventShift(a.shift_name, a.start_time, a.end_time)
  for (const g of gaps) noteEventShift(g.shift_name)

  const hhmm = (t: string): string => (t ?? '').slice(0, 5)
  const eventRows: GridRow[] = eventNames.map(name => {
    const t = eventTimes.get(name)
    const meta = t ? `Special event • ${hhmm(t.start)}–${hhmm(t.end)}` : 'Special event'
    return { shiftId: name, label: name, meta, height: 80, cells: buildCells(name) }
  })

  return {
    companyName,
    weekStart: schedule.week_start,
    weekEnd: schedule.week_end,
    weekRangeLabel: weekRangeLabel(schedule.week_start, schedule.week_end),
    generatedAt: new Date().toISOString(),
    columns,
    rows: [...templateRows, ...eventRows],
  }
}
