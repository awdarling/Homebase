// Access page role change — 2026-08-24.
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register \
//         --project tsconfig.scripts.json src/lib/__tests__/access-role-change.test.ts
//
// Defect: changing a login's role from the Access page did nothing. The page
// wrote users.role from the browser; the only UPDATE policy on users is
// "your own row", so the write matched zero rows and no error was raised.
// Fix: a server route with the same ladder as create-user / revoke-user.

import { readFileSync } from 'fs'
import { resolve } from 'path'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}
const root = resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const page = read('src/app/(app)/access/page.tsx')
const route = read('src/app/api/update-user-role/route.ts')

expect(!/from\('users'\)\.update\(\{ role: newRole \}\)/.test(page), 'the page no longer writes users.role from the browser')
expect(/fetch\('\/api\/update-user-role'/.test(page), 'the page calls the server route')
expect(/setRoleError\(data\.error/.test(page), 'a failed change is shown to the person, not swallowed')

expect(/ssr\.auth\.getUser\(\)/.test(route), 'route verifies the caller from their own session')
expect(/ROLE_RANK: Record<string, number> = \{ quria: 3, owner: 2, manager: 1 \}/.test(route), 'same privilege ladder as create-user / revoke-user')
expect(/ROLE_RANK\[target\.role\] \?\? 0\) >= callerRank \|\| ROLE_RANK\[role\] >= callerRank/.test(route),
  'target\'s current role AND new role must both rank strictly below the caller')
expect(/caller\.role === 'owner' && target\.company_id !== caller\.company_id/.test(route), 'an owner stays inside their own company')
expect(/user_id === user\.id/.test(route), 'nobody changes their own role here')
expect(/action: 'homebase_role_changed'/.test(route), 'the change is written to the activity log')
expect(!/error: updErr\.message/.test(route), 'database error text is not returned to the browser')

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall access-role-change checks passed')
