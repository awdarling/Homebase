-- 019_custom_availability_effective_start.sql
-- Live-ops Finding 3 (DRIFT_REGISTER §I / §E E6): custom_availability has an
-- end_date but no start bound, so a *future-effective* availability change
-- ("weekends-only starting Aug 18") cannot be represented. Soteria was
-- improvising a custom override with a far-out end date that (a) takes effect
-- immediately, not on the requested date, and (b) reverts mid-season — a
-- data-integrity risk. Add an effective start date to bound the override window.
--
-- Nullable, no default: existing rows stay NULL and keep applying immediately
-- (NULL = "in effect since always"), so current behavior is preserved exactly.
-- The resolvers (Homebase validateScheduleEdit.resolveEffectiveAvailability and
-- Aegis custom-availability.resolveAvailabilityForWeek) skip a custom override
-- for any schedule week whose week_start is before effective_start_date.
--
-- Idempotent. Human-gated: run in Alexander's terminal against the shared
-- Supabase BEFORE deploying the code branches that populate/read the column.

ALTER TABLE custom_availability
  ADD COLUMN IF NOT EXISTS effective_start_date DATE;

COMMENT ON COLUMN custom_availability.effective_start_date IS
  'Effective start of this override window (inclusive). NULL = in effect immediately/always. Distinct from cycle_start_date, which only anchors the rotating-pattern cycle. Paired with end_date to bound the override''s active window.';
