-- ============================================================
-- 008 — employees: is_veteran
-- ============================================================
-- Adds a veteran identifier to employees. Managers can use this
-- flag to filter the employee list and prioritize veterans for
-- specific shifts or holidays.
-- ============================================================

alter table public.employees
  add column if not exists is_veteran boolean not null default false;
