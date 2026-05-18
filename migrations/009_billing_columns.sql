-- ============================================================
-- 009 — companies: Stripe billing columns
-- ============================================================
-- Tracks Stripe customer/subscription state on each company.
-- These columns are read by the Billing page and written by
-- /api/stripe/webhook in response to Stripe events.
-- ============================================================

alter table public.companies
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text default 'inactive',
  add column if not exists subscription_price integer default 0,
  add column if not exists subscription_notes text,
  add column if not exists billing_email text,
  add column if not exists subscription_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean default false;
