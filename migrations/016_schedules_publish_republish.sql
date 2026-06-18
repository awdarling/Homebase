-- ============================================================
-- 016 — schedules publish / republish (DEV_ROADMAP items 9 + 12)
-- ============================================================
-- GATED: apply this in Supabase yourself — SANDBOX FIRST, then production
-- only after the sandbox test plan passes. The agent does NOT apply migrations.
--
-- WHAT THIS DOES
--   (1) Adds the publish/republish source-of-truth columns to schedules:
--         published_at   timestamptz  — non-null = THE live published schedule
--                                        for its week (the new source of truth,
--                                        replacing the ambiguous status enum).
--         archived_at    timestamptz  — set when a republish supersedes this row.
--         superseded_by  uuid         — points at the new published row that
--                                        replaced this one (FK to schedules.id).
--   (2) Backfills published_at for schedules already distributed, so existing
--       published weeks are recognized as published by the new logic.
--   (3) Adds a partial unique index so at most ONE live (non-archived,
--       non-deleted) published schedule can exist per company per week.
--   (4) Adds publish_schedule_swap(p_new_id, p_old_id) — an ATOMIC function the
--       /api/schedule/publish route calls on republish: it unpublishes+archives
--       the old row and publishes the new row in a single transaction, and
--       clears ONLY the old row's saved wage/hours estimate so reports/payroll
--       follow the new published schedule. The old row + its assignment data are
--       preserved (archive, not delete).
--
-- RLS NOTE: schedules RLS (migration 014) already governs SELECT/INSERT/UPDATE
-- by company. The new columns ride those existing policies. The swap function is
-- SECURITY DEFINER and is only reachable through the server route, which performs
-- the sign-in + role + tenant authz before calling it (mirrors the SEC-1 pattern).
-- ============================================================

-- (1) columns ----------------------------------------------------------------
alter table public.schedules
  add column if not exists published_at timestamptz;

alter table public.schedules
  add column if not exists archived_at timestamptz;

alter table public.schedules
  add column if not exists superseded_by uuid
    references public.schedules(id) on delete set null;

-- (2) backfill ---------------------------------------------------------------
-- Treat anything already distributed (the real "went out" signal) as published.
update public.schedules
  set published_at = coalesce(published_at, distributed_at)
  where distributed_at is not null
    and published_at is null;

-- (3) one live published schedule per week -----------------------------------
-- Partial unique: only rows that are currently published AND not archived AND
-- not soft-deleted are constrained. Drafts and superseded rows are exempt, so a
-- manager can build a second draft for the same week and publish it (the swap
-- clears the old row's published_at before setting the new one's).
create unique index if not exists schedules_one_live_published_per_week
  on public.schedules (company_id, week_start)
  where published_at is not null
    and archived_at is null
    and deleted_at is null;

-- (4) atomic republish swap --------------------------------------------------
create or replace function public.publish_schedule_swap(
  p_new_id uuid,
  p_old_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_new uuid;
  v_company_old uuid;
begin
  -- Both rows must exist and belong to the same company. Lock them to make the
  -- swap atomic against concurrent publishes.
  select company_id into v_company_new from public.schedules where id = p_new_id for update;
  select company_id into v_company_old from public.schedules where id = p_old_id for update;

  if v_company_new is null then
    raise exception 'publish_schedule_swap: new schedule % not found', p_new_id;
  end if;
  if v_company_old is null then
    raise exception 'publish_schedule_swap: old schedule % not found', p_old_id;
  end if;
  if v_company_new <> v_company_old then
    raise exception 'publish_schedule_swap: schedules belong to different companies';
  end if;

  -- Unpublish + archive the OLD row FIRST (clears its published_at so the
  -- partial unique index never sees two live published rows for the week), and
  -- strip ONLY its saved wage/hours estimate so payroll/reports follow the new
  -- schedule. The row and its assignment data are kept for history/undo.
  update public.schedules
    set archived_at = now(),
        superseded_by = p_new_id,
        published_at = null,
        staffing_report = case
          when staffing_report is null then null
          else staffing_report - 'estimated_wages'
        end
    where id = p_old_id;

  -- Publish the NEW row.
  update public.schedules
    set published_at = now(),
        status = 'published',
        archived_at = null,
        superseded_by = null
    where id = p_new_id;
end;
$$;
