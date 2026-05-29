-- One-time repair: heal shift_requirements.days_active drift by copying parent shift_type.days_active.
-- The column is dormant in the Aegis engine but kept for analytics/rollback safety.
-- Run manually in Supabase SQL Editor; no automated execution.

UPDATE public.shift_requirements
SET days_active = st.days_active
FROM public.shift_types st
WHERE shift_requirements.shift_type_id = st.id
  AND shift_requirements.shift_type_id IS NOT NULL;
