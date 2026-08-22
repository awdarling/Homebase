// Payroll removal guard — 2026-08-18.
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register \
//         --project tsconfig.scripts.json src/lib/__tests__/payroll-removed.test.ts
//
// Decision (Alexander, 2026-08-18): payroll is not built, so the payroll page is
// replaced by an honest "coming soon" page and everything behind it is removed.
// Wage data is a DIFFERENT thing that happens to share a word — the estimated
// labour cost on a schedule, the wage breakdown, the per-role rate table and the
// dashboard tile are all still live and are asserted below.

import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const root = resolve(__dirname, '../../..')
const has = (rel: string) => existsSync(resolve(root, rel))
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

// ── The feature is gone ──────────────────────────────────────────────────────
expect(!has('src/app/api/payroll/test-timeclock/route.ts'), 'the time-clock credential probe route is deleted');
expect(!has('src/app/api/payroll/test-payroll-provider/route.ts'), 'the payroll-provider credential probe route is deleted');
expect(!has('src/app/api/payroll'), 'the whole /api/payroll directory is gone');

const nav = read('src/components/layout/Nav.tsx')
expect(!/\{\s*href:\s*'\/payroll'/.test(nav), 'Payroll is no longer a nav link');

const types = read('src/lib/types.ts')
expect(!/interface TimeClockIntegration\b/.test(types), 'TimeClockIntegration type is removed');
expect(!/interface PayrollIntegration\b/.test(types), 'PayrollIntegration type is removed');

const seed = read('scripts/seed-watermark.ts')
expect(!/payroll_check_clean/.test(seed), 'the seed no longer fabricates a payroll activity row');

// ── The page that remains is honest ──────────────────────────────────────────
const page = read('src/app/(app)/payroll/page.tsx')
expect(has('src/app/(app)/payroll/page.tsx'), '/payroll still resolves — it is a placeholder, not a 404');
expect(/Coming soon/i.test(page), 'the page says "coming soon"');
expect(page.length < 5000, 'the page is a placeholder, not a 993-line fake feature');
expect(!/time_clock_integrations|payroll_integrations/.test(page), 'the placeholder reads no payroll tables');
expect(!/createClient/.test(page), 'the placeholder makes no database calls at all');
expect(/Wage Rates/.test(page), 'the placeholder tells the manager where wages actually live');

// ── The wage features are untouched ──────────────────────────────────────────
expect(has('src/lib/hooks/useWageBreakdown.ts'), 'the wage breakdown hook still exists');
expect(has('src/components/schedule/WageBreakdownPanel.tsx'), 'the wage breakdown panel still exists');
expect(has('src/app/(app)/data/tabs/WageRatesTab.tsx'), 'the Data → Wage Rates tab still exists');

const hook = read('src/lib/hooks/useWageBreakdown.ts')
expect(/individual_wage/.test(hook) && /wage_rates/.test(hook),
  'the hook still resolves an individual wage with the role rate as fallback');

const dashboard = read('src/app/(app)/page.tsx')
expect(/Est\. Labor|estimated_wages|individual_wage/.test(dashboard),
  'the dashboard still shows estimated labour cost');

const builder = read('src/components/schedule/ManualScheduleBuilder.tsx')
expect(/individual_wage/.test(builder) && /staffing_report/.test(builder),
  'the manual schedule builder still reads wages and writes the labour-cost snapshot');

const t = read('src/lib/types.ts')
expect(/estimated_wages/.test(t), 'StaffingReport still carries estimated_wages');
expect(/interface WageRate\b|type WageRate\b/.test(t), 'the WageRate type survives');

expect(/wage_rates/.test(read('src/lib/soteria/ingestionPlanner.ts')),
  'Soteria can still set up wage rates from a handbook');

if (failures > 0) { console.error(`\n${failures} payroll-removal check(s) FAILED.`); process.exit(1) }
console.log('\nAll payroll-removal checks passed.')
