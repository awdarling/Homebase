// Manager Contact UI guard — 2026-08-18.
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register \
//         --project tsconfig.scripts.json src/lib/__tests__/manager-contact-ui.test.ts
//
// The defect: Aegis could not text a manager, because `users` has no phone and
// no link to a person. The fix is users.employee_id (migration 025) plus a place
// in Homebase to set it. Without the UI the migration is unusable, so this file
// pins the UI's contract.

import { readFileSync } from 'fs'
import { resolve } from 'path'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const root = resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const page = read('src/app/(app)/access/page.tsx')
const types = read('src/lib/types.ts')

// ── The link can be set, and only where it makes sense ───────────────────────
expect(/ManagerContactSection/.test(page), 'the Manager Contact section exists and is mounted')
expect(/update\(\{ employee_id: employeeId \}\)/.test(page), 'linking writes users.employee_id')
expect(/u\.role === 'manager' \|\| u\.role === 'owner'/.test(page),
  'only manager and owner logins are listed — a quria platform admin is not a club employee')

// ── An unlinked login is visible, not silent ─────────────────────────────────
expect(/not linked to a person yet/i.test(page), 'unlinked logins raise a visible banner')
expect(/with no warning/i.test(page), 'the banner explains that the email fallback fails silently')
expect(/Not linked — email only/.test(page), 'each unlinked row says what that costs')
expect(/Linked, but no phone on file/.test(page), 'a linked person with no phone is called out separately')
expect(/Texts go to \$\{phone\}/.test(page), 'a reachable manager shows the number texts will go to')

// ── One person, one login ────────────────────────────────────────────────────
expect(/takenBy/.test(page) && /already \$\{claimedBy\}/.test(page),
  'a person already claimed by another login is shown as taken and cannot be double-assigned')

// ── Scheduling exclusion is offered, and explained as distinct from active ───
expect(/schedulable: value/.test(page), 'the schedulable flag can be toggled')
expect(/person\.schedulable !== false/.test(page),
  'an unset schedulable reads as schedulable, so a pre-migration roster is unaffected')
expect(/Different from marking them/.test(page),
  'the UI explains that this is NOT the same as marking someone inactive')

// ── Notification preferences, with the right defaults ────────────────────────
for (const key of ['approvals', 'trades', 'schedule_posts', 'reports']) {
  expect(new RegExp(`key: '${key}'`).test(page), `the '${key}' category is offered`)
}
expect(/typeof explicit === 'boolean' \? explicit : !isOwner/.test(page),
  'an owner defaults to OFF and everyone else defaults to ON, matching the Aegis resolver')
expect(/Owners hear nothing by default/.test(page),
  'the UI tells an owner they can switch a category on to try it')
expect(/nobody else to send it to/.test(page),
  'the UI states the safety valve — an action item never reaches nobody')

// ── Types match the migration ────────────────────────────────────────────────
expect(/employee_id\?: string \| null/.test(types), 'User.employee_id is typed')
expect(/schedulable\?: boolean/.test(types), 'Employee.schedulable is typed')
expect(/notification_prefs\?: NotificationPrefs \| null/.test(types), 'Employee.notification_prefs is typed')
expect(/export type NotifyCategory = 'approvals' \| 'trades' \| 'schedule_posts' \| 'reports'/.test(types),
  'the four categories match the Aegis resolver exactly')
expect(/has no phone by design/.test(types),
  'the type documents WHY there is no users.phone — one human, one phone number')

if (failures > 0) { console.error(`\n${failures} manager-contact check(s) FAILED.`); process.exit(1) }
console.log('\nAll manager-contact checks passed.')
