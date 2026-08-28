// #9.5 — dismissing coverage-review notices.
//
// A manager can hide a coverage flag they've chosen to accept. Dismissal is a
// per-manager VIEW preference: it persists across reloads (browser localStorage)
// and NEVER touches the schedule data — the flag still exists in the engine
// output, it's just hidden from this manager's review list. Keyed per schedule
// so accepting a flag on one week doesn't hide a similar flag on another.

interface CoverageFlagLike {
  type: string
  date: string
  metadata?: {
    time_window?: { start?: string; end?: string }
    missing_sex?: string
    /** W-3: zero_shifts / double_booking flags identify by the person. */
    employee_id?: string
  }
}

/**
 * Stable identity for a flag. Sex-coverage keys keep W-1's exact shape
 * (type + date + window + missing sex) so dismissals saved before W-3 still
 * apply; the W-3 employee-scoped types (zero_shifts, double_booking) key on
 * the person instead — without this, every same-day flag of one type would
 * collapse to a single dismiss key and one click would hide them all.
 */
export function coverageFlagKey(f: CoverageFlagLike): string {
  if (f.type === 'zero_shifts' || f.type === 'double_booking') {
    return [f.type, f.date, f.metadata?.employee_id ?? ''].join('|')
  }
  const w = f.metadata?.time_window
  return [f.type, f.date, w?.start ?? '', w?.end ?? '', f.metadata?.missing_sex ?? ''].join('|')
}

const STORAGE_PREFIX = 'hb:dismissed_coverage_flags:'

export function loadDismissedFlags(scheduleId: string): Set<string> {
  if (typeof window === 'undefined' || !scheduleId) return new Set()
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + scheduleId)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function saveDismissedFlags(scheduleId: string, keys: Set<string>): void {
  if (typeof window === 'undefined' || !scheduleId) return
  try {
    window.localStorage.setItem(STORAGE_PREFIX + scheduleId, JSON.stringify(Array.from(keys)))
  } catch {
    /* storage full or unavailable — dismissal just won't persist; non-fatal */
  }
}

/** Visible flags = those whose key is not in the dismissed set. */
export function filterDismissed<T extends CoverageFlagLike>(flags: T[], dismissed: Set<string>): T[] {
  return (flags ?? []).filter((f) => !dismissed.has(coverageFlagKey(f)))
}
