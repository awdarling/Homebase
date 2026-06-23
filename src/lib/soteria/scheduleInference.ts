// Pillar 2 (document ingestion) — existing-schedule ingestion.
//
// When a club already runs a weekly schedule, the fastest way to set them up is
// to read that schedule and infer the underlying structure: what shifts exist,
// their hours, the days they run, and how many of each role they need. This
// pure module turns the rows Soteria extracts from a schedule grid into a
// ConfigBundle (roles + shift types with role requirements) that the existing
// ingestion planner can order, validate, and apply. Pure → unit-tested under
// ts-node; the executor (import_schedule_structure) does the DB writes.

import type { ConfigBundle, ShiftTypeInput } from './ingestionPlanner'

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export interface ScheduleRowInput {
  shift_name?: string
  role?: string
  day_of_week?: number
  start_time?: string
  end_time?: string
}

export interface ScheduleInferenceResult {
  bundle: ConfigBundle
  warnings: string[]
}

const lc = (s: string) => s.trim().toLowerCase()

interface ShiftAccumulator {
  name: string
  days: Set<number>
  timeCounts: Map<string, number> // "HH:MM|HH:MM" -> occurrences
  perDayRoleCounts: Map<number, Map<string, number>> // day -> roleLc -> count
  roleDisplay: Map<string, string> // roleLc -> first-seen display name
}

/**
 * Infer shift types + role requirements from an extracted schedule.
 * - shift hours = the most common (start, end) pair seen for that shift
 * - days_active  = every day the shift appears
 * - required_count per role = the most that role is staffed on any single day
 * Distinct roles seen become bundle.roles so missing ones get created first.
 */
export function inferShiftStructureFromSchedule(rows: ScheduleRowInput[]): ScheduleInferenceResult {
  const warnings: string[] = []
  const shifts = new Map<string, ShiftAccumulator>()
  const allRolesByLc = new Map<string, string>()
  let badRows = 0

  for (const row of rows ?? []) {
    const name = typeof row?.shift_name === 'string' ? row.shift_name.trim() : ''
    const day = row?.day_of_week
    if (!name || !Number.isInteger(day) || (day as number) < 0 || (day as number) > 6) {
      badRows++
      continue
    }
    const dayNum = day as number

    let acc = shifts.get(lc(name))
    if (!acc) {
      acc = { name, days: new Set(), timeCounts: new Map(), perDayRoleCounts: new Map(), roleDisplay: new Map() }
      shifts.set(lc(name), acc)
    }
    acc.days.add(dayNum)

    const start = typeof row.start_time === 'string' ? row.start_time.trim() : ''
    const end = typeof row.end_time === 'string' ? row.end_time.trim() : ''
    if (HHMM.test(start) && HHMM.test(end)) {
      const key = `${start}|${end}`
      acc.timeCounts.set(key, (acc.timeCounts.get(key) ?? 0) + 1)
    }

    const role = typeof row.role === 'string' ? row.role.trim() : ''
    if (role) {
      allRolesByLc.set(lc(role), role)
      if (!acc.roleDisplay.has(lc(role))) acc.roleDisplay.set(lc(role), role)
      let dayRoles = acc.perDayRoleCounts.get(dayNum)
      if (!dayRoles) { dayRoles = new Map(); acc.perDayRoleCounts.set(dayNum, dayRoles) }
      dayRoles.set(lc(role), (dayRoles.get(lc(role)) ?? 0) + 1)
    }
  }

  if (badRows > 0) warnings.push(`Skipped ${badRows} schedule row${badRows === 1 ? '' : 's'} with no shift name or a missing day.`)

  const shiftTypes: ShiftTypeInput[] = []
  for (const acc of Array.from(shifts.values())) {
    if (acc.timeCounts.size === 0) {
      warnings.push(`Couldn't read the hours for shift "${acc.name}" — skipped it. Add its start and end times and I'll set it up.`)
      continue
    }
    // Most common (start, end) pair wins.
    let bestKey = ''
    let bestCount = -1
    for (const [key, count] of Array.from(acc.timeCounts.entries())) {
      if (count > bestCount) { bestCount = count; bestKey = key }
    }
    const [start_time, end_time] = bestKey.split('|')

    // required_count per role = max staffed on any single day.
    const roleMax = new Map<string, number>()
    for (const dayRoles of Array.from(acc.perDayRoleCounts.values())) {
      for (const [roleLc, count] of Array.from(dayRoles.entries())) {
        roleMax.set(roleLc, Math.max(roleMax.get(roleLc) ?? 0, count))
      }
    }
    const role_requirements = Array.from(roleMax.entries()).map(([roleLc, count]) => ({
      accepted_roles: [acc.roleDisplay.get(roleLc) ?? roleLc],
      required_count: count,
    }))
    if (role_requirements.length === 0) {
      warnings.push(`Shift "${acc.name}" had no roles listed — added the shift with no role slots yet.`)
    }

    shiftTypes.push({
      name: acc.name,
      start_time,
      end_time,
      days_active: Array.from(acc.days.values()).sort((a, b) => a - b),
      role_requirements,
    })
  }

  const bundle: ConfigBundle = {
    roles: Array.from(allRolesByLc.values()).map((name) => ({ name })),
    shift_types: shiftTypes,
  }
  return { bundle, warnings }
}
