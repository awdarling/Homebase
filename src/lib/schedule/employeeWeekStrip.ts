// W-3 (J-1d) — ONE line per employee that shows what the builder saw: their
// availability (normal, or the CURRENT override) and their approved time off
// for the displayed week, together. Jack's exact complaint: Mia's zero-shift
// week took three screens to explain because "home page is saying she's busy
// 9–1 and 3–9" while an availability override sat somewhere else entirely.
//
// Pure — the schedule page loads the rows and passes them in; currency of an
// override is decided by isCustomAvailabilityCurrent (Rule 0b — never a local
// `active` check; that exact shortcut caused C-1).

import type { Availability, CustomAvailability, CustomAvailabilityPattern, TimeOffRequest } from '@/lib/types'
import { isCustomAvailabilityCurrent } from '@/lib/soteria/validateScheduleEdit'
import { fmtClock, partialTimeLabel } from '@/lib/time-off/out-summary'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface EmployeeWeekStrip {
  /** "Avail: Mon–Fri 9:00 AM–3:30 PM" or "Avail (override thru Sep 2): …" */
  availability: string
  /** "Off: Aug 29 (all day) · Aug 30 (9:00 AM – 1:00 PM)" or '' */
  timeOff: string
}

function clock(t: string): string {
  return fmtClock(t) ?? t
}

// Compact day-window rendering: consecutive days sharing one window collapse
// ("Mon–Fri 9:00 AM–3:30 PM"); otherwise days are listed.
export function describeWindows(slots: Array<{ day_of_week: number; start_time: string; end_time: string }>): string {
  if (slots.length === 0) return 'none set'
  const byWindow = new Map<string, number[]>()
  for (const s of [...slots].sort((a, b) => a.day_of_week - b.day_of_week)) {
    const w = `${clock(s.start_time)}–${clock(s.end_time)}`
    const arr = byWindow.get(w) ?? []
    arr.push(s.day_of_week)
    byWindow.set(w, arr)
  }
  const parts: string[] = []
  for (const [w, days] of Array.from(byWindow.entries())) {
    const runs: string[] = []
    let start = days[0]
    let prev = days[0]
    for (const d of days.slice(1)) {
      if (d === prev + 1) { prev = d; continue }
      runs.push(start === prev ? DOW[start] : `${DOW[start]}–${DOW[prev]}`)
      start = d; prev = d
    }
    runs.push(start === prev ? DOW[start] : `${DOW[start]}–${DOW[prev]}`)
    parts.push(`${runs.join(', ')} ${w}`)
  }
  return parts.join(' · ')
}

function fmtShortDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function overrideWindows(o: CustomAvailability): CustomAvailabilityPattern[] {
  // Rotating patterns vary week to week — summarising one week would lie about
  // the others, so a rotation is named rather than expanded.
  const p = o.patterns
  if (!Array.isArray(p) || p.length === 0) return []
  if (typeof (p[0] as { week?: unknown }).week === 'number') return []
  return p as CustomAvailabilityPattern[]
}

/**
 * The per-employee strips for one displayed week.
 * `today` is the company-local date (never the browser's — C-1's lesson).
 */
export function buildEmployeeWeekStrips(input: {
  employeeIds: string[]
  availability: Availability[]
  overrides: CustomAvailability[]
  approvedTimeOff: Array<Pick<TimeOffRequest, 'employee_id' | 'start_date' | 'end_date' | 'time_off_type' | 'partial_days'>>
  weekStart: string
  weekEnd: string
  today: string
}): Record<string, EmployeeWeekStrip> {
  const { employeeIds, availability, overrides, approvedTimeOff, weekStart, weekEnd, today } = input
  const out: Record<string, EmployeeWeekStrip> = {}

  const normalByEmp = new Map<string, Availability[]>()
  for (const a of availability) {
    const arr = normalByEmp.get(a.employee_id) ?? []
    arr.push(a)
    normalByEmp.set(a.employee_id, arr)
  }
  const overrideByEmp = new Map<string, CustomAvailability>()
  for (const o of overrides) {
    if (!isCustomAvailabilityCurrent(o, today)) continue
    // Newest current override wins when several exist (matches the resolvers).
    const prev = overrideByEmp.get(o.employee_id)
    if (!prev || (o.created_at ?? '') > (prev.created_at ?? '')) overrideByEmp.set(o.employee_id, o)
  }

  for (const id of employeeIds) {
    const override = overrideByEmp.get(id)
    let availabilityLabel: string
    if (override) {
      const windows = overrideWindows(override)
      const thru = override.end_date ? ` thru ${fmtShortDate(override.end_date)}` : ''
      availabilityLabel = windows.length > 0
        ? `Avail (override${thru}): ${describeWindows(windows)}`
        : `Avail: rotating override${thru}`
    } else {
      availabilityLabel = `Avail: ${describeWindows(normalByEmp.get(id) ?? [])}`
    }

    const offs = approvedTimeOff
      .filter(t => t.employee_id === id && t.start_date <= weekEnd && t.end_date >= weekStart)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
      .map(t => {
        const range = t.start_date === t.end_date
          ? fmtShortDate(t.start_date)
          : `${fmtShortDate(t.start_date)}–${fmtShortDate(t.end_date)}`
        const partial = t.time_off_type === 'partial' ? partialTimeLabel(t.partial_days) : null
        return `${range} (${partial ?? 'all day'})`
      })

    out[id] = {
      availability: availabilityLabel,
      timeOff: offs.length > 0 ? `Off: ${offs.join(' · ')}` : '',
    }
  }
  return out
}
