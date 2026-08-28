// W-3 (J-1d, DRIFT_REGISTER §N7) — ONE display model for the engine's
// reviewable flags, so CoverageFlags.tsx renders every type the Aegis builder
// produces instead of silently dropping the ones it doesn't know. Pure —
// testable without React.
//
// Mia Shaffer, week of Aug 17: two approved partial time-offs plus a 9–12
// availability override left her with ZERO shifts, every step was "approved",
// and no screen said so. Aegis's W-1 build flags it; this makes Jack SEE it.

import type { FlaggedIssue } from '@/lib/types'

export interface FlagDisplay {
  /** Which flags the review list shows, in severity order. */
  tone: 'red' | 'amber'
  title: string
  /** Secondary lines, muted, in order. */
  lines: string[]
}

function formatDateLong(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function hhmm(t: string | undefined): string {
  return (t ?? '').slice(0, 5)
}

/**
 * The review-list rendering of one engine flag, or null for types the review
 * list deliberately does not show (unsatisfied_attribute_mix has never been
 * rendered; keep that behaviour explicit rather than accidental).
 */
export function describeReviewFlag(f: FlaggedIssue): FlagDisplay | null {
  switch (f.type) {
    case 'unsatisfied_sex_coverage': {
      const w = f.metadata?.time_window
      const missing = f.metadata?.missing_sex ?? 'required'
      const onDuty = f.metadata?.on_duty ?? []
      return {
        tone: 'amber',
        title: `No ${missing} guard on duty`,
        lines: [
          `${formatDateLong(f.date)} · ${hhmm(w?.start)}–${hhmm(w?.end)}`,
          `On duty: ${onDuty.length > 0 ? onDuty.map(d => `${d.name} (${d.role}, ${d.sex})`).join(', ') : '—'}`,
        ],
      }
    }
    case 'zero_shifts': {
      // The engine's description already carries the reason summary in its own
      // words ("unavailable on this day/time (7 slots). availability …") —
      // surface it verbatim rather than re-deriving (Rule 0b / [GAPREASON-DUP]).
      const name = f.metadata?.employee_name ?? 'An active employee'
      return {
        tone: 'red',
        title: `${name}: no shifts this week`,
        lines: [f.description].filter(Boolean),
      }
    }
    case 'double_booking': {
      const name = f.metadata?.employee_name ?? 'An employee'
      const shifts = f.metadata?.shifts ?? []
      return {
        tone: 'red',
        title: `${name} is double-booked`,
        lines: [
          formatDateLong(f.date),
          shifts.length > 0
            ? shifts.map(s => `${s.shift_name} (${hhmm(s.start_time)}–${hhmm(s.end_time)}, ${s.role})`).join(' overlaps ')
            : f.description,
        ].filter(Boolean),
      }
    }
    default:
      return null
  }
}

/** The flags the review list shows, red (real problems) before amber (judgement calls). */
export function reviewableFlags(flags: FlaggedIssue[] | undefined): Array<{ flag: FlaggedIssue; display: FlagDisplay }> {
  const out: Array<{ flag: FlaggedIssue; display: FlagDisplay }> = []
  for (const f of flags ?? []) {
    const display = describeReviewFlag(f)
    if (display) out.push({ flag: f, display })
  }
  return out.sort((a, b) => (a.display.tone === b.display.tone ? 0 : a.display.tone === 'red' ? -1 : 1))
}
