// S-4 — assignment notifications go through Aegis's consent gate — 2026-08-28.
// Run:  npx tsx src/lib/__tests__/s4-assignment-through-aegis.test.ts
//
// The hole this pins closed: /api/notify-assignment used to send SMS itself
// through Homebase's own Telnyx client — the ONE door in the whole system that
// could text an employee without Aegis's "may we text this person?" check
// (dormant, held closed only by EMAIL_ONLY on Vercel). The route is now a thin
// proxy to Aegis /internal/notify-assignment, exactly like notify-day-closure,
// and Homebase carries NO Telnyx client at all. Rule 0b: exactly one function
// in the system decides whether an employee may be texted.

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const root = resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const route = read('src/app/api/notify-assignment/route.ts')
const panel = read('src/components/schedule/GapResolverPanel.tsx')

// ── The direct send path is GONE ─────────────────────────────────────────────
expect(!existsSync(resolve(root, 'src/lib/sms/telnyx.ts')),
  'src/lib/sms/telnyx.ts is deleted — Homebase carries no Telnyx client')
expect(!/from ['"]@\/lib\/sms\/telnyx['"]/.test(route) && !/sendTelnyxSms\(/.test(route),
  'the route imports no Telnyx client and makes no direct send call (comments may still tell the history)')
expect(!/TELNYX_API_KEY/.test(route), 'the route never reads TELNYX_API_KEY')
expect(!/company_channels/.test(route), "the route no longer looks up the tenant's sending number — Aegis owns channels")
expect(!/process\.env\.EMAIL_ONLY/.test(route), 'the route no longer duplicates the EMAIL_ONLY switch — the gate lives in Aegis sendSms')

// ── It is a thin proxy, with the auth + company binding kept ─────────────────
expect(/ssr\.auth\.getUser\(\)/.test(route), 'route still requires a signed-in user')
expect(/userRecord\.company_id !== company_id/.test(route), "route still binds the caller to the company they're acting on")
expect(/postToAegisInternal/.test(route) && /'\/internal\/notify-assignment'/.test(route),
  'the send is delegated to Aegis /internal/notify-assignment (behind the internal secret)')
expect(/approved_by: user\.id/.test(route), 'the approving manager rides along for the Aegis-side audit log')
expect(/success: false/.test(route) && /could not be sent/.test(route),
  'a failed Aegis call is reported honestly as not-sent')

// ── The caller's contract survives ───────────────────────────────────────────
expect(/fetch\('\/api\/notify-assignment'/.test(panel), 'GapResolverPanel still calls the same route')
expect(/json\.success === false/.test(panel), 'the panel still consumes { success, message }')
expect(/formatPreviewClock/.test(panel) && !/\$\{args\.start_time\}–\$\{args\.end_time\}/.test(panel),
  'the preview humanizes clock times — no raw HH:MM:SS reaches the manager or the employee (§N2)')

// ── No other Homebase file talks to Telnyx ───────────────────────────────────
// (A fresh grep at review time is the real check; this pins the two known spots.)
expect(!/sendTelnyxSms/.test(route) && !/sendTelnyxSms/.test(panel), 'no residual sendTelnyxSms callers')

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall s4-assignment-through-aegis checks passed')
