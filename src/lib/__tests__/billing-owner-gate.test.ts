// S-2 billing guard — 2026-08-24 (SECURITY_AUDIT_MASTER §1).
// Run:  npx ts-node --transpile-only -r tsconfig-paths/register \
//         --project tsconfig.scripts.json src/lib/__tests__/billing-owner-gate.test.ts
//
// Decision (Alexander, 2026-08-24, Option A): Quria sets the price; only the
// company's OWNER (or Quria) starts/manages the subscription. Before this the
// route had no login check, no company check, and took the price from the
// request body. This file pins the contract so it cannot quietly regress.

import { readFileSync } from 'fs'
import { resolve } from 'path'

let failures = 0
function expect(cond: unknown, msg: string): void {
  if (cond) { console.log(`✓ ${msg}`) } else { console.error(`✗ ${msg}`); failures++ }
}

const root = resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const route = read('src/app/api/stripe/route.ts')
const page = read('src/app/(app)/billing/page.tsx')

// ── The route authenticates and binds to a company ───────────────────────────
expect(/ssr\.auth\.getUser\(\)/.test(route), 'route loads the signed-in user from their own session')
expect(/\.from\('users'\)[\s\S]*?\.select\('role, company_id'\)[\s\S]*?\.eq\('id', user\.id\)/.test(route),
  'route loads the caller\'s role + company from the database, not the request')
expect(/BILLING_ROLES = \['owner', 'quria'\]/.test(route), 'only owner and quria may manage billing (Option A)')
expect(/caller\.role === 'quria' && requestedCompanyId \? requestedCompanyId : caller\.company_id/.test(route),
  'company is the caller\'s own; only quria may name another')

// ── Price and Stripe ids come from the company record, never the body ────────
expect(!/params\.amount_cents|body\.amount_cents/.test(route), 'amount_cents is never read from the request')
expect(!/params\.customer_id|body\.customer_id/.test(route), 'customer_id is never read from the request')
expect(!/params\.subscription_id|body\.subscription_id/.test(route), 'subscription_id is never read from the request')
expect(!/params\.price_id|body\.price_id/.test(route), 'price_id is never read from the request')
expect(/unit_amount: amountCents/.test(route) && /company\.subscription_price/.test(route),
  'checkout is priced from companies.subscription_price')
expect(/\.update\(\{ stripe_customer_id: customerId \}\)/.test(route), 'the Stripe customer id is persisted server-side')
expect(!/case 'cancel_subscription'/.test(route), 'immediate cancel is gone — cancel-at-period-end lives in the Stripe portal')
expect(!/params\.origin|body\.origin/.test(route), 'redirect origin is not taken from the request body')

// ── Errors do not leak Stripe/Supabase detail to the browser (N-8) ───────────
expect(!/error: error\.message|error: err\.message/.test(route), 'raw error messages are not returned to the caller')

// ── The page mirrors the server rule ─────────────────────────────────────────
expect(/canManageBilling = isQuria \|\| currentUser\?\.role === 'owner'/.test(page), 'page shows billing buttons to owner/quria only')
expect(/Only the account owner can start or change the subscription/.test(page), 'managers are told why there are no buttons')
expect(!/amount_cents/.test(page), 'page no longer sends a price')
expect(!/update\(\{ stripe_customer_id/.test(page), 'page no longer writes the Stripe customer id from the browser')
expect(/action: 'start_checkout'|'start_checkout' \| 'open_portal'/.test(page), 'page calls the new start_checkout action')

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall billing-owner-gate checks passed')
