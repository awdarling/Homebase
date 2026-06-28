// Runtime test for the coverage-flag dismiss helpers (#9.5).
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register --project tsconfig.scripts.json \
//         src/lib/schedule/__tests__/coverageFlagDismiss.test.ts

import { coverageFlagKey, filterDismissed } from '../coverageFlagDismiss'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const flag = (date: string, start: string, end: string, sex: string) => ({
  type: 'unsatisfied_sex_coverage',
  date,
  metadata: { time_window: { start, end }, missing_sex: sex },
});

// ── Stable key ───────────────────────────────────────────────────────────────
{
  const a = flag('2026-05-04', '13:00', '17:00', 'female')
  const b = flag('2026-05-04', '13:00', '17:00', 'female')
  const c = flag('2026-05-05', '13:00', '17:00', 'female')
  expect(coverageFlagKey(a) === coverageFlagKey(b), 'identical flags produce the same key')
  expect(coverageFlagKey(a) !== coverageFlagKey(c), 'a different date produces a different key')
  expect(coverageFlagKey(a) === 'unsatisfied_sex_coverage|2026-05-04|13:00|17:00|female', 'key has the expected shape')
}

// ── Missing metadata is tolerated ────────────────────────────────────────────
{
  const bare = { type: 'unsatisfied_sex_coverage', date: '2026-05-04' }
  expect(typeof coverageFlagKey(bare) === 'string', 'a flag with no metadata still yields a key (no crash)')
}

// ── Filtering hides exactly the dismissed flags ──────────────────────────────
{
  const a = flag('2026-05-04', '13:00', '17:00', 'female')
  const b = flag('2026-05-05', '09:00', '13:00', 'male')
  const dismissed = new Set([coverageFlagKey(a)])
  const visible = filterDismissed([a, b], dismissed)
  expect(visible.length === 1 && coverageFlagKey(visible[0]) === coverageFlagKey(b), 'a dismissed flag is hidden, others remain')
}
{
  const a = flag('2026-05-04', '13:00', '17:00', 'female')
  expect(filterDismissed([a], new Set()).length === 1, 'with nothing dismissed, all flags show')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll coverageFlagDismiss checks passed.')
}
