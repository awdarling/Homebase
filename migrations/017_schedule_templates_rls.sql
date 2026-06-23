-- 017_schedule_templates_rls.sql
--
-- TEMPLATE-EDIT-2 root cause: schedule_templates has RLS ENABLED but NO
-- policies, so the browser (anon/authenticated) client is denied every read
-- and write. The template editor therefore loads a default (it can't see the
-- real row) and every save is rejected by RLS — then swallowed client-side, so
-- the manager is never told. Net effect: template edits never persist.
--
-- Fix: give schedule_templates the same company-scoped access policy every
-- other company-owned table has (mirrors shift_experience_rules' USING +
-- WITH CHECK, plus the quria cross-company override used by shift_requirements).
--
-- Safe to run more than once (idempotent). Read + write are both gated to the
-- caller's own company; quria admins may act across companies.

alter table public.schedule_templates enable row level security;

drop policy if exists "Company schedule templates access" on public.schedule_templates;

create policy "Company schedule templates access"
  on public.schedule_templates
  for all
  using (
    company_id in (select users.company_id from public.users where users.id = auth.uid())
    or get_my_role() = 'quria'
  )
  with check (
    company_id in (select users.company_id from public.users where users.id = auth.uid())
    or get_my_role() = 'quria'
  );
