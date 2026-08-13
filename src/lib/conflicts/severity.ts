// F2 — a banned pair (employee_conflicts) is ALWAYS a hard rule. The soft 'avoid'
// severity was removed: the scheduler only ever enforced 'never' (see Aegis
// schedule-build hardConflictExists / hasHardBannedPair), so 'avoid' silently did
// nothing. This is the single source of truth for that fact (Rule 0b) — every
// write path (the Soteria executor's add_conflict / update_conflict and the
// manager ConflictsTab) normalises through here, so no surface can create an
// 'avoid' pair.
//
// The DB column still stores a string and one legacy 'avoid' row may exist; it is
// shown read-only (and clearly not-enforced) in ConflictsTab until a manager
// removes or re-adds it. Nothing here touches the Aegis engine.

export type ConflictSeverity = 'never'

export const CONFLICT_SEVERITY: ConflictSeverity = 'never'

/** Any requested severity collapses to the only supported value: 'never'. */
export function normalizeConflictSeverity(_requested?: string | null): ConflictSeverity {
  return CONFLICT_SEVERITY
}
