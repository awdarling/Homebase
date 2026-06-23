// Pillar 4 (explain everything): plain-English formatters for the three pieces
// of company data Soteria could previously EDIT but never SEE — recurring
// availability, custom (temporary) availability, and veteran/experience rules.
//
// Loading and rendering these into Soteria's read context lets her explain an
// employee's current availability, describe active overrides and veteran rules,
// and edit availability without flying blind. Wording mirrors the schedule page
// (src/app/(app)/schedule/page.tsx) so Soteria says the same thing the rest of
// the app shows. These functions are pure (no DB / network) so they unit-test
// cleanly under ts-node, matching the SOTERIA-CHECK-1 harness pattern.

import type {
  Availability,
  CustomAvailability,
  CustomAvailabilityPattern,
  CustomAvailabilityWeek,
  ShiftExperienceRule,
} from '@/lib/types'

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0] // Monday-first, so weekends read "Saturdays & Sundays"

type EmpLite = { id: string; name: string }

/** HH:MM:SS or HH:MM → HH:MM (the engine stores seconds; people don't need them). */
function hhmm(t: string | null | undefined): string {
  return (t ?? '').slice(0, 5)
}

function byMondayFirst(a: number, b: number): number {
  return DOW_ORDER.indexOf(a) - DOW_ORDER.indexOf(b)
}

/** "Saturdays & Sundays", "Mondays, Wednesdays & Fridays", etc. */
export function formatDayList(days: number[]): string {
  const names = DOW_ORDER.filter((d) => days.includes(d)).map((d) => `${DAY_NAMES[d]}s`)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}

/** One line per employee describing their recurring weekly availability. */
export function formatAvailabilitySection(employees: EmpLite[], availability: Availability[]): string {
  if (!employees || employees.length === 0) return ''
  const byEmp = new Map<string, Availability[]>()
  for (const a of availability ?? []) {
    const list = byEmp.get(a.employee_id) ?? []
    list.push(a)
    byEmp.set(a.employee_id, list)
  }
  const lines = employees.map((e) => {
    const rows = byEmp.get(e.id) ?? []
    if (rows.length === 0) return `- ${e.name}: no recurring availability set`
    const parts = [...rows]
      .sort((x, y) => byMondayFirst(x.day_of_week, y.day_of_week))
      .map((r) => `${DAY_ABBR[r.day_of_week] ?? '?'} ${hhmm(r.start_time)}–${hhmm(r.end_time)}`)
    return `- ${e.name}: ${parts.join(', ')}`
  })
  return lines.join('\n')
}

/** Active temporary overrides only — date-limited or rotating. */
export function formatCustomAvailabilitySection(employees: EmpLite[], custom: CustomAvailability[]): string {
  const active = (custom ?? []).filter((c) => c.active)
  if (active.length === 0) return ''
  const nameById = new Map(employees.map((e) => [e.id, e.name]))
  const lines = active.map((c) => {
    const name = nameById.get(c.employee_id) ?? 'Unknown employee'
    const until = c.end_date ? ` until ${c.end_date}` : ''
    if (c.type === 'date_limited') {
      const pats = (c.patterns as CustomAvailabilityPattern[]) ?? []
      const desc = pats.length
        ? pats
            .slice()
            .sort((x, y) => byMondayFirst(x.day_of_week, y.day_of_week))
            .map((p) => `${DAY_ABBR[p.day_of_week] ?? '?'} ${hhmm(p.start_time)}–${hhmm(p.end_time)}`)
            .join(', ')
        : '(no hours listed)'
      return `- ${name}: temporary date-limited availability${until} — ${desc}`
    }
    const weeks = (c.patterns as CustomAvailabilityWeek[]) ?? []
    const cyc = c.cycle_weeks ? `${c.cycle_weeks}-week rotation` : 'rotation'
    const start = c.cycle_start_date ? `, starting ${c.cycle_start_date}` : ''
    const weekDesc = weeks
      .slice()
      .sort((a, b) => a.week - b.week)
      .map((w) => {
        const days = (w.days ?? [])
          .slice()
          .sort((x, y) => byMondayFirst(x.day_of_week, y.day_of_week))
          .map((p) => `${DAY_ABBR[p.day_of_week] ?? '?'} ${hhmm(p.start_time)}–${hhmm(p.end_time)}`)
          .join(', ')
        return `Week ${w.week}: ${days || '(off)'}`
      })
      .join(' | ')
    return `- ${name}: ${cyc}${start}${until} — ${weekDesc}`
  })
  return lines.join('\n')
}

/** Active veteran/experience rules, phrased like the schedule page. */
export function formatVeteranRulesSection(
  rules: ShiftExperienceRule[],
  shiftTypeNameById: Map<string, string>,
): string {
  const active = (rules ?? []).filter((r) => r.active)
  if (active.length === 0) return ''
  const lines = active.map((r) => {
    const who =
      r.mode === 'all_veterans'
        ? 'Veterans only'
        : `At least ${r.min_count ?? 1} veteran${(r.min_count ?? 1) === 1 ? '' : 's'}`
    const shift = r.shift_type_id ? shiftTypeNameById.get(r.shift_type_id) ?? 'a shift' : 'every shift'
    const dayScope =
      Array.isArray(r.days_of_week) && r.days_of_week.length > 0 ? ` on ${formatDayList(r.days_of_week)}` : ''
    const roleScope = r.role ? ` (${r.role} only)` : ''
    const season = r.season_start || r.season_end ? ` [${r.season_start ?? '…'} to ${r.season_end ?? '…'}]` : ''
    return `- ${shift}: ${who}${dayScope}${roleScope}${season}`
  })
  return lines.join('\n')
}
