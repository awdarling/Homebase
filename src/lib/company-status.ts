// The single "is this company live?" answer (Rule 0b).
//
// This is the ONE function BILL-1 (service cut-off on billing lapse) and
// OPS-1 (the Quria kill switch) both resolve through. Homebase's login
// middleware, Homebase's billing/admin UI, Aegis's inbound message handlers
// and Aegis's schedulers all call this — nothing else in either codebase
// should independently decide whether a company is "live." If a second
// company-state check ever appears anywhere, that is the exact drift this
// module exists to prevent (DRIFT_REGISTER §U3).
//
// MIRRORED, NOT SHARED: Aegis (Node/Express/Railway) and Homebase
// (Next.js/Vercel) are two separately-deployed services with no shared
// package or monorepo tooling between them. Rather than have Homebase's
// login path make a network call to Aegis (or vice versa) on every request
// — which would mean a slow or down Aegis could lock every manager out of
// Homebase, the opposite of what this build is for — this file is a pure,
// dependency-free function with an identical copy in both repos. Drift
// between the two copies is caught by `__fixtures__/company-live-status.cases.json`:
// the SAME fixture is checked into both repos and both test suites assert
// against it. A future edit that changes behavior in only one repo fails
// that repo's own test immediately; a fixture update is the deliberate,
// visible way to change the contract in both places at once. This is the
// "mirrored-with-drift-test" option named in the kickoff prompt, chosen
// over an Aegis `/internal/*` endpoint specifically to avoid an
// availability dependency on the login-critical path.
//
// CORE RULE — the thing this whole build exists to get right: absence of
// billing information means LIVE, not dead. A company with no Stripe
// subscription and no service_through date set stays live indefinitely.
// That is the state every sandbox tenant is in today, and it is what keeps
// Watermark Country Club (billing_model: one_time, subscription_status:
// inactive, no dates set) live. Never invert this to "blocked unless
// active" — see DRIFT_REGISTER §U1 for why that was nearly built.

import { endOfDayInTimezone, addDays } from './tenant-date';

export const GRACE_PERIOD_DAYS = 7;

export type BillingModel = 'subscription' | 'one_time' | 'trial';

export interface CompanyBillingFields {
  /** companies.billing_model. Anything other than the three known values is
   *  treated as "no cap" (fail open — see CORE RULE above). */
  billing_model: string | null;
  /** companies.subscription_period_end — Stripe-owned, subscription model only. */
  subscription_period_end: string | null;
  /** companies.service_through — Quria-set date (YYYY-MM-DD), one_time/trial only. */
  service_through: string | null;
  /** companies.deactivated_at — the OPS-1 kill switch. Non-null = forced dark. */
  deactivated_at: string | null;
  /** companies.timezone — IANA zone, used to evaluate service_through end-of-day. */
  timezone: string;
}

export type CompanyState = 'live' | 'grace' | 'dark_kill_switch' | 'dark_lapsed';

export interface CompanyLiveStatus {
  /** The one boolean callers actually branch on. */
  live: boolean;
  state: CompanyState;
  /** ISO instant this company's service is/was paid through, or null if
   *  there is no cap (no billing info set — the default live state). This
   *  is the field Alexander's separate billing-notification automation
   *  should read rather than re-deriving "what date is this paid through" —
   *  see Roadmap_Backlog 2026-09-05. */
  serviceThrough: string | null;
  inGrace: boolean;
  /** ISO instant the one-week grace period ends, or null if not applicable. */
  graceEndsAt: string | null;
  /** Human-readable explanation, safe for internal/admin display and logs.
   *  NOT written to be shown to employees as-is — see the neutral,
   *  non-billing-revealing copy used in Aegis's auto-reply instead. */
  reason: string;
}

export function getCompanyLiveStatus(
  company: CompanyBillingFields,
  now: Date = new Date()
): CompanyLiveStatus {
  // OPS-1 kill switch overrides everything, always in favor of "off." No
  // grace — flipping it is immediate by definition.
  if (company.deactivated_at) {
    return {
      live: false,
      state: 'dark_kill_switch',
      serviceThrough: null,
      inGrace: false,
      graceEndsAt: null,
      reason: 'Manually deactivated by Quria (kill switch)',
    };
  }

  const serviceThroughInstant = resolveServiceThroughInstant(company);

  // No billing cap set for this arrangement → live by default. This is the
  // state every sandbox tenant is in today, and it is what keeps Watermark
  // up (one_time, no service_through date set yet).
  if (serviceThroughInstant === null) {
    return {
      live: true,
      state: 'live',
      serviceThrough: null,
      inGrace: false,
      graceEndsAt: null,
      reason: 'No billing cap set for this arrangement — live by default',
    };
  }

  const graceEndsAt = resolveGraceEndsAt(company, serviceThroughInstant);

  if (now.getTime() <= serviceThroughInstant.getTime()) {
    return {
      live: true,
      state: 'live',
      serviceThrough: serviceThroughInstant.toISOString(),
      inGrace: false,
      graceEndsAt: graceEndsAt.toISOString(),
      reason: 'Within the paid-through period',
    };
  }

  if (now.getTime() <= graceEndsAt.getTime()) {
    return {
      live: true,
      state: 'grace',
      serviceThrough: serviceThroughInstant.toISOString(),
      inGrace: true,
      graceEndsAt: graceEndsAt.toISOString(),
      reason: `Paid-through date passed; within the ${GRACE_PERIOD_DAYS}-day grace period`,
    };
  }

  return {
    live: false,
    state: 'dark_lapsed',
    serviceThrough: serviceThroughInstant.toISOString(),
    inGrace: false,
    graceEndsAt: graceEndsAt.toISOString(),
    reason: 'Paid-through date and grace period both passed',
  };
}

/**
 * The exact instant this company's current arrangement is paid through, or
 * null if there is no cap. Subscription dates come from Stripe as an exact
 * instant already (no timezone conversion needed — use as-is). One-time and
 * trial dates are a bare calendar date Quria sets on the company's Homebase,
 * so they are resolved to "end of that day in the company's own timezone"
 * (never server/UTC midnight — this is the bug class OPEN_ITEMS #7 names).
 */
function resolveServiceThroughInstant(company: CompanyBillingFields): Date | null {
  switch (company.billing_model) {
    case 'subscription':
      return company.subscription_period_end ? new Date(company.subscription_period_end) : null;
    case 'one_time':
    case 'trial':
      return company.service_through
        ? endOfDayInTimezone(company.service_through, company.timezone)
        : null;
    default:
      // Unrecognized/null billing_model: fail open (no cap) rather than
      // guess — an unexpected value here should never silently take a
      // company dark.
      return null;
  }
}

function resolveGraceEndsAt(company: CompanyBillingFields, serviceThroughInstant: Date): Date {
  if (company.billing_model === 'subscription') {
    // Already an exact instant from Stripe — a plain duration add is
    // correct and avoids re-deriving a calendar date from it.
    return new Date(serviceThroughInstant.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  }
  // one_time / trial: extend the calendar date by 7 days, then re-resolve
  // end-of-day in tz, so grace ends at end-of-day on day+7 local time
  // exactly (rather than "serviceThroughInstant + 168h", which can land an
  // hour off across a DST transition).
  const serviceThroughYmd = company.service_through as string; // non-null: caller only reaches here when set
  const graceEndYmd = addDays(serviceThroughYmd, GRACE_PERIOD_DAYS);
  return endOfDayInTimezone(graceEndYmd, company.timezone);
}
