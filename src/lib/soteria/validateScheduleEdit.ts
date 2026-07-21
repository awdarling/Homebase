// Deterministic schedule-edit validator (SOTERIA-CHECK-1 + SOTERIA-SCOPE-1).
//
// WHY THIS EXISTS: manual schedule edits were validated by handing context to
// an LLM, which (a) never loaded custom_availability and (b) could silently
// miss rules even when given them. A swap that violated an employee's custom
// availability was approved. This module makes the rules deterministic and
// complete — nothing hardcoded per-shift, nothing skipped — so a wrong edit can
// never slip through.
//
// SOTERIA-SCOPE-1 (2026-07-21): the LLM "soft warning" pass was REMOVED
// (hallucination slop — fairness/rotation/coverage-thinking opinions). Soteria
// now surfaces ONLY these deterministic checks, grounded entirely in configured
// Homebase data + physical reality. Every configured rule a manual edit can
// break is checked here:
//   ERRORS (block publish):   qualification, availability (incl. custom),
//                             approved time off, max weekly hours,
//                             overlapping double-booking, never-together pairs.
//   WARNINGS (heads-up only): too many consecutive days worked, sex/gender
//                             concurrent coverage, veteran-only/min-veteran
//                             shift rules, shift left understaffed.
// The shift-level warnings are scoped to the CELLS the edit touched, so a
// pre-existing gap elsewhere is never re-surfaced as noise.
//
// The custom-availability resolution mirrors Aegis
// src/lib/custom-availability.ts (resolveAvailabilityForWeek); the sex-coverage
// and veteran-rule logic mirror the Aegis engine (sex-coverage.ts,
// experience-rules.ts) so Soteria judges edits the same way the schedule was
// built — one source of truth.

import type {
  CustomAvailability,
  CustomAvailabilityPattern,
  CustomAvailabilityWeek,
} from '@/lib/types'

export interface ValidatorEmployee {
  id: string
  name: string
  qualified_roles: string[]
  max_weekly_hours: number
  // Optional attributes used by the shift-level rule checks. Absent = the check
  // that needs them simply doesn't fire for this person.
  sex?: string
  is_veteran?: boolean
}

export interface ValidatorAvailability {
  day_of_week: number
  start_time: string
  end_time: string
}

export interface ValidatorAssignment {
  employee_id: string
  employee_name: string
  date: string // YYYY-MM-DD
  shift_name: string
  role: string
  start_time: string // HH:MM or HH:MM:SS
  end_time: string
  hours: number
}

export interface ValidatorTimeOff {
  employee_id: string
  start_date: string
  end_date: string
}

export interface ValidatorConflict {
  employee_id_1: string
  employee_id_2: string
  severity: string // 'never' is the hard block
}

// ── shift-structure + rule inputs (SOTERIA-SCOPE-1) ─────────────────────────────
export interface ValidatorShiftType {
  id: string
  name: string
  start_time: string
  end_time: string
  days_active: number[]
}
export interface ValidatorShiftRequirement {
  shift_type_id: string
  role: string
  required_count: number
  accepted_roles: string[] | null
}
// Mirrors the Aegis engine's EngineExperienceRule.
export interface ValidatorExperienceRule {
  shift_type_id: string | null
  days_of_week: number[] | null
  role: string | null
  mode: 'all_veterans' | 'min_veterans'
  min_count: number | null
  season_start: string | null
  season_end: string | null
  active: boolean
}
// Mirrors the Aegis engine's ConcurrentCoverageConstraint (sex/gender coverage).
export interface ValidatorSexCoverage {
  attribute: string // e.g. 'sex'
  minimums: Record<string, number> // e.g. { male: 1, female: 1 }
  population_roles: string[]
}

export type ScheduleEditIssueCode =
  | 'not_qualified'
  | 'availability'
  | 'custom_availability'
  | 'time_off'
  | 'max_hours'
  | 'double_booking'
  | 'banned_pair'
  | 'consecutive_days'
  | 'sex_coverage'
  | 'veteran_rule'
  | 'understaffed'

export interface ScheduleEditIssue {
  severity: 'error' | 'warning'
  employee_name: string
  description: string
  suggestion: string | null
  code: ScheduleEditIssueCode
}

export interface ValidateScheduleEditInput {
  weekStart: string // YYYY-MM-DD
  proposedAssignments: ValidatorAssignment[]
  touchedEmployeeIds: string[]
  employeesById: Map<string, ValidatorEmployee>
  availByEmp: Map<string, ValidatorAvailability[]>
  customByEmp: Map<string, CustomAvailability | null>
  timeOff: ValidatorTimeOff[]
  conflicts: ValidatorConflict[]
  // ── SOTERIA-SCOPE-1 optional inputs (each check is skipped if its input is
  // absent, so older callers keep working unchanged) ──
  // Configured "max consecutive days worked" guideline. When set, an employee
  // scheduled more days in a row than this gets a (non-blocking) reminder.
  maxConsecutiveDays?: number | null
  // Cells the edit touched, as `${shift_name}||${date}`. Shift-level warnings
  // (understaffing, veteran, coverage) are limited to these so pre-existing gaps
  // aren't re-surfaced. If omitted, they default to the cells of touched people.
  touchedCells?: Set<string>
  shiftTypes?: ValidatorShiftType[]
  shiftRequirements?: ValidatorShiftRequirement[]
  experienceRules?: ValidatorExperienceRule[]
  sexCoverage?: ValidatorSexCoverage | null
}

// ── time helpers ──────────────────────────────────────────────────────────────
function hhmm(t: string): string {
  return (t ?? '').slice(0, 5)
}
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  // touching intervals (a.end === b.start) do NOT overlap
  return hhmm(aStart) < hhmm(bEnd) && hhmm(bStart) < hhmm(aEnd)
}
function dayOfWeek(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay()
}
function daysBetween(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T12:00:00Z`).getTime()
  const to = new Date(`${toDate}T12:00:00Z`).getTime()
  return Math.floor((to - from) / (24 * 60 * 60 * 1000))
}

// ── custom-availability resolution (mirrors Aegis resolveAvailabilityForWeek) ──
function isPattern(v: unknown): v is CustomAvailabilityPattern {
  if (!v || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  return typeof p.day_of_week === 'number' && typeof p.start_time === 'string' && typeof p.end_time === 'string'
}
function isWeek(v: unknown): v is CustomAvailabilityWeek {
  if (!v || typeof v !== 'object') return false
  const w = v as Record<string, unknown>
  return typeof w.week === 'number' && Array.isArray(w.days) && w.days.every(isPattern)
}

export interface EffectiveAvailability {
  slots: ValidatorAvailability[]
  customApplied: boolean
}

export function resolveEffectiveAvailability(
  weekStart: string,
  normal: ValidatorAvailability[],
  custom: CustomAvailability | null,
): EffectiveAvailability {
  const fallback = { slots: normal, customApplied: false }
  if (!custom || !custom.active) return fallback
  if (custom.end_date && custom.end_date < weekStart) return fallback

  const toSlots = (ps: CustomAvailabilityPattern[]): ValidatorAvailability[] =>
    ps.map(p => ({ day_of_week: p.day_of_week, start_time: p.start_time, end_time: p.end_time }))

  if (custom.type === 'date_limited') {
    const ps = (custom.patterns as unknown[]).every(isPattern) ? (custom.patterns as CustomAvailabilityPattern[]) : null
    if (!ps) return fallback
    return { slots: toSlots(ps), customApplied: true }
  }

  if (custom.type === 'rotating') {
    if (!custom.cycle_start_date || !custom.cycle_weeks) return fallback
    const weeks = (custom.patterns as unknown[]).every(isWeek) ? (custom.patterns as CustomAvailabilityWeek[]) : null
    if (!weeks) return fallback
    const diff = daysBetween(custom.cycle_start_date, weekStart)
    if (diff < 0) return fallback
    const weekNumber = (Math.floor(diff / 7) % custom.cycle_weeks) + 1
    const matched = weeks.find(w => w.week === weekNumber)
    if (!matched) return fallback
    return { slots: toSlots(matched.days), customApplied: true }
  }

  return fallback
}

function availabilityContains(slots: ValidatorAvailability[], dow: number, start: string, end: string): boolean {
  return slots.some(s => s.day_of_week === dow && hhmm(s.start_time) <= hhmm(start) && hhmm(s.end_time) >= hhmm(end))
}

// ── shift-level rule helpers (mirror the Aegis engine) ──────────────────────────

// Longest run of consecutive worked days among a set of dates.
function longestConsecutiveRun(dates: string[]): number {
  const uniq = Array.from(new Set(dates)).sort()
  if (uniq.length === 0) return 0
  let best = 1
  let cur = 1
  for (let i = 1; i < uniq.length; i++) {
    if (daysBetween(uniq[i - 1], uniq[i]) === 1) {
      cur++
      if (cur > best) best = cur
    } else {
      cur = 1
    }
  }
  return best
}

function cellKey(shift_name: string, date: string): string {
  return `${shift_name}||${date}`
}
function groupByCell(assignments: ValidatorAssignment[]): Map<string, ValidatorAssignment[]> {
  const m = new Map<string, ValidatorAssignment[]>()
  for (const a of assignments) {
    const k = cellKey(a.shift_name, a.date)
    const list = m.get(k)
    if (list) list.push(a)
    else m.set(k, [a])
  }
  return m
}

// Mirrors experience-rules.ts ruleAppliesOnDate.
function ruleAppliesOnDate(rule: ValidatorExperienceRule, date: string, shiftTypeId: string): boolean {
  if (!rule.active) return false
  if (rule.shift_type_id && rule.shift_type_id !== shiftTypeId) return false
  if (rule.season_start && date < rule.season_start) return false
  if (rule.season_end && date > rule.season_end) return false
  if (rule.days_of_week && rule.days_of_week.length > 0) {
    if (!rule.days_of_week.includes(dayOfWeek(date))) return false
  }
  return true
}

// Concurrent (facility-wide temporal) coverage, restricted to `dates`. Mirrors
// Aegis sex-coverage.ts: segment each day at shift boundaries, skip single-staff
// segments, flag any required attribute value absent, coalesce contiguous gaps.
function evaluateSexCoverageForDates(
  proposed: ValidatorAssignment[],
  employeesById: Map<string, ValidatorEmployee>,
  cfg: ValidatorSexCoverage,
  dates: Set<string>,
): ScheduleEditIssue[] {
  const out: ScheduleEditIssue[] = []
  const pop = new Set(cfg.population_roles)
  const byDate = new Map<string, ValidatorAssignment[]>()
  for (const a of proposed) {
    if (!pop.has(a.role)) continue
    if (dates.size > 0 && !dates.has(a.date)) continue
    const list = byDate.get(a.date)
    if (list) list.push(a)
    else byDate.set(a.date, [a])
  }

  for (const [date, dayAssigns] of Array.from(byDate)) {
    const bset = new Set<string>()
    for (const a of dayAssigns) { bset.add(hhmm(a.start_time)); bset.add(hhmm(a.end_time)) }
    const bounds = Array.from(bset).sort()

    const missingByValue = new Map<string, { start: string; end: string }[]>()
    for (let i = 0; i < bounds.length - 1; i++) {
      const t0 = bounds[i]
      const t1 = bounds[i + 1]
      const onDuty = dayAssigns.filter(a => hhmm(a.start_time) <= t0 && hhmm(a.end_time) >= t1)
      if (onDuty.length < 2) continue // single-staff segment = boundary artifact, not a gap
      const present = new Set<string>()
      for (const a of onDuty) {
        const e = employeesById.get(a.employee_id)
        if (e && e.sex != null) present.add(String(e.sex))
      }
      for (const [value, minN] of Object.entries(cfg.minimums)) {
        if (minN < 1) continue
        if (present.has(value)) continue
        const list = missingByValue.get(value)
        if (list) list.push({ start: t0, end: t1 })
        else missingByValue.set(value, [{ start: t0, end: t1 }])
      }
    }

    for (const [value, segs] of Array.from(missingByValue)) {
      segs.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
      let run: { start: string; end: string } | null = null
      const flush = () => {
        if (!run) return
        out.push({
          severity: 'warning', code: 'sex_coverage', employee_name: 'Coverage',
          description: `No ${value} on duty ${run.start}–${run.end} on ${date}.`,
          suggestion: `Keep at least one ${value} in ${cfg.population_roles.join('/')} on duty during that window.`,
        })
        run = null
      }
      for (const seg of segs) {
        if (run && run.end === seg.start) run.end = seg.end
        else { flush(); run = { start: seg.start, end: seg.end } }
      }
      flush()
    }
  }
  return out
}

// Veteran-only / min-veteran shift rules, scoped to the edited cells. Mirrors
// experience-rules.ts veteranTargetsForGroup.
function evaluateVeteranRules(
  proposed: ValidatorAssignment[],
  employeesById: Map<string, ValidatorEmployee>,
  rules: ValidatorExperienceRule[],
  shiftTypes: ValidatorShiftType[],
  cells: Set<string>,
): ScheduleEditIssue[] {
  const out: ScheduleEditIssue[] = []
  const typeByName = new Map(shiftTypes.map(s => [s.name, s]))
  const byCell = groupByCell(proposed)
  for (const key of Array.from(cells)) {
    const [shift_name, date] = key.split('||')
    const st = typeByName.get(shift_name)
    if (!st) continue
    const group = byCell.get(key) ?? []
    if (group.length === 0) continue
    for (const rule of rules) {
      if (!ruleAppliesOnDate(rule, date, st.id)) continue
      const subset = rule.role ? group.filter(a => a.role === rule.role) : group
      if (subset.length === 0) continue
      const need = rule.mode === 'all_veterans'
        ? subset.length
        : Math.max(1, Math.min(rule.min_count ?? 1, subset.length))
      const vets = subset.filter(a => employeesById.get(a.employee_id)?.is_veteran).length
      if (vets < need) {
        out.push({
          severity: 'warning', code: 'veteran_rule', employee_name: shift_name,
          description: rule.mode === 'all_veterans'
            ? `${shift_name} on ${date} is set to veterans only, but ${subset.length - vets} of ${subset.length} assigned aren't veterans.`
            : `${shift_name} on ${date} needs ≥${need} veterans, but only ${vets} of ${subset.length} assigned are veterans.`,
          suggestion: `Swap in ${need - vets} more veteran${need - vets === 1 ? '' : 's'} on ${shift_name} (${date}).`,
        })
      }
    }
  }
  return out
}

// A move that leaves a shift short of its configured role counts, scoped to the
// edited cells (so it flags gaps the edit CAUSED, not pre-existing ones).
function evaluateUnderstaffing(
  proposed: ValidatorAssignment[],
  shiftTypes: ValidatorShiftType[],
  shiftRequirements: ValidatorShiftRequirement[],
  cells: Set<string>,
): ScheduleEditIssue[] {
  const out: ScheduleEditIssue[] = []
  const typeByName = new Map(shiftTypes.map(s => [s.name, s]))
  const byCell = groupByCell(proposed)
  for (const key of Array.from(cells)) {
    const [shift_name, date] = key.split('||')
    const st = typeByName.get(shift_name)
    if (!st) continue
    if (st.days_active && st.days_active.length > 0 && !st.days_active.includes(dayOfWeek(date))) continue
    const reqs = shiftRequirements.filter(r => r.shift_type_id === st.id)
    const group = byCell.get(key) ?? []
    for (const r of reqs) {
      const accepted = r.accepted_roles && r.accepted_roles.length > 0 ? r.accepted_roles : [r.role]
      const filled = group.filter(a => accepted.includes(a.role)).length
      if (filled < r.required_count) {
        out.push({
          severity: 'warning', code: 'understaffed', employee_name: shift_name,
          description: `${shift_name} on ${date} has ${filled} of ${r.required_count} ${r.role} filled.`,
          suggestion: `Add ${r.required_count - filled} more ${r.role} to ${shift_name} on ${date}.`,
        })
      }
    }
  }
  return out
}

// ── main ──────────────────────────────────────────────────────────────────────
export function validateScheduleEdit(input: ValidateScheduleEditInput): ScheduleEditIssue[] {
  const issues: ScheduleEditIssue[] = []
  const touched = new Set(input.touchedEmployeeIds)

  // Total proposed weekly hours per employee (across the WHOLE proposed week).
  const hoursByEmp = new Map<string, number>()
  for (const a of input.proposedAssignments) {
    hoursByEmp.set(a.employee_id, (hoursByEmp.get(a.employee_id) ?? 0) + (a.hours ?? 0))
  }

  for (const empId of Array.from(touched)) {
    const emp = input.employeesById.get(empId)
    if (!emp) continue
    const mine = input.proposedAssignments.filter(a => a.employee_id === empId)
    if (mine.length === 0) continue

    const eff = resolveEffectiveAvailability(
      input.weekStart,
      input.availByEmp.get(empId) ?? [],
      input.customByEmp.get(empId) ?? null,
    )
    const empTOs = input.timeOff.filter(t => t.employee_id === empId)

    for (const a of mine) {
      // qualification
      if (!emp.qualified_roles.includes(a.role)) {
        issues.push({
          severity: 'error', employee_name: emp.name, code: 'not_qualified',
          description: `${emp.name} is not qualified for ${a.role} (${a.shift_name} on ${a.date}).`,
          suggestion: `Assign someone whose roles include ${a.role}, or update ${emp.name}'s qualified roles.`,
        })
      }
      // approved time off
      if (empTOs.some(t => a.date >= t.start_date && a.date <= t.end_date)) {
        issues.push({
          severity: 'error', employee_name: emp.name, code: 'time_off',
          description: `${emp.name} has approved time off on ${a.date} but is scheduled for ${a.shift_name}.`,
          suggestion: `Remove ${emp.name} from ${a.date} or cover the shift with someone else.`,
        })
      }
      // availability — using effective (custom-aware) availability
      const dow = dayOfWeek(a.date)
      if (!availabilityContains(eff.slots, dow, a.start_time, a.end_time)) {
        const isCustom = eff.customApplied
        issues.push({
          severity: 'error', employee_name: emp.name,
          code: isCustom ? 'custom_availability' : 'availability',
          description: isCustom
            ? `${emp.name}'s custom availability does not cover ${hhmm(a.start_time)}–${hhmm(a.end_time)} on ${a.date}, but they're scheduled for ${a.shift_name}.`
            : `${emp.name} is not available ${hhmm(a.start_time)}–${hhmm(a.end_time)} on ${a.date}, but they're scheduled for ${a.shift_name}.`,
          suggestion: `Pick someone available for ${a.shift_name} on ${a.date}.`,
        })
      }
    }

    // max weekly hours
    const total = hoursByEmp.get(empId) ?? 0
    if (total > emp.max_weekly_hours) {
      issues.push({
        severity: 'error', employee_name: emp.name, code: 'max_hours',
        description: `${emp.name} is scheduled ${total.toFixed(1)}h this week, over their ${emp.max_weekly_hours}h limit.`,
        suggestion: `Drop a shift or raise ${emp.name}'s weekly hour limit.`,
      })
    }

    // overlapping double-booking (same person, same day, overlapping times)
    for (let i = 0; i < mine.length; i++) {
      let flagged = false
      for (let j = i + 1; j < mine.length && !flagged; j++) {
        if (mine[i].date === mine[j].date && overlaps(mine[i].start_time, mine[i].end_time, mine[j].start_time, mine[j].end_time)) {
          issues.push({
            severity: 'error', employee_name: emp.name, code: 'double_booking',
            description: `${emp.name} is double-booked on ${mine[i].date}: ${mine[i].shift_name} (${hhmm(mine[i].start_time)}–${hhmm(mine[i].end_time)}) overlaps ${mine[j].shift_name} (${hhmm(mine[j].start_time)}–${hhmm(mine[j].end_time)}).`,
            suggestion: `Keep ${emp.name} on only one of the overlapping shifts.`,
          })
          flagged = true
        }
      }
      if (flagged) break
    }

    // too many consecutive days worked (non-blocking reminder; configured threshold)
    if (input.maxConsecutiveDays != null && input.maxConsecutiveDays > 0) {
      const run = longestConsecutiveRun(mine.map(a => a.date))
      if (run > input.maxConsecutiveDays) {
        issues.push({
          severity: 'warning', employee_name: emp.name, code: 'consecutive_days',
          description: `${emp.name} is scheduled ${run} days in a row, over the ${input.maxConsecutiveDays}-day guideline.`,
          suggestion: `Give ${emp.name} a day off within that stretch if you can.`,
        })
      }
    }
  }

  // banned pairs ('never') co-staffed in the same cell (shift_name + date)
  const neverPairs = input.conflicts.filter(c => c.severity === 'never')
  if (neverPairs.length > 0) {
    const cell = new Map<string, string[]>()
    for (const a of input.proposedAssignments) {
      const k = `${a.shift_name}||${a.date}`
      const list = cell.get(k)
      if (list) list.push(a.employee_id)
      else cell.set(k, [a.employee_id])
    }
    const nameOf = (id: string) => input.employeesById.get(id)?.name ?? id
    const seen = new Set<string>()
    for (const [k, ids] of Array.from(cell)) {
      for (const c of neverPairs) {
        if (ids.includes(c.employee_id_1) && ids.includes(c.employee_id_2)) {
          // only surface pairs the edit is responsible for (at least one touched)
          if (!touched.has(c.employee_id_1) && !touched.has(c.employee_id_2)) continue
          const dedupe = `${k}|${[c.employee_id_1, c.employee_id_2].sort().join('-')}`
          if (seen.has(dedupe)) continue
          seen.add(dedupe)
          const [shift, date] = k.split('||')
          issues.push({
            severity: 'error', employee_name: `${nameOf(c.employee_id_1)} & ${nameOf(c.employee_id_2)}`, code: 'banned_pair',
            description: `${nameOf(c.employee_id_1)} and ${nameOf(c.employee_id_2)} can never work together, but both are on ${shift} on ${date}.`,
            suggestion: `Move one of them off ${shift} on ${date}.`,
          })
        }
      }
    }
  }

  // ── shift-level configured rules (SOTERIA-SCOPE-1), scoped to edited cells ─────
  // Affected cells: explicit from the caller, else the cells of touched people.
  const affectedCells = input.touchedCells ?? new Set(
    input.proposedAssignments
      .filter(a => touched.has(a.employee_id))
      .map(a => cellKey(a.shift_name, a.date)),
  )
  const affectedDates = new Set(Array.from(affectedCells).map(k => k.split('||')[1]))

  if (input.sexCoverage) {
    issues.push(...evaluateSexCoverageForDates(input.proposedAssignments, input.employeesById, input.sexCoverage, affectedDates))
  }
  if (input.experienceRules && input.experienceRules.length > 0 && input.shiftTypes && input.shiftTypes.length > 0) {
    issues.push(...evaluateVeteranRules(input.proposedAssignments, input.employeesById, input.experienceRules, input.shiftTypes, affectedCells))
  }
  if (input.shiftTypes && input.shiftTypes.length > 0 && input.shiftRequirements && input.shiftRequirements.length > 0) {
    issues.push(...evaluateUnderstaffing(input.proposedAssignments, input.shiftTypes, input.shiftRequirements, affectedCells))
  }

  return issues
}
