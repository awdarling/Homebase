-- ============================================================
-- 014 — schedules soft-delete + per-command RLS (SCHED-DELETE-1)
-- ============================================================
-- (1) Add a nullable soft-delete marker. App code sets this via a
--     service-role route; it never hard-DELETEs a schedule row.
-- (2) Replace the single permissive ALL policy ("Company schedules
--     access") with per-command policies that PRESERVE the existing
--     SELECT/INSERT/UPDATE access (identical qual) and ADD a
--     FOR DELETE policy USING (false) so NO client (anon/authenticated)
--     can hard-delete a schedule. The service role bypasses RLS, so the
--     /api/schedule/delete route (soft-delete UPDATE) is unaffected.
--
--   GATED: apply this in Supabase yourself. Recommended order —
--   (1) run the ADD COLUMN first, (2) deploy code, (3) run the policy
--   swap LAST (so the FOR DELETE USING(false) lock lands only once the
--   app no longer issues client-side DELETEs).
-- ============================================================

-- (1) soft-delete column ------------------------------------------------
alter table public.schedules
  add column if not exists deleted_at timestamptz;

-- (2) per-command RLS ---------------------------------------------------
-- Drop the existing permissive ALL policy.
drop policy if exists "Company schedules access" on public.schedules;

-- SELECT — same qual as before.
create policy "schedules_select" on public.schedules
  for select
  using ((company_id = get_my_company_id()) or (get_my_role() = 'quria'));

-- INSERT — same qual as before (ALL policy applied USING as the check).
create policy "schedules_insert" on public.schedules
  for insert
  with check ((company_id = get_my_company_id()) or (get_my_role() = 'quria'));

-- UPDATE — same qual as before (covers soft-delete done by service role,
--          and any existing same-company client UPDATEs e.g. close-day).
create policy "schedules_update" on public.schedules
  for update
  using ((company_id = get_my_company_id()) or (get_my_role() = 'quria'))
  with check ((company_id = get_my_company_id()) or (get_my_role() = 'quria'));

-- DELETE — deny for ALL non-service callers. Service role bypasses RLS.
create policy "schedules_no_client_delete" on public.schedules
  for delete
  using (false);
