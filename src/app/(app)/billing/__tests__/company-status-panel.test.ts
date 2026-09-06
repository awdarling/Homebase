// OPS-1 Quria admin panel UI — 2026-09-06.
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register --project tsconfig.scripts.json \
//         src/app/(app)/billing/__tests__/company-status-panel.test.ts
//
// Source-pattern test (same convention as s1-stage1-session-client.test.ts):
// this repo's plain ts-node scripts have no module-mocking mechanism for
// @supabase/supabase-js or the Next.js client hooks the billing page uses,
// so this asserts structural/textual invariants on the page's source rather
// than rendering it.
//
// What this proves: the new "Company Status" panel (kill switch, service-
// through date, billing model) is Quria-gated, calls the one Quria-only API
// route for every write, never writes the three protected columns
// (deactivated_at, service_through, billing_model) directly via the session
// client the way the pre-existing "Quria Admin" panel above it does for
// price/notes/email, and guards the destructive action with a confirmation.

import { readFileSync } from 'fs'
import { resolve } from 'path'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const src = readFileSync(resolve(__dirname, '../page.tsx'), 'utf8')

expect(src.includes("'Company Status'") || src.includes('Company Status'),
  'the billing page has a Company Status section')

expect((src.match(/fetch\('\/api\/quria\/company-gate'/g) || []).length === 1,
  'all four gate actions go through ONE call site to /api/quria/company-gate (callCompanyGate), not one fetch per action')

for (const action of ['deactivate', 'reactivate', 'set_service_through', 'set_billing_model']) {
  expect(src.includes(`action: '${action}'`), `the ${action} action is sent to the gate route`)
}

expect(src.includes('window.confirm'),
  'deactivating a company requires an explicit confirmation before the request fires')

// The pre-existing "Quria Admin" panel intentionally still writes
// subscription_price/subscription_notes/billing_email directly via the
// session client (handleSaveAdmin) — that's out of scope for OPS-1/BILL-1.
// What must NOT happen is any *new* direct write to the three
// gate-protected columns; those must only ever leave the page via
// callCompanyGate -> /api/quria/company-gate.
const directCompanyWrites = src.match(/supabase\.from\('companies'\)\.update\(\{[^}]*\}/g) || []
for (const write of directCompanyWrites) {
  for (const protectedCol of ['deactivated_at', 'service_through', 'billing_model']) {
    expect(!write.includes(protectedCol),
      `no direct session-client write to companies sets ${protectedCol} (found in: ${write.slice(0, 60)}...)`)
  }
}

const companyStatusIdx = src.indexOf('Company Status')
expect(src.includes('const { isQuria }') && companyStatusIdx > src.indexOf('const { isQuria }'),
  'the Company Status section is declared after isQuria is available, so it can be gated by it')

// The section itself must sit inside an isQuria-gated block, same pattern
// as the existing Quria Admin panel just above it. Inline styles push the
// guard well before the label text, so use a generous window.
const precedingSlice = src.slice(Math.max(0, companyStatusIdx - 900), companyStatusIdx)
expect(precedingSlice.includes('isQuria &&'),
  'the Company Status panel is wrapped in an isQuria && (...) guard, not shown to owners/managers')

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll company-status-panel checks passed.')
}
