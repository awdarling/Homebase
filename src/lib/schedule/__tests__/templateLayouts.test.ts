// Runtime test harness for the layout-support gate (TEMPLATE-EDIT-2).
// Mirrors the SOTERIA-CHECK-1 pattern: a plain Node script, run via ts-node.
//
// Run:  npx ts-node --transpile-only --project tsconfig.scripts.json \
//         src/lib/schedule/__tests__/templateLayouts.test.ts

import { LAYOUT_META, isLayoutSupported, layoutLabel } from '../templateLayouts'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures++
  }
}

// ── All three layouts are now implemented and supported ──────────────────────
expect(isLayoutSupported('shift-rows-day-columns') === true, 'shift-rows layout is supported')
expect(isLayoutSupported('employee-rows-day-columns') === true, 'employee-rows layout is now supported')
expect(isLayoutSupported('role-rows-day-columns') === true, 'role-rows layout is now supported')

// ── Unknown / empty values are never "supported" ─────────────────────────────
expect(isLayoutSupported('nonsense') === false, 'an unknown layout value is not supported')
expect(isLayoutSupported(null) === false, 'null is not supported')
expect(isLayoutSupported(undefined) === false, 'undefined is not supported')

// ── Exactly one supported layout today, and the meta covers all three ────────
expect(LAYOUT_META.length === 3, 'all three layouts are listed in the picker meta')
expect(LAYOUT_META.filter(m => m.supported).length === 3, 'all three layouts are now buildable')

// ── Labels resolve for known values, with a safe fallback ────────────────────
expect(layoutLabel('shift-rows-day-columns') === 'Shifts × Days', 'a known layout resolves to its friendly label')
expect(layoutLabel('nonsense') === 'this layout', 'an unknown layout falls back to a generic label')

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll templateLayouts checks passed.')
}
