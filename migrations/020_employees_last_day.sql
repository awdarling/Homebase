-- 020_employees_last_day.sql
-- HUMAN-GATED — Alexander runs this in his own terminal/Supabase. DO NOT auto-run.
--
-- Additive, nullable column for the last-day / offboarding feature (NextBuild
-- Feature B). NULL = active / no departure set, so every existing row is unchanged
-- and every query that doesn't opt in keeps its current behavior.
--
-- Semantics: last_day is the employee's acknowledged FINAL WORKING DAY (inclusive).
-- A daily Aegis job flips active=false once last_day has passed; the schedule
-- builder excludes the employee from any week that starts AFTER last_day (whole-week
-- granularity — they are kept through a last_day that falls mid-week). It is set
-- ONLY by a manager acknowledgment (Soteria "set <name>'s last day" / the Employees
-- tab), NEVER from an employee's inbound message.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_day date;

COMMENT ON COLUMN employees.last_day IS
  'Acknowledged final working day (inclusive). NULL = active/no departure. A daily job flips active=false after this date; the schedule builder excludes the employee from any week starting after it. Set only by a manager acknowledgment, never from an employee message.';
