// ── An employee's active state — one rule, one place ─────────────────────────
//
// Rule 0b (one question, one function): "what does it mean to deactivate or
// reactivate an employee?" has exactly ONE answer, and it lives here. The
// manager control (Data → Employees → the employee's panel) and Soteria's
// `update_employee` handler both read it, so a button click and "deactivate
// Nick" can never come to mean different things.
//
// THE TWO ANSWERS:
//
//   Activate    → active = true  AND last_day = null
//   Deactivate  → active = false AND last_day left exactly as it was
//
// Why activating must clear last_day: Aegis runs a daily offboarding sweep
// (Aegis/src/scheduler/employee-offboarding.ts) that deactivates every employee
// whose `last_day` is in the past. Setting active = true while leaving a past
// `last_day` on the row means the manager watches the employee return — and
// watches Aegis switch them back off within 24 hours.
//
// Why deactivating must NOT touch last_day: the two fields answer different
// questions. `last_day` means "this person is leaving, here is their final
// shift". `active = false` means "not here right now — don't schedule them,
// keep the record": seasonal staff between summers, someone on parental leave.
// Writing a departure date on every manual deactivation would make every leave
// of absence read as a resignation in the record.

export type ActiveStateAction = 'activate' | 'deactivate'

/** The fields these decisions depend on. */
export type ActiveStateEmployee = { active: boolean; last_day?: string | null }

/** Activating writes exactly this. Nothing else may define it. */
export type ActivationPatch = { active: true; last_day: null }

/** Deactivating writes exactly this — note the absence of last_day. */
export type DeactivationPatch = { active: false }

export function activationPatch(): ActivationPatch {
  return { active: true, last_day: null }
}

export function deactivationPatch(): DeactivationPatch {
  return { active: false }
}

/** Which direction does this employee's control go? */
export function activeStateAction(emp: ActiveStateEmployee): ActiveStateAction {
  return emp.active ? 'deactivate' : 'activate'
}

/** The control's label. One control, two labels — never two controls. */
export function activeStateLabel(emp: ActiveStateEmployee): string {
  return emp.active ? 'Deactivate' : 'Activate'
}

/** The write for whichever direction this employee is going. */
export function activeStatePatch(
  emp: ActiveStateEmployee,
): ActivationPatch | DeactivationPatch {
  return emp.active ? deactivationPatch() : activationPatch()
}

/**
 * Does this change need a confirmation first?
 *
 * Deactivating: ALWAYS. It removes someone from every future schedule build and
 * stops Aegis contacting them; a manager deserves to be told that before it
 * happens, not after.
 *
 * Activating: only when a departure date would be erased. That case destroys
 * information. Bringing back someone with no departure date is a plain undo and
 * must not nag.
 */
export function needsActiveStateConfirm(emp: ActiveStateEmployee): boolean {
  return emp.active ? true : !!emp.last_day
}

/**
 * Apply the same rule to a partial update built somewhere else (Soteria).
 *
 * A caller turning `active` on that has NOT said anything about `last_day` means
 * "reactivate", so the departure date is cleared for them. A caller that passes
 * `last_day` explicitly is doing something else (e.g. "set Letizia's last day to
 * Sept 1") and its value is left untouched. Turning `active` off never touches
 * `last_day` at all.
 */
export function applyActiveStateRule(
  updates: Record<string, unknown>,
): Record<string, unknown> {
  if (updates.active === true && !('last_day' in updates)) {
    return { ...updates, ...activationPatch() }
  }
  return { ...updates }
}

/** The activity-log action code for a direction. */
export function activeStateLogAction(action: ActiveStateAction): string {
  return action === 'activate' ? 'employee_activated' : 'employee_deactivated'
}

/**
 * Activity-feed wording — one place, so the feed reads the same however the
 * change happened. Activation always says plainly when a departure date was
 * erased, because that is the part a manager may need to undo.
 *
 * `clearedLastDay` is only meaningful for 'activate'; deactivation never clears
 * anything, so it is ignored there.
 */
export function activeStateSummary(
  action: ActiveStateAction,
  name: string,
  clearedLastDay?: string | null,
  actor: 'manager' | 'soteria' = 'manager',
): string {
  if (action === 'deactivate') {
    return actor === 'soteria'
      ? `Soteria deactivated ${name} — they will not be scheduled or contacted until reactivated.`
      : `Deactivated employee: ${name} — they will not be scheduled or contacted until reactivated.`
  }
  const lead = actor === 'soteria'
    ? `Soteria reactivated ${name}`
    : `Reactivated employee: ${name}`
  return clearedLastDay
    ? `${lead} — their recorded last day (${clearedLastDay}) was cleared.`
    : lead
}
