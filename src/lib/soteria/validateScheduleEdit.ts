// Deterministic schedule-edit validator (SOTERIA-CHECK-1).
//
// WHY THIS EXISTS: manual schedule edits were validated by handing context to
// an LLM, which (a) never loaded custom_availability and (b) could silently
// miss rules even when given them. A swap that violated an employee's custom
// availability was approved. This module makes the HARD rules deterministic and
// complete — nothing hardcoded per-shift, nothing skipped — so a wrong edit can
// never slip through. The LLM is retained only for soft/fairness WARNINGS.
//
// The custom-availability resolution mirrors Aegis
// src/lib/custom-availability.ts (resolveAvailabilityForWeek) so Soteria and the
// scheduling engine judge availability the same way (one source of truth).

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

export type ScheduleEditIssueCode =
  | 'not_qualified'
  | 'availability'
  | 'custom_availability'
  | 'time_off'
  | 'max_hours'
  | 'double_booking'
  | 'banned_pair'

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

  return issues
}
