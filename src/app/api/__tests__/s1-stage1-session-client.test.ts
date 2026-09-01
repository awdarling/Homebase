// S-1 stage 1 — 2026-09-01.
// Run:  npx tsx src/app/api/__tests__/s1-stage1-session-client.test.ts
//
// S-1 (SECURITY_AUDIT_MASTER §1): every Homebase API route used the Supabase
// service-role key, which bypasses Row Level Security entirely — so the only
// thing keeping one company's data away from another company's login was
// whatever hand-written check each route happened to remember to write.
// Stage 1 moves the first five lowest-risk routes onto a client authenticated
// as the CALLER'S OWN session (anon key + cookie session — the same
// mechanism every Homebase page already uses) so the database's own
// company-scoped RLS policies start applying to these routes too, as a
// second, independent layer UNDER the existing hand-written checks — not a
// replacement for them.
//
// What this file proves (source-pattern, same convention as the rest of the
// suite): each of the five routes (a) no longer imports or constructs a
// service-role Supabase client at all, (b) performs its actual database
// work on the session-authenticated client instead, and (c) still has every
// hand-written company/role check it had before — unweakened, unremoved.
//
// What this file does NOT and CANNOT prove: that RLS actually blocks a
// cross-company attempt end to end. That requires a real authenticated
// request reaching the live database — this suite has no write credentials
// there and none of Homebase's other 38 scripts do either. See the delivery
// doc for the one manual check this needs.
//
// Routes intentionally NOT moved this stage (checked and disqualified, not
// merely skipped): revoke-user and update-user-role both need to UPDATE a
// DIFFERENT user's row in `users`. The only UPDATE policy in RLS ("Users can
// update own profile") allows `id = auth.uid()` — a caller acting on their
// OWN row — only. Moving either route to a session client would make it
// fail outright (RLS denies the row), not add a backstop. Left in place.

import { readFileSync } from 'fs'
import { resolve } from 'path'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const root = resolve(__dirname, '../../../..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const scheduleOverrideLog = read('src/app/api/schedule-override-log/route.ts')
const notifyDayClosure = read('src/app/api/notify-day-closure/route.ts')
const notifyAssignment = read('src/app/api/notify-assignment/route.ts')
const timeOffRecompute = read('src/app/api/time-off/recompute/route.ts')
const swapDecision = read('src/app/api/swap-decision/route.ts')
const decideSwap = read('src/lib/swaps/decide.ts')

// ── No route below constructs or imports a service-role client any more ────
for (const [name, src] of [
  ['schedule-override-log', scheduleOverrideLog],
  ['notify-day-closure', notifyDayClosure],
  ['notify-assignment', notifyAssignment],
  ['time-off/recompute', timeOffRecompute],
  ['swap-decision', swapDecision],
] as const) {
  expect(!/SUPABASE_SERVICE_ROLE_KEY/.test(src), `${name}: no service-role key reference remains`)
  expect(!/from '@supabase\/supabase-js'/.test(src), `${name}: no longer imports the raw supabase-js client constructor`)
  expect(/createClient as createServerSupabase.*'@\/lib\/supabase\/server'/.test(src), `${name}: imports the session-authenticated server client helper`)
}

// ── schedule-override-log: insert runs on ssr; company check unchanged ─────
{
  expect(/ssr\.from\('activity_log'\)\.insert\(/.test(scheduleOverrideLog),
    'schedule-override-log: the activity_log insert runs on the session client (ssr), not a service-role client')
  expect(/\.company_id !== body\.company_id/.test(scheduleOverrideLog),
    'schedule-override-log: the hand-written company-binding check is still present')
  expect(/A reason is required to override\./.test(scheduleOverrideLog),
    'schedule-override-log: the reason-required check is still present')
}

// ── notify-day-closure: insert runs on ssr; quria-or-own-company gate intact ─
{
  expect(/ssr\.from\('activity_log'\)\.insert\(/.test(notifyDayClosure),
    'notify-day-closure: the activity_log insert runs on the session client (ssr), not a service-role client')
  expect(/caller\.role !== 'quria' && caller\.company_id !== companyId/.test(notifyDayClosure),
    'notify-day-closure: the hand-written quria-or-own-company check is still present')
}

// ── notify-assignment: insert runs on ssr; company gate intact ─────────────
{
  expect(/ssr\.from\('activity_log'\)\.insert\(/.test(notifyAssignment),
    'notify-assignment: the delivery-failure activity_log insert runs on the session client (ssr), not a service-role client')
  expect(/userRecord\.company_id !== company_id/.test(notifyAssignment),
    'notify-assignment: the hand-written company-binding check is still present')
}

// ── time-off/recompute: lookup runs on ssr; company gate intact ────────────
{
  expect(/ssr\s*\n?\s*\.from\('time_off_requests'\)/.test(timeOffRecompute),
    'time-off/recompute: the time_off_requests lookup runs on the session client (ssr), not a service-role client')
  expect(/company_id: string \}\)\.company_id !== actor\.company_id/.test(timeOffRecompute),
    'time-off/recompute: the hand-written company-binding check is still present')
}

// ── swap-decision: lookup + decideSwapRequest both run on ssr; gate intact ─
{
  expect(/ssr\s*\n?\s*\.from\('swap_requests'\)/.test(swapDecision),
    'swap-decision: the swap_requests lookup runs on the session client (ssr), not a service-role client')
  expect(/supabase: ssr,/.test(swapDecision),
    'swap-decision: decideSwapRequest is called with the session client (ssr), not a service-role client')
  expect(/reqData\.company_id !== actor\.company_id/.test(swapDecision),
    'swap-decision: the hand-written company-binding check is still present')
  expect(!/Service-role client — the activity_log write bypasses RLS\./.test(decideSwap),
    'lib/swaps/decide.ts: the stale "service-role client" doc comment was updated to reflect the caller now supplies either client')
}

// ── Disqualified routes untouched: revoke-user and update-user-role still
// use the service-role key for their cross-user writes (RLS's own UPDATE
// policy on `users` only allows a caller to update their OWN row — moving
// either of these would break them, not secure them).
{
  const revokeUser = read('src/app/api/revoke-user/route.ts')
  const updateUserRole = read('src/app/api/update-user-role/route.ts')
  expect(/SUPABASE_SERVICE_ROLE_KEY/.test(revokeUser),
    'revoke-user: still on the service-role key (disqualified — RLS has no cross-user UPDATE policy on users)')
  expect(/SUPABASE_SERVICE_ROLE_KEY/.test(updateUserRole),
    'update-user-role: still on the service-role key (disqualified — same reason)')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll S-1 stage-1 checks passed.')
}
