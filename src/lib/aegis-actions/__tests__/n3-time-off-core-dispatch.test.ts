// N-3 — time-off magic links decide through Aegis's ONE core (F13) — 2026-08-28.
// Run:  npx tsx src/lib/aegis-actions/__tests__/n3-time-off-core-dispatch.test.ts
//
// The contract this pins: a time-off / call-out decision clicked from an email
// is (1) confirm-gated — the GET renders a page, only the POST decides — and
// (2) applied by Aegis's applyTimeOffDecision via /internal/apply-time-off-
// decision, never by a Homebase-side status write. That is what makes the email
// button and the manager's texted reply mutually exclusive (whichever arrives
// second is told the truth), and what lets a call-out's third action actually
// blast the coverage pool (§O3).

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { actionResultTitle } from '../labels'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const root = resolve(__dirname, '../../../..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const dispatcher = read('src/lib/aegis-actions/dispatcher.ts')
const route = read('src/app/api/aegis-action/route.ts')
const tokens = read('src/lib/aegis-actions/tokens.ts')

// ── The decision goes to Aegis's shared core, not a local write ──────────────
expect(/'\/internal\/apply-time-off-decision'/.test(dispatcher),
  'time-off decisions are forwarded to /internal/apply-time-off-decision')
expect(!/decideTimeOffRequest/.test(dispatcher),
  'the dispatcher no longer calls the Homebase-side decideTimeOffRequest (one core, F13)')
expect(/case 'approve_to':\s*\n\s*return handleTimeOffDecision\('approve'/.test(dispatcher),
  'approve_to routes through the shared handler')
expect(/case 'deny_to':\s*\n\s*return handleTimeOffDecision\('deny'/.test(dispatcher),
  'deny_to routes through the shared handler')
expect(/case 'approve_and_cover_to':\s*\n\s*return handleTimeOffDecision\('approve_and_cover'/.test(dispatcher),
  'approve_and_cover_to (the call-out third action, §O3) routes through the same handler')
expect(/manager_user_id: strOrNull\(payload\.manager_user_id\) \?\? row\.issued_to_user_id/.test(dispatcher),
  'the deciding manager is attributed from the token (decided_by, D17)')
expect(/call_out: Array\.isArray\(payload\.call_out\)/.test(dispatcher),
  'the call-out snapshot rides to Aegis so approve-and-cover can name and mark the shift')

// ── A failed Aegis call means NOTHING was applied — and the message says so ──
expect(/Nothing has changed; please decide it from the Time Off tab/.test(dispatcher),
  'a failed forward is reported honestly as not-applied (no local fallback write)')
expect(/err\.status === 403/.test(dispatcher),
  "Aegis's revoked-manager refusal (403) is surfaced with its own explanation")

// ── The action type exists end to end ────────────────────────────────────────
expect(/'approve_and_cover_to'/.test(tokens), "tokens.ts ActionType includes 'approve_and_cover_to'")
expect(actionResultTitle('approve_and_cover_to') === 'Approve & Find Coverage',
  'the confirm/result page title reads "Approve & Find Coverage"')

// ── GET confirms, POST consumes (the page side of N-3) ───────────────────────
const getBody = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'))
const postBody = route.slice(route.indexOf('export async function POST'))
expect(/verifyToken\(/.test(getBody) && !/consumeToken\(/.test(getBody),
  'GET verifies the token but never consumes it — a scanner fetch changes nothing')
expect(/consumeToken\(/.test(postBody),
  'POST (the confirm button) is what consumes the token')
expect(/timeOffAlreadyDecidedPage/.test(getBody),
  'GET reports the truthful state when the request was already decided through another door')
expect(/already \$\{status\}|already decided/.test(route) || /that decision stands/.test(route),
  'the already-decided page says the decision stands — never "nothing changed" (J-3 shape)')
expect(/approve_and_cover_to/.test(route),
  'the confirm page describes the call-out third action')
expect(/call_out/.test(route),
  'the confirm copy is call-out-aware (names the shift, says who handles coverage)')

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall n3-time-off-core-dispatch checks passed')
