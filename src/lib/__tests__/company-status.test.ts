// Runtime test for the shared "is this company live?" gate (BILL-1/OPS-1).
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register --project tsconfig.scripts.json \
//         src/lib/__tests__/company-status.test.ts
//
// This fixture is IDENTICAL to Aegis's src/lib/__fixtures__/company-live-status.cases.json.
// See src/lib/company-status.ts for why the gate is a mirrored pure function
// (one copy per repo) rather than a cross-service call, and why this shared
// fixture is the drift check between the two copies.

import { getCompanyLiveStatus, type CompanyBillingFields } from '../company-status'
import fixtureJson from '../__fixtures__/company-live-status.cases.json'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

interface FixtureCase {
  name: string
  now: string
  input: CompanyBillingFields
  expected: {
    live: boolean
    state: string
    inGrace: boolean
    serviceThrough?: string | null
    graceEndsAt?: string | null
  }
}

const cases = (fixtureJson as { cases: FixtureCase[] }).cases

for (const testCase of cases) {
  const result = getCompanyLiveStatus(testCase.input, new Date(testCase.now))
  expect(result.live === testCase.expected.live, `${testCase.name} — live`)
  expect(result.state === testCase.expected.state, `${testCase.name} — state`)
  expect(result.inGrace === testCase.expected.inGrace, `${testCase.name} — inGrace`)
  if (Object.prototype.hasOwnProperty.call(testCase.expected, 'serviceThrough')) {
    expect(result.serviceThrough === testCase.expected.serviceThrough, `${testCase.name} — serviceThrough`)
  }
  if (Object.prototype.hasOwnProperty.call(testCase.expected, 'graceEndsAt')) {
    expect(result.graceEndsAt === testCase.expected.graceEndsAt, `${testCase.name} — graceEndsAt`)
  }
}

// ── Direct assertions beyond the shared fixture ─────────────────────────────
{
  const base: CompanyBillingFields = {
    billing_model: 'one_time',
    subscription_period_end: null,
    service_through: '2026-01-01',
    deactivated_at: null,
    timezone: 'America/Detroit',
  }
  const snapshot = JSON.stringify(base)
  getCompanyLiveStatus(base, new Date('2026-06-01T00:00:00Z'))
  expect(JSON.stringify(base) === snapshot, 'getCompanyLiveStatus does not mutate its input')
}

{
  const result = getCompanyLiveStatus({
    billing_model: 'subscription',
    subscription_period_end: null,
    service_through: null,
    deactivated_at: null,
    timezone: 'America/Detroit',
  })
  const hasAllFields = ['live', 'state', 'serviceThrough', 'inGrace', 'graceEndsAt', 'reason']
    .every(key => Object.prototype.hasOwnProperty.call(result, key))
  expect(hasAllFields, 'every field of the shared contract is present on the result')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nAll company-status checks passed.')
}
