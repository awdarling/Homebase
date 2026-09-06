-- ============================================================
-- 021 — companies: BILL-1/OPS-1 billing gate columns
-- ============================================================
-- GATED: apply this in Supabase yourself — SANDBOX FIRST, then production
-- only after the sandbox test plan passes. The agent does NOT apply
-- migrations or run SQL against the live database.
--
-- WHAT THIS DOES
--   (1) Adds `deactivated_at timestamptz` — the OPS-1 Quria-only kill
--       switch. Non-null = this company is forced dark, overriding
--       everything else (no grace period; reversible by clearing it).
--   (2) Adds `service_through date` — the Quria-set "paid through" date
--       for the one_time and trial billing models. The subscription
--       model's equivalent, `subscription_period_end`, already exists
--       (migration 009) and is kept current by the Stripe webhook; this is
--       the same concept for the two models nothing updates automatically.
--   (3) Extends the `billing_model` CHECK constraint to allow 'trial' in
--       addition to the existing 'subscription' / 'one_time'. Verified
--       live 2026-09-05 that this CHECK exists today
--       (companies_billing_model_check) and would reject 'trial' as-is —
--       see DRIFT_REGISTER §U2 / the BILL-1/OPS-1 kickoff prompt for why
--       this needed checking rather than assuming either way.
--   (4) Adds a BEFORE UPDATE trigger that blocks changes to
--       deactivated_at / service_through / billing_model from anyone
--       except Quria staff or the service-role key.
--
-- WHY A TRIGGER AND NOT JUST RLS: Postgres row-level security policies
-- gate entire rows, not individual columns. The existing "Quria and owners
-- can update company" UPDATE policy on this table already lets an OWNER
-- update their own company row — correct for the existing
-- price/notes/billing_email admin fields, but wrong for these three: OPS-1
-- explicitly requires "an owner must not be able to flip their own company
-- back on." The new /api/quria/company-gate route already restricts these
-- writes to Quria staff at the application layer, but this trigger is the
-- defense-in-depth backstop at the database itself — the kickoff prompt is
-- explicit that this build's whole purpose is "stop the system working for
-- a company," so a bug here is not a degraded feature, it's an outage.
--
-- The trigger allows a change to one of the three protected columns only
-- when either:
--   - the request is running as the service_role (auth.role() =
--     'service_role') — i.e. it came through a server route that already
--     did its own Quria check, or
--   - the request is running as a 'quria'-role user (get_my_role() =
--     'quria') — the SAME role check the existing companies UPDATE policy
--     already uses (Rule 0: reusing the established convention rather
--     than inventing a second one).
-- Anyone else attempting to change one of the three protected columns gets
-- a clear Postgres exception instead of a silent no-op or a partial write.
--
-- NOTE ON auth.role(): this assumes the standard Supabase convention where
-- a request made with the service-role key surfaces as auth.role() =
-- 'service_role'. Sandbox-test this migration together with the new
-- /api/quria/company-gate route before applying to production — if that
-- assumption doesn't hold in this project's Supabase setup, Quria's own
-- writes through that route would also be rejected, which will show up
-- immediately as a failing "flip the kill switch" test rather than as a
-- silent gap.
-- ============================================================

-- (1) + (2) columns ------------------------------------------------------
alter table public.companies
  add column if not exists deactivated_at timestamptz,
  add column if not exists service_through date;

comment on column public.companies.deactivated_at is
  'OPS-1 kill switch. Non-null = Quria has manually forced this company dark. Quria-only write (see trg_enforce_billing_gate_columns).';
comment on column public.companies.service_through is
  'Quria-set "paid through" date for one_time/trial billing_model companies (the subscription model instead uses subscription_period_end, kept current by the Stripe webhook). NULL = no cap set, company stays live. Quria-only write.';

-- (3) billing_model gains 'trial' -----------------------------------------
alter table public.companies drop constraint if exists companies_billing_model_check;
alter table public.companies
  add constraint companies_billing_model_check
  check (billing_model = any (array['subscription'::text, 'one_time'::text, 'trial'::text]));

-- (4) protect the three OPS-1/BILL-1 columns from non-Quria writes --------
create or replace function public.enforce_billing_gate_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.deactivated_at is distinct from old.deactivated_at)
     or (new.service_through is distinct from old.service_through)
     or (new.billing_model is distinct from old.billing_model)
  then
    if auth.role() <> 'service_role' and get_my_role() <> 'quria' then
      raise exception 'Only Quria staff may change deactivated_at, service_through, or billing_model';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_billing_gate_columns on public.companies;
create trigger trg_enforce_billing_gate_columns
  before update on public.companies
  for each row
  execute function public.enforce_billing_gate_columns();
