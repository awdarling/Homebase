-- ============================================================
-- 005 — employees.aegis_access
-- ============================================================
-- Tracks each employee's level of access to Aegis. Quria staff
-- always have full access regardless of this column — they are
-- gated separately via the quria_staff table.
-- ============================================================

alter table public.employees
  add column if not exists aegis_access text not null default 'employee'
  check (aegis_access in ('manager', 'employee', 'blocked'));
