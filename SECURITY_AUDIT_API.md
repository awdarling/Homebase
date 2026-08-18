# Homebase `/api/*` Auth Audit — Phase 1 (Security)

> ## ⚠️ STATUS RECONCILIATION — 2026-08-18
>
> This audit was written **2026-06-09**. Four of its five open flags have since been fixed in
> `main` and the document did not say so. Re-verified against the current code on 2026-08-18:
>
> | Flag | Was | **Now (verified 2026-08-18)** |
> |---|---|---|
> | **F1 — `create-user` privilege escalation** (HIGH) | flagged, unfixed | **FIXED.** `src/app/api/create-user/route.ts` now does getUser → 401, loads the caller's own `role`/`company_id`, restricts creation to `owner`/`quria`, caps the assignable role at the caller's own rank via `ROLE_RANK`, and binds `company_id` to the caller (only `quria` may target another company). |
> | **F2 — `stripe` POST unscoped billing** (MED) | flagged, unfixed | **STILL OPEN.** `src/app/api/stripe/route.ts` has no `getUser()`, no role gate and no company binding — it still trusts `company_id`/`customer_id` from the request body behind only the middleware login gate. |
> | **F3 — `stripe/webhook` redirected by middleware** | flagged, unfixed | **FIXED.** `src/middleware.ts:40` now includes `pathname === '/api/stripe/webhook'` in `isPublic`. |
> | **F4 — `aegis-action` token hygiene** | needed confirming | **CONFIRMED OK.** `src/lib/aegis-actions/tokens.ts` stores `expires_at`, rejects expired tokens on consume (`:78`), and filters on `expires_at` when issuing (`:98`). Single-use consumption was already in place. |
> | **F5 — RLS as defence in depth** | strategic, open | **STILL OPEN**, and it is the largest one. Every route still uses the RLS-bypassing service-role key and re-implements company scoping in application code, so a forgotten guard is a cross-tenant hole rather than a failed query. Tracked as open item #3 in `claude/OPEN_ITEMS_MASTER.md`. |
>
> **So the live open items from this audit are F2 and F5.** Everything below this banner is the
> original 2026-06-09 text, preserved unchanged for its reasoning — read the table above for what
> is actually true today.


**Date:** 2026-06-09 · **Scope:** every route under `src/app/api/**/route.ts` (15 routes) · **Method:** static read of each handler + the active middleware (`src/middleware.ts`). Diagnose-first; no live-data runs (Supabase REST is not on the sandbox egress allowlist). **Branch:** `security/api-auth-audit`.

## TL;DR

- **6 routes** already use a consistent **standard guard** (cookie `auth.getUser()` → 401, then `users.company_id === body.company_id` → 403). Good.
- **2 routes** use a different but **correct** auth model (signed webhook / single-use token). Good.
- **4 routes** had **no auth** but the standard guard applies unambiguously → **FIXED in this branch**.
- **2 routes** had **no auth** and need a **role/product decision** (not just the standard guard) → **FLAGGED for Alexander, not changed**.

### The middleware baseline (read this first)

`src/middleware.ts` matches `/api/*` (matcher excludes only `_next/*` and `favicon.ico`) and **redirects unauthenticated requests to `/login`**, except `/api/aegis-action`, which is explicitly public. So there is a coarse "must be logged in" gate on almost every route. Two important limits of relying on it:

1. **It is authentication, not authorization.** It proves *some* user is logged in; it does **not** prove that user belongs to the `company_id` in the request body. Any logged-in user from company A can call a route with company B's `company_id` unless the route checks ownership itself. This is the cross-tenant gap behind most findings below.
2. **It returns a 307 redirect, not a 401.** Server-to-server callers (Stripe, cron, Aegis) that are not browser sessions get redirected to an HTML login page rather than a clean error — see the `stripe/webhook` note.

The "standard guard" referenced throughout is the in-repo canonical pattern (e.g. `schedule/download/excel/route.ts:21-33`): get the cookie user, 401 if absent, look up `users.company_id`, 403 if it doesn't match the body `company_id`.

---

## Per-endpoint findings

Risk: **HIGH** = privilege escalation or cross-tenant write/credential exposure · **MED** = cross-tenant read of sensitive data or unscoped privileged action · **LOW** = limited/no sensitive exposure.

| # | Route | Method | Auth present? | What it exposes / does | Risk | Disposition |
|---|---|---|---|---|---|---|
| 1 | `create-user` | POST | **None** (no getUser, no role, no company binding) | Service-role: creates a Supabase **auth user** + inserts a `users` row with `role` and `company_id` **straight from the request body** | **HIGH** | **FLAG** — needs role gate + decision |
| 2 | `stripe` | POST | **None** beyond middleware login | Creates Stripe customers / checkout / portal sessions from body (`customer_id`, `company_id`, amounts) | **MED** | **FLAG** — needs role/company gate |
| 3 | `soteria-validate-assignment` | POST | **None** (was) → **standard guard added** | Service-role read of `employees` (incl. `individual_wage`), `availability`, `policies`, `wage_rates` for body `company_id` | **MED** | **FIXED** this branch |
| 4 | `soteria-validate-schedule` | POST | **None** (was) → **standard guard added** | Service-role read of `employees`, `availability`, `time_off`, `conflicts`, `policies`, `schedules` for body `company_id` | **MED** | **FIXED** this branch |
| 5 | `payroll/test-payroll-provider` | POST | **None** (was) → **standard guard added** | Service-role read of `payroll_integrations` (probes whether another company has credentials configured; does not return the key value) | **MED** | **FIXED** this branch |
| 6 | `payroll/test-timeclock` | POST | **None** (was) → **standard guard added** | Service-role read of `time_clock_integrations` (same probe pattern) | **MED** | **FIXED** this branch |
| 7 | `notify-assignment` | POST | **Yes** — getUser + `company_id` match (401/403) | Sends a Telnyx SMS to an employee in the caller's company | LOW (auth) | No change — see note |
| 8 | `notify-day-closure` | POST | **Yes** — getUser + `company_id` match | Reads/writes day-closure state scoped to caller's company | LOW | No change |
| 9 | `soteria/route` | POST | **Yes** — getUser + `companyId` match (`:364-374`) | Soteria NL admin context load for caller's company | LOW | No change |
| 10 | `soteria/execute` | POST | **Yes** — getUser + `companyId` match (`:27-37`) | Soteria NL **writes** (employees/policies/etc.), all scoped to caller's company | LOW (auth) | No change |
| 11 | `time-off-decision` | POST | **Yes** — getUser + same-company guard (`:31-65`) | Approves/denies a TO request; notifies employee | LOW | No change |
| 12 | `schedule/download/excel` | POST | **Yes** — standard guard (`:21-33`) | Returns the company's schedule as `.xlsx` | LOW | No change (auth); Task 2 touches rendering |
| 13 | `schedule/download/pdf` | POST | **Yes** — standard guard | Returns the company's schedule as PDF | LOW | No change (auth); Task 2 touches rendering |
| 14 | `aegis-action` | GET/POST | **Yes** — single-use **token** (`verifyToken`/`consumeToken`); public by design (middleware-bypassed) | Confirms an Aegis magic-link action (e.g. TO approval) | LOW | No change — see note |
| 15 | `stripe/webhook` | POST | **Yes** — Stripe **signature** verification (`stripe-signature`) | Processes Stripe billing events | LOW (auth) | No change — but **FLAG** a functional middleware issue |

---

## What changed in this branch (the 4 unambiguous fixes)

Added the **identical** in-repo standard guard to the four routes that already destructure `company_id` from the body and use it for company-scoped service-role queries. No behavioral change for legitimate callers (a manager acting on their own company); cross-tenant and anonymous callers now get 401/403 instead of data.

- `soteria-validate-assignment/route.ts` — guard after body destructure; `{ error }` 401/403 (matches sibling soteria routes).
- `soteria-validate-schedule/route.ts` — same.
- `payroll/test-payroll-provider/route.ts` — guard after the `company_id` presence check; `{ success:false, message }` 401/403 (matches this route's own response convention).
- `payroll/test-timeclock/route.ts` — same.

`npx tsc --noEmit` → **0 errors**. Not live-verified (no Supabase egress from the sandbox) — a real signed-in vs. cross-company request check is Alexander's to run.

---

## Flagged for Alexander (NOT changed — need a decision, not just the standard guard)

### F1 — `create-user` (HIGH). Privilege escalation + cross-tenant user creation.
The route takes `{ email, name, role, company_id }` from the body and, with the **service-role** key, creates an auth user and inserts a `users` row with that exact `role` and `company_id`. Behind the middleware login gate, **any** signed-in user can therefore:
- mint a user in **another** company (`company_id` from body, not from the caller), and/or
- grant **any** `role`, including `owner` or `quria` — privilege escalation.

The fix is **not** the plain standard guard, because it needs a policy call:
- Who may create users — `owner`/`quria` only, or managers too?
- May an `owner` create users **only** in their own company (bind `company_id` to the caller), while `quria` may create cross-company?
- Should assignable `role` be capped by the caller's role (a manager can't mint an owner)?

Recommend: getUser → load caller's `role` + `company_id` → enforce (a) role ∈ allowed-creators, (b) target `company_id` === caller's (except `quria`), (c) target `role` ≤ caller's privilege. Wiring this needs the intended access model confirmed first.

### F2 — `stripe` (POST, the non-webhook billing route) (MED). Unscoped billing actions.
Creates Stripe customers, checkout sessions, and billing-portal sessions from body params (`customer_id`, `company_id`, amounts, price IDs). Only the middleware login gate stands in front. A signed-in user could create checkout/portal sessions referencing arbitrary `customer_id`/`company_id`. Needs: getUser + (likely) **owner-only** role gate + bind `company_id`/`customer_id` to the caller's company. "Who can manage billing" is a product decision → flagged rather than auto-guarded.

### F3 — `stripe/webhook` (functional, not an auth hole). Middleware may redirect Stripe.
The webhook correctly verifies the `stripe-signature` (good auth model). **But** it is **not** in the middleware `isPublic` allowlist, so an unauthenticated Stripe POST is matched by the middleware and redirected (307) to `/login` before the handler runs — meaning the webhook may never execute in production. Either add `/api/stripe/webhook` to the middleware public allowlist (like `/api/aegis-action`), or exclude `/api/stripe/*` from the matcher. This is a delivery/reliability bug surfaced by the audit; left for Alexander since it changes middleware routing behavior. (Worth confirming against live Stripe delivery logs.)

### F4 — `aegis-action` token hygiene (LOW, verify). 
Auth is a single-use token (`consumeToken`). This is the right model for a magic link. Recommend a quick confirm in `src/lib/aegis-actions/tokens.ts` that tokens are high-entropy and have a TTL/expiry (consumption is already single-use). Not changed.

### F5 — Defense-in-depth note (LOW, strategic).
Every route uses the **service-role** key (RLS-bypassing) and re-implements company scoping in app code. That's why a missing guard = a cross-tenant hole. The durable fix (tracked under the roadmap "Dedicated security track") is **RLS on the underlying tables** so a forgotten guard fails closed instead of open. Out of scope for this diagnose-and-guard pass; noted so it isn't lost.

---

## Verification status
- Static audit: complete for all 15 routes.
- `tsc`: clean (0 errors) after the 4 guards.
- Live verification (signed-in happy path + cross-company 403 + anon 401): **NOT run** — Supabase egress is not allowlisted from the agent sandbox. Alexander to verify against the sandbox tenant before merge.
