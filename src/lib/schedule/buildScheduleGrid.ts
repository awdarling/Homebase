import { parseYMD, toYMD } from '@/lib/utils/dates'
import type {
  Schedule,
  ScheduleAssignment,
  ScheduleGap,
  ScheduleTemplate,
} from '@/lib/types'
import { resolveCellAppearance, type CellAppearance } from './resolveCellAppearance'

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

export interface GridCell {
  kind: CellKind
  shiftId: string
  date: string
  employeeDisplayNames: string[]   // pre-formatted, collision-resolved
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

// Renders one employee_name as either "First" or "First L." depending on
// whether the first name collides with another employee in this week.
function buildDisplayNameMap(assignments: ScheduleAssignment[]): Map<string, string> {
  const firstNameCounts = new Map<string, Set<string>>()  // first → set of employee_id
  for (const a of assignments) {
    // Real data can carry a null/blank employee_name (e.g. a manual-edit
    // residue). Normalize before any string op so it can't throw — for valid
    // names this is identical to the previous behavior.
    const name = (a.employee_name ?? '').trim()
    const first = name.split(/\s+/)[0] ?? name
    if (!firstNameCounts.has(first)) firstNameCounts.set(first, new Set())
    firstNameCounts.get(first)!.add(a.employee_id)
  }
  const out = new Map<string, string>()
  for (const a of assignments) {
    if (out.has(a.employee_id)) continue
    const name = (a.employee_name ?? '').trim()
    const parts = name.split(/\s+/)
    const first = parts[0] ?? name
    const collides = (firstNameCounts.get(first)?.size ?? 0) > 1
    if (collides && parts.length > 1) {
      const lastInitial = parts[parts.length - 1][0] ?? ''
      out.set(a.employee_id, `${first} ${lastInitial}.`)
    } else {
      out.set(a.employee_id, first || name)
    }
  }
  return out
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

  const displayName = buildDisplayNameMap(assignments)

  const rows: GridRow[] = visibleRows.map(row => {
    const shift = shiftByName.get(row.id)
    const cells: GridCell[] = columns.map(col => {
      if (col.isClosed) {
        return {
          kind: 'closed',
          shiftId: row.id,
          date: col.date,
          employeeDisplayNames: [],
          gapRole: null,
          unfilledCount: 0,
          appearance: resolveCellAppearance({
            colorConfig: template.color_config,
            columnColor: col.color,
            rowId: row.id,
            kind: 'closed',
          }),
        }
      }
      const key = `${row.id}||${col.date}`
      const asgs = asgByKey.get(key) ?? []
      const gap = gapByKey.get(key)
      const names = asgs
        .slice()
        .sort((a, b) => (a.employee_name ?? '').localeCompare(b.employee_name ?? ''))
        .map(a => displayName.get(a.employee_id) ?? a.employee_name ?? '')
      const unfilled = gap ? (gap.required_count - gap.filled_count) : 0
      let kind: CellKind
      if (asgs.length === 0 && unfilled === 0) kind = 'empty'
      else if (asgs.length === 0 && unfilled > 0) kind = 'gap'
      else if (asgs.length > 0 && unfilled > 0) kind = 'partial'
      else kind = 'filled'
      return {
        kind,
        shiftId: row.id,
        date: col.date,
        employeeDisplayNames: names,
        gapRole: gap?.role ?? null,
        unfilledCount: unfilled,
        appearance: resolveCellAppearance({
          colorConfig: template.color_config,
          columnColor: col.color,
          rowId: row.id,
          kind,
        }),
      }
    })
    return {
      shiftId: row.id,
      label: row.label,
      meta: buildShiftMetaLabel(shift),
      height: row.height ?? 80,
      cells,
    }
  })

  return {
    companyName,
    weekStart: schedule.week_start,
    weekEnd: schedule.week_end,
    weekRangeLabel: weekRangeLabel(schedule.week_start, schedule.week_end),
    generatedAt: new Date().toISOString(),
    columns,
    rows,
  }
}
