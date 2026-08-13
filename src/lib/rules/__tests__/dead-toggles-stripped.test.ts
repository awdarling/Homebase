// F1 — the two dead manager toggles (partial_shifts_allowed,
// conflict_resolution_preference) are settable-but-read-by-nothing (drift D11).
// Alexander's call (2026-08-13) = STRIP them from the manager surfaces. The Rules
// page renders one card per CATEGORY_LIST entry, so absence there = no manager
// surface. This guard fails if either is re-added to the UI without also wiring
// an engine reader.
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register \
//         --project tsconfig.scripts.json src/lib/rules/__tests__/dead-toggles-stripped.test.ts

import { CATEGORY_LIST } from '../categories'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const keys = CATEGORY_LIST.map((c) => c.key)

// The two dead toggles must NOT be manager-editable cards.
expect(!keys.includes('partial_shifts' as never), 'partial_shifts is not a Rules card');
expect(!keys.includes('conflict_resolution' as never), 'conflict_resolution is not a Rules card');

// The real, engine-backed rules must still be present (no over-removal).
for (const real of ['week_start_day', 'attribute_mix', 'veteran_preference', 'hours_fairness', 'doubles_policy']) {
  expect(keys.includes(real as never), `${real} is still a Rules card`);
}

if (failures > 0) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1) }
console.log('\nAll dead-toggle-strip checks passed.')
