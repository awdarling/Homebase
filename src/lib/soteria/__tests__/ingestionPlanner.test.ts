// Runtime test harness for the document-ingestion planner (pillar 2).
// Mirrors the SOTERIA-CHECK-1 pattern: a plain Node script with assertions,
// run via ts-node --transpile-only. The planner is pure, so no DB/network.
//
// Run:  npx ts-node --transpile-only --project tsconfig.scripts.json \
//         src/lib/soteria/__tests__/ingestionPlanner.test.ts

import { planConfiguration, summarizePlan, type ConfigBundle, type ExistingConfig, type PlannedStep } from '../ingestionPlanner'

let failures = 0
function expect(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures++
  }
}

const EMPTY: ExistingConfig = { roleNames: [], shiftTypeNames: [], wageRoleNames: [], policyKeys: [] }
const kinds = (steps: PlannedStep[]) => steps.map(s => s.kind)
const firstIndexOf = (steps: PlannedStep[], kind: string) => steps.findIndex(s => s.kind === kind)

// ── Ordering: roles before shift types before veteran rules ──────────────────
{
  const bundle: ConfigBundle = {
    veteran_rules: [{ shift_name: 'Morning', mode: 'all_veterans' }],
    shift_types: [{ name: 'Morning', start_time: '09:00', end_time: '17:00', days_active: [1, 2, 3], role_requirements: [{ accepted_roles: ['Lifeguard'], required_count: 2 }] }],
    roles: [{ name: 'Lifeguard', color: '#10b981' }],
  }
  const plan = planConfiguration(bundle, EMPTY)
  expect(firstIndexOf(plan.steps, 'role') < firstIndexOf(plan.steps, 'shift_type'), 'roles are planned before shift types')
  expect(firstIndexOf(plan.steps, 'shift_type') < firstIndexOf(plan.steps, 'veteran_rule'), 'shift types are planned before veteran rules')
  const st = plan.steps.find(s => s.kind === 'shift_type')
  expect(st?.kind === 'shift_type' && st.requirements.length === 1 && st.requirements[0].required_count === 2, 'role requirements nest under their shift type')
  expect(plan.warnings.length === 0, 'a clean, well-ordered bundle produces no warnings')
}

// ── De-duplication against existing config ───────────────────────────────────
{
  const bundle: ConfigBundle = {
    roles: [{ name: 'Lifeguard' }, { name: 'Manager' }],
    shift_types: [{ name: 'Morning', start_time: '09:00', end_time: '17:00', days_active: [1] }],
  }
  const existing: ExistingConfig = { roleNames: ['lifeguard'], shiftTypeNames: ['Morning'], wageRoleNames: [], policyKeys: [] }
  const plan = planConfiguration(bundle, existing)
  expect(plan.counts.roles === 1, 'an already-existing role (case-insensitive) is skipped')
  expect(plan.counts.shift_types === 0, 'an already-existing shift type is skipped')
  expect(plan.warnings.some(w => w.includes('Lifeguard') && w.includes('already exists')), 'duplicate role is reported in warnings')
}

// ── Duplicate within the same bundle ─────────────────────────────────────────
{
  const plan = planConfiguration({ roles: [{ name: 'Cook' }, { name: 'cook' }] }, EMPTY)
  expect(plan.counts.roles === 1, 'a role listed twice in one bundle is added once')
  expect(plan.warnings.some(w => w.toLowerCase().includes('twice')), 'the in-bundle duplicate is flagged')
}

// ── Wage rate requires a known role ──────────────────────────────────────────
{
  const plan = planConfiguration({ roles: [{ name: 'Server' }], wage_rates: [{ role: 'Server', hourly_rate: 15 }, { role: 'Ghost', hourly_rate: 20 }] }, EMPTY)
  expect(plan.counts.wage_rates === 1, 'wage rate for a defined role is planned')
  expect(plan.warnings.some(w => w.includes('Ghost') && w.includes("isn't defined")), 'wage rate for an undefined role is skipped with a warning')
}
{
  const plan = planConfiguration({ roles: [{ name: 'Server' }], wage_rates: [{ role: 'Server', hourly_rate: -3 }] }, EMPTY)
  expect(plan.counts.wage_rates === 0 && plan.warnings.some(w => w.includes('positive')), 'non-positive wage rate is rejected')
}

// ── Field validation mirrors the executor ────────────────────────────────────
{
  const plan = planConfiguration({ shift_types: [{ name: 'Bad', start_time: '9am', end_time: '17:00', days_active: [1] }] }, EMPTY)
  expect(plan.counts.shift_types === 0 && plan.warnings.some(w => w.includes('HH:MM')), 'shift with a bad time format is rejected')
}
{
  const plan = planConfiguration({ shift_types: [{ name: 'NoDays', start_time: '09:00', end_time: '17:00', days_active: [] }] }, EMPTY)
  expect(plan.counts.shift_types === 0 && plan.warnings.some(w => w.toLowerCase().includes('days')), 'shift with no active days is rejected')
}
{
  const plan = planConfiguration({ roles: [{ name: 'X', color: 'green' }] }, EMPTY)
  expect(plan.counts.roles === 1, 'role with a bad color is still added')
  expect(plan.warnings.some(w => w.includes('color')), 'the bad color is reported and dropped')
  const roleStep = plan.steps.find(s => s.kind === 'role')
  expect(roleStep?.kind === 'role' && roleStep.data.color === undefined, 'invalid color is not carried into the step')
}

// ── Requirement referencing an undefined role: kept, but warned ──────────────
{
  const plan = planConfiguration({ shift_types: [{ name: 'Eve', start_time: '17:00', end_time: '21:00', days_active: [5], role_requirements: [{ accepted_roles: ['Bouncer'], required_count: 1 }] }] }, EMPTY)
  const st = plan.steps.find(s => s.kind === 'shift_type')
  expect(st?.kind === 'shift_type' && st.requirements.length === 1, 'requirement with an undefined role is still planned')
  expect(plan.warnings.some(w => w.includes('Bouncer') && w.includes("won't fill")), 'undefined role on a requirement is warned')
}

// ── Veteran rule referencing an unknown shift is skipped ─────────────────────
{
  const plan = planConfiguration({ veteran_rules: [{ shift_name: 'Phantom', mode: 'all_veterans' }] }, EMPTY)
  expect(plan.counts.veteran_rules === 0 && plan.warnings.some(w => w.includes('Phantom')), 'veteran rule for an unknown shift is skipped')
}
{
  const plan = planConfiguration({ veteran_rules: [{ mode: 'min_veterans' }] }, EMPTY)
  expect(plan.counts.veteran_rules === 0 && plan.warnings.some(w => w.includes('at least 1')), 'min_veterans rule without a count is skipped')
}
{
  const plan = planConfiguration({ veteran_rules: [{ mode: 'all_veterans' }] }, EMPTY)
  const v = plan.steps.find(s => s.kind === 'veteran_rule')
  expect(plan.counts.veteran_rules === 1 && v?.kind === 'veteran_rule' && v.data.shift_name === null, 'a shiftless all_veterans rule applies to every shift')
}

// ── Policies upsert (existing key updated, not skipped) ───────────────────────
{
  const existing: ExistingConfig = { roleNames: [], shiftTypeNames: [], wageRoleNames: [], policyKeys: ['week_start_day'] }
  const plan = planConfiguration({ policies: [{ policy_key: 'week_start_day', policy_value: 'Monday', policy_value_json: 'monday' }] }, existing)
  expect(plan.counts.policies === 1, 'an existing policy key is still planned (it upserts)')
  expect(plan.warnings.some(w => w.includes('will be updated')), 'updating an existing policy is noted')
}

// ── summarizePlan ────────────────────────────────────────────────────────────
{
  const bundle: ConfigBundle = {
    roles: [{ name: 'Lifeguard' }],
    shift_types: [{ name: 'AM', start_time: '09:00', end_time: '13:00', days_active: [1], role_requirements: [{ accepted_roles: ['Lifeguard'], required_count: 1 }] }],
  }
  const summary = summarizePlan(planConfiguration(bundle, EMPTY))
  expect(summary.includes('1 role') && summary.includes('1 shift') && summary.includes('1 role slot'), 'summary reads in plain English with counts')
  expect(summarizePlan(planConfiguration({}, EMPTY)) === 'No new setup to apply.', 'empty bundle summarizes as nothing to do')
}

void kinds

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll ingestionPlanner checks passed.')
}
