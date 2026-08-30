// N-7 (+ sweep) and N-8 remainder — 2026-08-30.
// Run:  npx tsx src/app/api/soteria/execute/__tests__/n7-n8-remainders.test.ts
//
// N-7: batch_create_time_off never verified employee_id belonged to the
// caller's company — the same shape as N-10 (notify-assignment, closed
// 2026-08-29). The kickoff asked to sweep soteria/execute for any OTHER
// action with the same hole; the sweep found two more: add_conflict (which
// only looked up the employee pair AFTER the insert, for display naming —
// the foreign id still landed in the row) and set_custom_availability (no
// employees-table check at all, unlike update_availability's existing
// pattern). All three now bind before writing.
//
// N-8 remainder: raw err.message reaching the browser at monitoring-inbox
// (x5), soteria/memory (x2), schedule/build, and soteria/execute (x2) — the
// exact inventory named in SECURITY_AUDIT_MASTER §8. Detail now goes to
// console.error / activity_log; the caller gets a generic message.

import { readFileSync } from 'fs'
import { resolve } from 'path'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const root = resolve(__dirname, '../../../../../..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const execute = read('src/app/api/soteria/execute/route.ts')
const monitoringInbox = read('src/app/api/monitoring-inbox/route.ts')
const soteriaMemory = read('src/app/api/soteria/memory/route.ts')
const scheduleBuild = read('src/app/api/schedule/build/route.ts')

// ── N-7: batch_create_time_off binds every employee_id before writing ───────
{
  const start = execute.indexOf("case 'batch_create_time_off'")
  const end = execute.indexOf("case 'update_availability'")
  const block = execute.slice(start, end)
  expect(/\.from\('employees'\)/.test(block) && /\.eq\('company_id', companyId\)/.test(block) && /\.in\('id', requestedIds\)/.test(block),
    'batch_create_time_off looks up every requested employee_id bound to the company')
  expect(/wasn't found in this company/.test(block),
    'an unowned employee_id refuses the whole batch with a plain message, rather than silently dropping it')
  // The ownership check must run BEFORE the insert, not after.
  const checkIdx = block.indexOf('ownedEmployees')
  const insertIdx = block.indexOf(".from('time_off_requests').insert(rows)")
  expect(checkIdx > -1 && insertIdx > -1 && checkIdx < insertIdx,
    'the ownership check runs before the insert, not after (a foreign id never reaches the table)')
}

// ── N-7 sweep finding #2: set_custom_availability ────────────────────────────
{
  const start = execute.indexOf("case 'set_custom_availability'")
  const end = execute.indexOf("case 'trigger_schedule_build'")
  const block = execute.slice(start, end)
  const checkIdx = block.indexOf('customAvailEmp')
  const writeIdx = block.indexOf("from('custom_availability')")
  expect(/\.from\('employees'\)/.test(block) && /\.eq\('id', d\.employee_id\)/.test(block) && /\.eq\('company_id', companyId\)/.test(block),
    'set_custom_availability now looks up the employee bound to the company (same pattern as update_availability)')
  expect(checkIdx > -1 && writeIdx > -1 && checkIdx < writeIdx,
    'the ownership check runs before any custom_availability write')
}

// ── N-7 sweep finding #3: add_conflict ───────────────────────────────────────
{
  const start = execute.indexOf("case 'add_conflict'")
  const end = execute.indexOf("case 'save_memory'")
  const block = execute.slice(start, end)
  const lookupIdx = block.indexOf("from('employees')")
  const insertIdx = block.indexOf("from('employee_conflicts').insert(")
  expect(lookupIdx > -1 && insertIdx > -1 && lookupIdx < insertIdx,
    'add_conflict looks up both employees BEFORE inserting the conflict row, not after (for display only, as before)')
  expect(/wasn't found in this company/.test(block),
    'a foreign employee_id in either slot refuses the write with a plain message')
}

// ── N-8 remainder: generic messages to the browser, real detail server-side ─
// Note: `error.message` still appears as an ARGUMENT to the dbError() helper
// (that's the "log the real detail" half) — the thing that must be gone is
// error.message landing directly in a NextResponse.json(...) payload.
expect(!/error:\s*error\.message/.test(monitoringInbox),
  'monitoring-inbox no longer echoes a raw Supabase error message to the browser')
expect(/console\.error\(`\[monitoring-inbox\]/.test(monitoringInbox),
  'monitoring-inbox logs the real error server-side instead')

expect(!/error:\s*error\.message/.test(soteriaMemory),
  'soteria/memory no longer echoes a raw Supabase error message to the browser')
expect(/console\.error\(`\[soteria\/memory\]/.test(soteriaMemory),
  'soteria/memory logs the real error server-side instead')

expect(!/error: `Could not reach the schedule builder: \$\{detail\}`/.test(scheduleBuild),
  'schedule/build no longer interpolates the raw Aegis error detail into the browser-facing message')
expect(/console\.error\('\[schedule\/build\]/.test(scheduleBuild),
  'schedule/build logs the real detail server-side instead')

expect(!/error: `I couldn't reach the scheduling engine: \$\{detail\}`/.test(execute),
  'soteria/execute (trigger_schedule_build) no longer echoes the raw Aegis detail to the browser')
expect(!/error: `I couldn't get that to Aegis, so nothing was sent to the team: \$\{detail\}`/.test(execute),
  'soteria/execute (distribute_schedule) no longer echoes the raw Aegis detail to the browser')
// The detail is still worth keeping — just in the audit trail, not the response.
expect(/summary: `Soteria's \$\{targetWeek\}-week schedule build failed: \$\{detail\}`/.test(execute),
  'the real detail still lands in activity_log for whoever debugs it')

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall n7-n8-remainders checks passed')
