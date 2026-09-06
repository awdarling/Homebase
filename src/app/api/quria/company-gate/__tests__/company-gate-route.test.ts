// OPS-1 — 2026-09-05.
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register --project tsconfig.scripts.json \
//         src/app/api/quria/company-gate/__tests__/company-gate-route.test.ts
//
// This route is where OPS-1's hardest requirement lives: "an owner must not
// be able to flip their own company back on." Like s1-stage1-session-client.test.ts,
// this is a SOURCE-PATTERN test, not a live invocation — Next.js route
// handlers and this repo's plain ts-node test scripts don't have a shared
// module-mocking mechanism to safely stub `@supabase/supabase-js` and
// `@/lib/supabase/server` for a real request/response round trip. What this
// proves: the authz check happens before any of the four actions can run,
// every write goes through the SERVICE-ROLE client (never the caller's own
// session client, which RLS + the migration-021 trigger would reject for a
// non-Quria caller anyway — this is the belt, that trigger is the
// suspenders), every action is logged to activity_log, and the two
// user-supplied fields are validated before being written. What this does
// NOT prove: that a live non-Quria request is actually rejected end to end
// — that needs a manual check against a real (sandbox) session, same
// caveat as s1-stage1-session-client.test.ts.

import { readFileSync } from 'fs'
import { resolve } from 'path'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const src = readFileSync(resolve(__dirname, '../route.ts'), 'utf8')

// ── The Quria-only authz check happens before any action runs ─────────────
{
  const authzIdx = src.indexOf("caller.role !== 'quria'")
  const switchIdx = src.indexOf('switch (action)')
  expect(authzIdx !== -1, 'the route checks caller.role !== \'quria\'')
  expect(switchIdx !== -1, 'the route has the action switch')
  expect(authzIdx !== -1 && switchIdx !== -1 && authzIdx < switchIdx,
    'the Quria-only check runs BEFORE any action can execute')
}

// ── Every write uses the service-role client, never the session client ────
{
  const actionBlockStart = src.indexOf('switch (action)')
  const actionBlock = src.slice(actionBlockStart)
  const updateCalls = actionBlock.match(/(\w+)\s*\n?\s*\.from\('companies'\)\s*\n?\s*\.update/g) ?? []
  expect(updateCalls.length === 4, `all four actions write companies (found ${updateCalls.length})`)
  expect(updateCalls.every(c => c.startsWith('adminSupabase')),
    'every companies UPDATE in the action switch goes through adminSupabase (service role), never ssr')
  expect(!actionBlock.includes('ssr\n      .from(\'companies\')\n      .update') &&
    !actionBlock.includes("ssr.from('companies').update"),
    'the session-bound client never updates companies directly')
}

// ── Every action logs to activity_log ──────────────────────────────────────
{
  const actionBlockStart = src.indexOf('switch (action)')
  const actionBlock = src.slice(actionBlockStart)
  const logCalls = (actionBlock.match(/adminSupabase\.from\('activity_log'\)\.insert/g) ?? []).length
  expect(logCalls === 4, `all four actions log to activity_log (found ${logCalls})`)
  expect(actionBlock.includes("actor: 'quria_admin'"), 'logged entries are attributed to actor quria_admin')
  expect(actionBlock.includes('actor_name: caller.name'), 'logged entries name WHICH Quria staff member acted')
}

// ── OPS-1 explicit direction logging ("who, when, which direction") ───────
{
  expect(src.includes("direction: 'off'"), 'deactivate logs direction: off')
  expect(src.includes("direction: 'on'"), 'reactivate logs direction: on')
}

// ── Input validation before any write ──────────────────────────────────────
{
  expect(src.includes('VALID_BILLING_MODELS'), 'billing_model is validated against an explicit allow-list')
  expect(src.includes('/^\\d{4}-\\d{2}-\\d{2}$/'), 'service_through is validated as a YYYY-MM-DD date (or null)')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll company-gate route checks passed.')
}
