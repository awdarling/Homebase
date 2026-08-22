// ── What does a manager hear from Aegis when they haven't said? ──────────────
//
// RULE 0 — one fact, one place: what the manager SEES here has to be what Aegis
// actually DOES. This file exists because the rule is needed on both sides of a
// repo boundary and there is no shared package to put it in.
//
//   ITS TWIN LIVES AT  Aegis/src/messaging/manager-directory.ts
//                      (OWNER_MUTED_BY_DEFAULT + wantsCategory)
//
// If you change one, change the other in the same breath. The test beside this
// file states the rule in words so a drift is at least loud.
//
// THE RULE (corrected 2026-08-22). Everyone defaults ON. An owner defaults OFF
// only for the high-volume operational chatter they hired managers to absorb.
// They stay ON for the two things an owner is for: decisions that need making,
// and summaries. The first version of this muted an owner for everything, which
// would have stopped a small-business owner receiving time-off requests — at a
// two-manager club that is half the management team. An owner is a manager with
// MORE authority, not less involvement: the toggle is there so they can opt out,
// not so we opt them out for them.

import type { NotifyCategory, NotificationPrefs } from '@/lib/types'

export const OWNER_MUTED_BY_DEFAULT: readonly NotifyCategory[] = ['trades', 'schedule_posts']

/** The default for this role — what happens when nobody has set a preference. */
export function defaultForRole(role: string, category: NotifyCategory): boolean {
  if (role !== 'owner') return true
  return !OWNER_MUTED_BY_DEFAULT.includes(category)
}

/**
 * Does this person receive this category right now? An explicit preference wins;
 * otherwise the role default. Mirrors wantsCategory in Aegis exactly.
 */
export function wantsCategory(
  role: string,
  prefs: NotificationPrefs | null | undefined,
  category: NotifyCategory
): boolean {
  const explicit = prefs?.[category]
  if (typeof explicit === 'boolean') return explicit
  return defaultForRole(role, category)
}

/** The muted-vs-on note shown next to a checkbox nobody has touched. */
export function defaultNote(role: string, category: NotifyCategory): string {
  return defaultForRole(role, category) ? ' · on by default' : ' · off for owners by default'
}
