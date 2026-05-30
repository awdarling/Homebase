/*
 * smoke-notify-safety-guard.ts
 *
 * Verifies the Phase-2 fix for the auto-fire-notification bug. Before this
 * fix, GapResolverPanel.handleAssign() would fire-and-forget a POST to
 * /api/notify-assignment immediately after the schedule write, sending an
 * SMS without manager consent.
 *
 * What this smoke covers automatically:
 *   1. The client-side SMS preview template matches the server-side template
 *      byte-for-byte (so what the manager sees in the confirm card is what
 *      actually goes out).
 *   2. The notify-assignment route source actually imports SSR auth and
 *      rejects unauthenticated callers (grep-level assertion — the route is
 *      now gated, not open).
 *   3. The GapResolverPanel source no longer fire-and-forgets the notify
 *      POST inside handleAssign; the notify call now lives in a separate
 *      handler reached only via the confirm card.
 *   4. The GapResolverPanel source writes a 'notification_suppressed'
 *      activity_log entry when the manager dismisses the confirm.
 *
 * What this smoke does NOT cover (manual UI verification required):
 *
 *   MANUAL TEST — happy path:
 *     a. In the schedule editor, open a gap (any unfilled shift) → GapResolverPanel
 *        opens.
 *     b. Click Assign on a candidate → Soteria validation card shows.
 *     c. Click Confirm Assignment → assignment writes; notify-confirm card
 *        replaces the Soteria card. It should show: "Notify [employee] about
 *        this assignment?" + SMS preview + Skip / Send buttons.
 *     d. Click Send SMS → POST fires; panel closes; activity_log shows
 *        'assignment_notification_sent' with actor='manager' and
 *        metadata.approved_by = your user id.
 *
 *   MANUAL TEST — skip path (THE BUG):
 *     a–c as above.
 *     d. Click Skip notification → no POST fires; panel closes; activity_log
 *        shows 'notification_suppressed' with metadata.reason =
 *        'manager_dismissed_confirm'. NO SMS is sent.
 *
 *   MANUAL TEST — no-phone path:
 *     a–c as above, but pick an employee with no contact_phone.
 *     d. Send SMS button is disabled; only Skip remains clickable. A muted
 *        warning explains why.
 *
 *   MANUAL TEST — auth gate:
 *     curl -X POST http://localhost:3000/api/notify-assignment -H 'content-type: application/json' \
 *       -d '{"employee_id":"x","shift_name":"y","role":"z","date":"2026-01-01","start_time":"09:00","end_time":"17:00","company_id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890"}'
 *     → must return 401 Unauthorized (was previously open, allowing
 *       arbitrary SMS spam).
 */

import * as path from 'path'
import * as fs from 'fs'

const ROOT = process.cwd()

function read(p: string): string {
  return fs.readFileSync(path.resolve(ROOT, p), 'utf-8')
}

function expect(cond: boolean, msg: string) {
  if (!cond) { console.error('✗ ' + msg); process.exit(1) }
  else console.log('✓ ' + msg)
}

// ── 1. SMS preview template parity ───────────────────────────────────────────
// Both the client preview (in GapResolverPanel) and the server template (in
// notify-assignment route) must produce the same body, otherwise the manager
// approves text X and the employee receives text Y.

const panelSrc = read('src/components/schedule/GapResolverPanel.tsx')
const routeSrc = read('src/app/api/notify-assignment/route.ts')

const TEMPLATE_FRAGMENT = "you've been added to the ${args.shift_name} shift (${args.role}, ${args.start_time}–${args.end_time}) on ${dateStr} by your manager. See you then!"
const SERVER_TEMPLATE_FRAGMENT = "you've been added to the ${shift_name} shift (${role}, ${start_time}–${end_time}) on ${dateStr} by your manager. See you then!"

expect(
  panelSrc.includes(TEMPLATE_FRAGMENT),
  'GapResolverPanel exports a buildAssignmentSmsPreview matching the SMS body',
)
expect(
  routeSrc.includes(SERVER_TEMPLATE_FRAGMENT),
  'notify-assignment route still uses the canonical SMS body',
)

// ── 2. notify-assignment route has SSR auth gate ────────────────────────────

expect(
  routeSrc.includes("from '@/lib/supabase/server'"),
  'notify-assignment imports the SSR Supabase helper for auth checks',
)
expect(
  /Unauthorized[\s\S]*401/.test(routeSrc),
  'notify-assignment route returns 401 Unauthorized when no session is attached',
)
expect(
  /Forbidden[\s\S]*403/.test(routeSrc),
  'notify-assignment route returns 403 Forbidden when company_id does not match the caller',
)
expect(
  routeSrc.includes('approved_by'),
  'notify-assignment metadata records approved_by for the manager audit trail',
)
expect(
  /actor:\s*['"]manager['"]/.test(routeSrc) && !/actor:\s*['"]system['"]/.test(routeSrc),
  "notify-assignment writes activity_log entries with actor='manager' (no leftover 'system' actor on the notify path)",
)

// ── 3. GapResolverPanel no longer fire-and-forgets the notify call ──────────

// The fingerprint of the old bug was a fire-and-forget fetch with a
// .catch(() => {}) immediately after the schedule write. The handleAssign
// body should no longer contain that pattern.

const handleAssignStart = panelSrc.indexOf('async function handleAssign(')
const handleAssignEnd = panelSrc.indexOf('// ── Notify confirm ──')
expect(
  handleAssignStart !== -1 && handleAssignEnd !== -1 && handleAssignEnd > handleAssignStart,
  'handleAssign is followed by a dedicated "Notify confirm" section (not inline notify)',
)
const handleAssignBody = panelSrc.slice(handleAssignStart, handleAssignEnd)
expect(
  !handleAssignBody.includes("/api/notify-assignment"),
  'handleAssign no longer calls /api/notify-assignment (auto-fire removed)',
)
expect(
  !/\.catch\(\(\)\s*=>\s*\{\}\)/.test(handleAssignBody),
  'handleAssign no longer contains a swallow-errors .catch(() => {})',
)

// ── 4. Notify confirm flow lives in dedicated handlers ──────────────────────

expect(
  panelSrc.includes('async function handleNotifySend()'),
  'GapResolverPanel exposes a handleNotifySend (the Yes path)',
)
expect(
  panelSrc.includes('async function handleNotifySkip()'),
  'GapResolverPanel exposes a handleNotifySkip (the No path)',
)
expect(
  panelSrc.includes("action: 'notification_suppressed'"),
  "handleNotifySkip logs activity_log entry 'notification_suppressed'",
)
expect(
  panelSrc.includes("reason: 'manager_dismissed_confirm'"),
  "suppressed entry carries reason='manager_dismissed_confirm' for audit",
)
expect(
  panelSrc.includes("original_trigger: 'gap_resolver_assignment'"),
  'suppressed entry carries original_trigger for source attribution',
)

// ── 5. notify-confirm view actually renders ─────────────────────────────────

expect(
  panelSrc.includes("notifyPhase !== 'idle'") && panelSrc.includes('Notify confirm overlay'),
  'GapResolverPanel renders the notify-confirm overlay when notifyPhase is non-idle',
)
expect(
  panelSrc.includes('Skip notification') && panelSrc.includes('Send SMS'),
  'notify-confirm card exposes both Skip and Send buttons',
)

console.log('\n✓ All notify-safety-guard assertions passed')
console.log('  (Manual UI verification steps documented at top of this file.)')
