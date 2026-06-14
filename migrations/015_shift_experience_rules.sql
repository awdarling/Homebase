-- ============================================================
-- 015 — shift_experience_rules
-- ============================================================
-- Veteran / experience staffing requirements on specific shifts.
-- A manager describes (to Soteria or Aegis) that a shift must be
-- staffed by veterans — either ALL of them or a MINIMUM count —
-- optionally bounded to a season (date window) and specific days.
-- The schedule engine reads these and staffs accordingly.
--
--   mode = 'all_veterans'  -> every matching position must be a veteran
--   mode = 'min_veterans'  -> at least `min_count` veterans on the shift
--
--   shift_type_id  = the shift it targets (null = any shift)
--   days_of_week   = days it applies to, 0=Sun..6=Sat (null/empty = all days the shift runs)
--   role           = optional role scope within the shift (null = all roles)
--   season_start / season_end = inclusive window (null bounds = open-ended).
--                    A single-day rule sets season_start = season_end = that date.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shift_experience_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shift_type_id uuid REFERENCES public.shift_types(id) ON DELETE CASCADE,
  days_of_week integer[],
  role text,
  mode text NOT NULL DEFAULT 'min_veterans' CHECK (mode IN ('all_veterans', 'min_veterans')),
  min_count integer CHECK (min_count IS NULL OR min_count >= 1),
  season_start date,
  season_end date,
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shift_experience_rules_company_active_idx
  ON public.shift_experience_rules (company_id, active);

ALTER TABLE public.shift_experience_rules ENABLE ROW LEVEL SECURITY;

-- Same-company access, mirroring the events table policy (010).
DROP POLICY IF EXISTS "Company shift experience rules access" ON public.shift_experience_rules;
CREATE POLICY "Company shift experience rules access"
  ON public.shift_experience_rules FOR ALL
  USING (company_id IN (
    SELECT company_id FROM public.users
    WHERE id = auth.uid()
  ))
  WITH CHECK (company_id IN (
    SELECT company_id FROM public.users
    WHERE id = auth.uid()
  ));
