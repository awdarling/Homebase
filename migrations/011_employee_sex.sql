-- ============================================================
-- 011 — employees: sex
-- ============================================================
-- Adds an optional sex identifier to employees. Used by managers
-- when staffing rules need to account for it. Constrained to a
-- small allowed set; nullable so it's strictly opt-in per row.
-- ============================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS sex text
  CHECK (sex IN ('male', 'female', 'nonbinary', 'prefer_not_to_say'));
