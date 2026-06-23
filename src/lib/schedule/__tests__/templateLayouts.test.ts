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

// ── Only the implemented layout is marked supported ──────────────────────────
expect(isLayoutSupported('shift-rows-day-columns') === true, 'shift-rows layout is supported (it is implemented)')
expect(isLayoutSupported('employee-rows-day-columns') === false, 'employee-rows layout is not supported yet')
expect(isLayoutSupported('role-rows-day-columns') === false, 'role-rows layout is not supported yet')

// ── Unknown / empty values are never "supported" ─────────────────────────────
expect(isLayoutSupported('nonsense') === false, 'an unknown layout value is not supported')
expect(isLayoutSupported(null) === false, 'null is not supported')
expect(isLayoutSupported(undefined) === false, 'undefined is not supported')

// ── Exactly one supported layout today, and the meta covers all three ────────
expect(LAYOUT_META.length === 3, 'all three layouts are listed in the picker meta')
expect(LAYOUT_META.filter(m => m.supported).length === 1, 'exactly one layout is currently buildable')

// ── Labels resolve for known values, with a safe fallback ────────────────────
expect(layoutLabel('shift-rows-day-columns') === 'Shifts × Days', 'a known layout resolves to its friendly label')
expect(layoutLabel('nonsense') === 'this layout', 'an unknown layout falls back to a generic label')

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll templateLayouts checks passed.')
}
