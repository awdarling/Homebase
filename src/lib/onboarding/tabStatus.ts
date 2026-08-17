// L5 — the pure status rules behind the Onboarding tab.
//
// Extracted from OnboardingTab.tsx so they can be TESTED. The tab is a 700-line
// client component that queries Supabase from the browser, so nothing in it was
// unit-testable — and the bug below shipped and stayed shipped as a result. The
// same lesson as L2's print lifecycle: logic that can't be tested is logic that
// breaks quietly.
//
// ── THE BUG ──────────────────────────────────────────────────────────────────
//
// The tab derived a row's terminal state from the most recent onboarding event,
// and then set `completedAt: log.created_at` INSIDE the branch that covers ALL
// terminal actions — completion, timeout, and skip alike. So a TIMEOUT stamped
// the column headed "Completed".
//
// Alexander saw the result on Bennet Nieukoop's row: Status "Timed Out" (red)
// sitting next to Completed "Aug 16, 4:13 PM" — and that date WAS the timeout
// event's own timestamp. One row asserting two contradictory things about the
// same person, which is what made the underlying Aegis bug so hard to see.
//
// Note the Aegis-side fix (L5 part 1) stops most of those timeout events being
// written at all. This is the display half: even when a timeout IS legitimate,
// it must never be rendered as a completion.

/** Terminal onboarding events — these, and only these, drive the status pill. */
export const ONBOARDING_TERMINAL_ACTIONS: string[] = [
  'onboarding_complete',
  'onboarding_timeout',
  // Aegis has written '..._no_contact' since the email-channel work; the tab
  // only ever looked for the older '..._no_phone', so its 'skipped' status was
  // unreachable dead code. Both are accepted — the old name may exist on
  // historical rows.
  'onboarding_skipped_no_contact',
  'onboarding_skipped_no_phone',
];

/**
 * Lifecycle events that belong in the TIMELINE but must never drive the status.
 *
 * The tab was blind to both, so a re-onboard was invisible: Bennet's history
 * read "confirmed SMS opt-in" and then "expired without completion" with the
 * restart in between simply missing — making the contradiction impossible to
 * explain from the UI. Kept in a separate list on purpose: adding a
 * non-terminal event to the list above would make it the "latest log" and
 * mislabel the row.
 */
export const TIMELINE_ONLY_ACTIONS: string[] = ['onboarding_started', 'onboarding_24h_warning_sent'];

export type TabOnboardingStatus = 'complete' | 'timed_out' | 'skipped' | 'not_started';

/** Map a terminal event to the status pill. */
export function statusFromTerminalAction(action: string): TabOnboardingStatus {
  if (action === 'onboarding_complete') return 'complete';
  if (action === 'onboarding_timeout') return 'timed_out';
  if (action === 'onboarding_skipped_no_contact' || action === 'onboarding_skipped_no_phone') return 'skipped';
  return 'not_started';
}

/**
 * THE FIX, isolated so it can be pinned: the "Completed" timestamp is populated
 * by a COMPLETION and nothing else.
 */
export function completedAtFor(action: string, createdAt: string): string | null {
  return action === 'onboarding_complete' ? createdAt : null;
}

/** Plain-English names for the terminal events shown in the "Last Event" column. */
export const LAST_EVENT_LABELS: Record<string, string> = {
  onboarding_timeout: 'timed out',
  onboarding_skipped_no_contact: 'skipped — no contact info',
  onboarding_skipped_no_phone: 'skipped — no contact info',
};
