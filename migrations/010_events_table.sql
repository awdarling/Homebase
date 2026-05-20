-- ============================================================
-- 010 — events table for Special Notes
-- ============================================================
-- The Special Notes tab (src/app/(app)/data/tabs/SpecialNotesTab.tsx)
-- writes anything outside normal operations that Aegis should
-- know — events, manager preferences, one-off staffing rules.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title text NOT NULL,
  date date,
  end_date date,
  description text,
  event_type text NOT NULL DEFAULT 'general',
  staffing_notes text,
  shift_overrides jsonb,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Postgres doesn't support `CREATE POLICY IF NOT EXISTS`; use
-- DROP+CREATE for idempotence.
DROP POLICY IF EXISTS "Company events access" ON public.events;
CREATE POLICY "Company events access"
  ON public.events FOR ALL
  USING (company_id IN (
    SELECT company_id FROM public.users
    WHERE id = auth.uid()
  ))
  WITH CHECK (company_id IN (
    SELECT company_id FROM public.users
    WHERE id = auth.uid()
  ));
