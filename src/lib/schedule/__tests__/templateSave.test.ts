// Runtime test harness for the template save-result helper (TEMPLATE-EDIT-2).
// Mirrors the SOTERIA-CHECK-1 pattern: a plain Node script, run via ts-node.
//
// Run:  npx ts-node --transpile-only --project tsconfig.scripts.json \
//         src/lib/schedule/__tests__/templateSave.test.ts

import { toSaveTemplateResult } from '../templateSave'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures++
  }
}

// ── Success: data and no error → ok with the saved row ───────────────────────
{
  const row = { id: 't1', company_id: 'c1' }
  const r = toSaveTemplateResult({ data: row, error: null })
  expect(r.ok === true, 'a successful upsert returns ok')
  expect(r.ok === true && (r.template as { id: string }).id === 't1', 'the saved template row is returned')
}

// ── RLS denial (42501) gets a permission-specific message ────────────────────
{
  const r = toSaveTemplateResult({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } })
  expect(r.ok === false, 'an RLS denial is a failure (was silently swallowed before)')
  expect(r.ok === false && r.error.toLowerCase().includes('permission'), 'RLS denial surfaces a permission message, not raw SQL')
}

// ── Other DB error surfaces its message ──────────────────────────────────────
{
  const r = toSaveTemplateResult({ data: null, error: { code: '23505', message: 'duplicate key value' } })
  expect(r.ok === false && r.error.includes('duplicate key value'), 'a non-RLS error surfaces its message')
}
{
  const r = toSaveTemplateResult({ data: null, error: { code: 'XX000' } })
  expect(r.ok === false && r.error.length > 0, 'an error with no message still yields a non-empty failure message')
}

// ── No error but no row → treated as a failure, not a false success ──────────
{
  const r = toSaveTemplateResult({ data: null, error: null })
  expect(r.ok === false, 'no error but no returned row is a failure, not a silent pass')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll templateSave checks passed.')
}
