-- ============================================================
-- 013 — schedules.status: allow 'distributed'
-- ============================================================
-- Phase 4 magic-link dispatchers (src/lib/aegis-actions/dispatcher.ts,
-- confirm_distribution handler) mark a schedule as distributed when
-- the manager clicks the Distribute link in the email. The original
-- CHECK constraint (migration history pre-004 / baseline schema.sql)
-- only allowed ('draft', 'published'); 'distributed' rejected at the
-- DB level. This extends the CHECK to include 'distributed'.
-- ============================================================

alter table public.schedules
  drop constraint if exists schedules_status_check;

alter table public.schedules
  add constraint schedules_status_check
  check (status in ('draft', 'published', 'distributed'));
