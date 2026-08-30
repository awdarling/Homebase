// P2 (DRIFT §P2) — the in-tab Time Off decision lands in the ONE shared core
// (F13), 2026-08-30.
// Run:  npx tsx src/app/api/time-off-decision/__tests__/p2-in-tab-shared-core.test.ts
//
// The gap this pins closed: before this fix, `/api/time-off-decision` called
// a SECOND, separate decision function (`decideTimeOffRequest`, now retired)
// that had never heard of a call-out. An in-tab approval of a call-out never
// marked the shift on the schedule, never started coverage, and never retired
// a manager's parked text-reply state — even though the email link and a
// texted reply, for the exact same request, did all three (F13/§O3). This
// mirrors n3-time-off-core-dispatch.test.ts's approach for the magic-link
// door: source-level assertions against the real route + tab files, since the
// contract is "which function gets called with what," not runtime behavior
// (that's covered on the Aegis side, where the shared core actually lives —
// see Aegis src/webhooks/__tests__/p2-in-tab-shared-core.test.ts).

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const root = resolve(__dirname, '../../../../..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const route = read('src/app/api/time-off-decision/route.ts')
const tab = read('src/app/(app)/data/tabs/TimeOffTab.tsx')

// ── decideTimeOffRequest is RETIRED — one core, not two (F13) ────────────────
expect(!existsSync(resolve(root, 'src/lib/time-off/decide.ts')),
  'lib/time-off/decide.ts is deleted — the second decision core is gone')
expect(!/decideTimeOffRequest\(/.test(route) && !/from '@\/lib\/time-off\/decide'/.test(route),
  'the route no longer imports or calls decideTimeOffRequest (comments may still tell the history)')

// ── The route forwards to Aegis's shared core, exactly like the magic-link ──
expect(/postToAegisInternal/.test(route) && /'\/internal\/apply-time-off-decision'/.test(route),
  'the in-tab decision is forwarded to /internal/apply-time-off-decision — the same endpoint the email door uses')
expect(/source:\s*'in_tab'/.test(route),
  "the request identifies itself as the in-tab door (source: 'in_tab') so the activity log and voice say so")
expect(!/call_out:/.test(route),
  'the route body never carries a call_out field — Aegis resolves it server-side; the browser should not need to know (comments may still explain why)')
expect(/manager_user_id:\s*user\.id/.test(route),
  'the deciding manager is attributed from the session (decided_by, D17) — never trusted from the request body')
expect(/manager_avatar_url:\s*actor\.avatar_url/.test(route),
  "the manager's avatar rides along so the activity feed credits the real person, same as every other door")
expect(/action !== 'approve' && action !== 'deny' && action !== 'approve_and_cover'/.test(route),
  'the route speaks the same three-action vocabulary as every other door (approve / deny / approve_and_cover)')

// ── A failed/refused Aegis call is reported honestly ─────────────────────────
expect(/err\.status === 403/.test(route),
  "Aegis's revoked-manager refusal (403) is surfaced with its own explanation, not a generic error")
expect(/AegisInternalConfigError/.test(route),
  'a missing Aegis connection is reported plainly rather than silently deciding locally')

// ── The company-scope guard survives (a foreign request is refused) ─────────
expect(/reqData\.company_id !== actor\.company_id/.test(route),
  "a manager still can't decide another company's request — checked before Aegis is ever called")

// ── The tab shows the call-out-aware button set, resolved without needing to
//    ask Aegis anything at decide-time ────────────────────────────────────────
expect(/callOutIds/.test(tab) && /to_thread:/.test(tab),
  'the tab detects call-outs from the same to_thread:<id> side row the email door reads — not a new endpoint')
expect(/Approve & find coverage/.test(tab) && /Approve only/.test(tab),
  'a call-out request shows the same three-choice set as the manager email (§O3)')
expect(/handleDecision\(req, 'approve_and_cover'\)/.test(tab),
  '"Approve & find coverage" sends the approve_and_cover action')
expect(/handleDecision\(req, 'approve'\)/.test(tab),
  '"Approve" / "Approve only" send the approve action')
expect(/handleDecision\(req, 'deny'\)/.test(tab),
  'Deny sends the deny action (present-tense vocabulary, matching every other door)')
expect(!/handleDecision\(req, 'approved'\)/.test(tab) && !/handleDecision\(req, 'denied'\)/.test(tab),
  'the old past-tense action vocabulary ("approved"/"denied") is gone from the tab')

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall p2-in-tab-shared-core checks passed')
