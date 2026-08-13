// F2 — a banned pair is always the hard 'never' rule; the soft 'avoid' option is
// removed from every manager write path. This locks the normaliser so no input
// (including a stray 'avoid') can produce anything other than 'never'.
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register \
//         --project tsconfig.scripts.json src/lib/conflicts/__tests__/severity.test.ts

import { normalizeConflictSeverity, CONFLICT_SEVERITY } from '../severity'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

expect(CONFLICT_SEVERITY === 'never', "the only supported severity is 'never'");
// A stray 'avoid' (or anything else) can never be written back — it collapses to 'never'.
for (const input of [undefined, null, 'never', 'avoid', 'soft', 'anything', '']) {
  const out: string = normalizeConflictSeverity(input as string | null | undefined)
  expect(out === 'never', `normalize(${JSON.stringify(input)}) → 'never'`);
}

if (failures > 0) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1) }
console.log('\nAll conflict-severity checks passed.')
