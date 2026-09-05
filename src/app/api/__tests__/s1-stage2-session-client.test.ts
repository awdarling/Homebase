// S-1 stage 2 — 2026-09-05.
// Run:  npx tsx src/app/api/__tests__/s1-stage2-session-client.test.ts
//
// S-1 stage 1 (SECURITY_AUDIT_MASTER §1, §11) moved five low-risk routes onto
// the session-authenticated client, but left revoke-user and update-user-role
// on the service-role key — RLS's only UPDATE policy on `users` was
// "id = auth.uid()" (a caller updating their OWN row), so moving either route
// would have made it fail outright, not add a backstop (DRIFT §E18).
//
// Stage 2 closes that gap. A new RLS policy, "Owners and quria can update
// lower-ranked users", lets an owner or quria login UPDATE a DIFFERENT
// user's row — but only one that ranks strictly below them, and (for an
// owner) only within their own company, mirroring the ROLE_RANK check both
// routes already had in application code. Alexander ran the policy SQL
// directly against the live database on 2026-09-05 (verified live via
// pg_policies before this branch was built) — there is no migration file
// for it yet; that's a follow-up, not required for this stage to work.
//
// What this file proves (source-pattern, same convention as stage 1): both
// routes (a) no longer import or construct a service-role Supabase client at
// all, (b) perform their actual database work — including the target-row
// lookup — on the session-authenticated client instead, (c) still have
// every hand-written rank/company check they had before, unweakened, and
// (d) surface a matched-row-count failure (contract rule F7) instead of
// silently reporting success if the write matches zero rows.
//
// What this file does NOT and CANNOT prove: that the RLS policy actually
// blocks a cross-company or cross-rank attempt end to end. That needs a real
// authenticated request against the live database, which this suite has no
// write credentials for (same limitation stage 1's test file notes).

import { readFileSync } from 'fs'
import { resolve } from 'path'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const root = resolve(__dirname, '../../../..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const revokeUser = read('src/app/api/revoke-user/route.ts')
const updateUserRole = read('src/app/api/update-user-role/route.ts')

// ── Neither route constructs or imports a service-role client any more ────
for (const [name, src] of [
  ['revoke-user', revokeUser],
  ['update-user-role', updateUserRole],
] as const) {
  expect(!/SUPABASE_SERVICE_ROLE_KEY/.test(src), `${name}: no service-role key reference remains`)
  expect(!/from '@supabase\/supabase-js'/.test(src), `${name}: no longer imports the raw supabase-js client constructor`)
  expect(/createClient as createServerSupabase.*'@\/lib\/supabase\/server'/.test(src), `${name}: imports the session-authenticated server client helper`)
}

// ── revoke-user: target lookup + write + activity_log all run on ssr ──────
{
  expect(/ssr\s*\n?\s*\.from\('users'\)\s*\n?\s*\.select\('id, role, company_id'\)/.test(revokeUser),
    'revoke-user: the target-row lookup runs on the session client (ssr), not a service-role client')
  expect(/ssr\s*\n?\s*\.from\('users'\)\s*\n?\s*\.update\(\{ access_revoked_at:/.test(revokeUser),
    'revoke-user: the access_revoked_at write runs on the session client (ssr)')
  expect(/ssr\.from\('activity_log'\)\.insert\(/.test(revokeUser),
    'revoke-user: the activity_log insert runs on the session client (ssr)')
  expect(/\(ROLE_RANK\[target\.role\] \?\? 0\) >= \(ROLE_RANK\[caller\.role\] \?\? 0\)/.test(revokeUser),
    'revoke-user: the hand-written rank check is still present')
  expect(/caller\.role === 'owner' && target\.company_id !== caller\.company_id/.test(revokeUser),
    'revoke-user: the hand-written company-binding check is still present')
  expect(/updErr \|\| !updated/.test(revokeUser),
    'revoke-user: a matched-row-count failure is treated as an error (F7), not silent success')
}

// ── update-user-role: target lookup + write + activity_log all run on ssr ──
{
  expect(/ssr\s*\n?\s*\.from\('users'\)\s*\n?\s*\.select\('id, name, role, company_id'\)/.test(updateUserRole),
    'update-user-role: the target-row lookup runs on the session client (ssr), not a service-role client')
  expect(/ssr\s*\n?\s*\.from\('users'\)\s*\n?\s*\.update\(\{ role \}\)/.test(updateUserRole),
    'update-user-role: the role write runs on the session client (ssr)')
  expect(/ssr\.from\('activity_log'\)\.insert\(/.test(updateUserRole),
    'update-user-role: the activity_log insert runs on the session client (ssr)')
  expect(/\(ROLE_RANK\[target\.role\] \?\? 0\) >= callerRank \|\| ROLE_RANK\[role\] >= callerRank/.test(updateUserRole),
    'update-user-role: the hand-written rank check (both current AND new role) is still present')
  expect(/caller\.role === 'owner' && target\.company_id !== caller\.company_id/.test(updateUserRole),
    'update-user-role: the hand-written company-binding check is still present')
  expect(/updErr \|\| !updated/.test(updateUserRole),
    'update-user-role: a matched-row-count failure is treated as an error (F7), not silent success')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll S-1 stage-2 checks passed.')
}
