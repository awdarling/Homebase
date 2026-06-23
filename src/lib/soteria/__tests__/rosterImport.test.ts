// Runtime test harness for the richer roster importer (pillar 2 follow-on).
// Mirrors the SOTERIA-CHECK-1 pattern: a plain Node script, run via ts-node.
//
// Run:  npx ts-node --transpile-only --project tsconfig.scripts.json \
//         src/lib/soteria/__tests__/rosterImport.test.ts

import { planRosterImport, type RosterContext } from '../rosterImport'

let failures = 0
function expect(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures++
  }
}

const ctx = (over: Partial<RosterContext> = {}): RosterContext => ({
  existingEmployeeNames: [],
  knownRoleNames: ['Lifeguard', 'Manager'],
  ...over,
})

// ── Role canonicalization (case-insensitive → defined spelling) ──────────────
{
  const plan = planRosterImport([{ name: 'Ann', primary_role: 'lifeguard' }], ctx())
  expect(plan.toInsert[0].primary_role === 'Lifeguard', 'role spelling is canonicalized to the defined role')
  expect(plan.toInsert[0].qualified_roles.length === 1 && plan.toInsert[0].qualified_roles[0] === 'Lifeguard', 'qualified_roles defaults to the canonical primary role')
  expect(plan.warnings.length === 0, 'an exact (case-insensitive) role match produces no warning')
}

// ── Unknown role: kept as written, warned (only when roles are defined) ──────
{
  const plan = planRosterImport([{ name: 'Bo', primary_role: 'Bouncer' }], ctx())
  expect(plan.toInsert[0].primary_role === 'Bouncer', 'an unrecognized role is kept as written')
  expect(plan.warnings.some(w => w.includes('Bouncer') && w.includes("doesn't match")), 'an unrecognized role is flagged when roles are defined')
}
{
  const plan = planRosterImport([{ name: 'Cy', primary_role: 'Anything' }], ctx({ knownRoleNames: [] }))
  expect(plan.warnings.length === 0, 'no role-mismatch warnings during onboarding when no roles are defined yet')
}

// ── De-dupe against existing team and within the batch ───────────────────────
{
  const plan = planRosterImport(
    [{ name: 'Dana', primary_role: 'Lifeguard' }, { name: 'dana', primary_role: 'Lifeguard' }, { name: 'Eve', primary_role: 'Manager' }],
    ctx({ existingEmployeeNames: ['Eve'] }),
  )
  expect(plan.toInsert.length === 1 && plan.toInsert[0].name === 'Dana', 'only the new, unique person is inserted')
  expect(plan.skipped === 2, 'both the in-batch duplicate and the already-on-team person are skipped')
  expect(plan.warnings.some(w => w.includes('Eve') && w.includes('already on the team')), 'existing team member is reported')
  expect(plan.warnings.some(w => w.toLowerCase().includes('twice')), 'in-batch duplicate is reported')
}

// ── Missing name is skipped ──────────────────────────────────────────────────
{
  const plan = planRosterImport([{ primary_role: 'Lifeguard' }, { name: '  ', primary_role: 'Manager' }], ctx())
  expect(plan.toInsert.length === 0 && plan.skipped === 2, 'rows without a usable name are skipped')
}

// ── Veteran coercion from messy values ───────────────────────────────────────
{
  const plan = planRosterImport([
    { name: 'A', primary_role: 'Lifeguard', is_veteran: 'Yes' },
    { name: 'B', primary_role: 'Lifeguard', is_veteran: 1 },
    { name: 'C', primary_role: 'Lifeguard', is_veteran: 'no' },
    { name: 'D', primary_role: 'Lifeguard' },
  ], ctx())
  expect(plan.toInsert[0].is_veteran === true, "'Yes' coerces to veteran true")
  expect(plan.toInsert[1].is_veteran === true, 'numeric 1 coerces to veteran true')
  expect(plan.toInsert[2].is_veteran === false, "'no' coerces to veteran false")
  expect(plan.toInsert[3].is_veteran === false, 'missing veteran flag defaults to false')
}

// ── Hours validation ─────────────────────────────────────────────────────────
{
  const plan = planRosterImport([
    { name: 'A', primary_role: 'Lifeguard', max_weekly_hours: 25 },
    { name: 'B', primary_role: 'Lifeguard', max_weekly_hours: -5 },
    { name: 'C', primary_role: 'Lifeguard' },
  ], ctx())
  expect(plan.toInsert[0].max_weekly_hours === 25, 'a valid hours value is kept')
  expect(plan.toInsert[1].max_weekly_hours === 40 && plan.warnings.some(w => w.includes('invalid weekly-hours')), 'an invalid hours value defaults to 40 with a warning')
  expect(plan.toInsert[2].max_weekly_hours === 40, 'missing hours defaults to 40 silently')
}

// ── qualified_roles canonicalized + de-duped ─────────────────────────────────
{
  const plan = planRosterImport([{ name: 'A', primary_role: 'Manager', qualified_roles: ['manager', 'lifeguard', 'Lifeguard'] }], ctx())
  expect(JSON.stringify(plan.toInsert[0].qualified_roles) === JSON.stringify(['Manager', 'Lifeguard']), 'qualified roles are canonicalized and de-duplicated')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll rosterImport checks passed.')
}
