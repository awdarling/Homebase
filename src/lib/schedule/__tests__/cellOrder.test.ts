// Runtime test for the cell ordering helper (#9).
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register --project tsconfig.scripts.json \
//         src/lib/schedule/__tests__/cellOrder.test.ts

import { sortByRoleThenName } from '../cellOrder'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const p = (employee_name: string, role: string) => ({ employee_name, role });

// ── Groups by role, then alphabetises names within a role ────────────────────
{
  const out = sortByRoleThenName([
    p('Zoe', 'Lifeguard'),
    p('Ann', 'Lifeguard'),
    p('Bob', 'Headguard'),
  ])
  expect(out.map(x => x.employee_name).join(',') === 'Bob,Ann,Zoe',
    'Headguard first (role), then Lifeguards alphabetised by name')
}

// ── Same role → pure name order ──────────────────────────────────────────────
{
  const out = sortByRoleThenName([p('Sam', 'Lifeguard'), p('Amy', 'Lifeguard')])
  expect(out.map(x => x.employee_name).join(',') === 'Amy,Sam', 'within one role it is name order')
}

// ── Missing role/name tolerated (no throw, deterministic) ─────────────────────
{
  const out = sortByRoleThenName([{ employee_name: 'Z' }, { role: 'Manager', employee_name: 'A' }])
  expect(out.length === 2, 'entries with missing fields still sort without crashing')
}

// ── Does not mutate the input array ──────────────────────────────────────────
{
  const input = [p('Zoe', 'Lifeguard'), p('Bob', 'Headguard')]
  const out = sortByRoleThenName(input)
  expect(input[0].employee_name === 'Zoe' && out[0].employee_name === 'Bob', 'input is left unmutated')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll cellOrder checks passed.')
}
