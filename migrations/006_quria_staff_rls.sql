-- ============================================================
-- 006 — quria_staff RLS
-- ============================================================
-- Allow authenticated users to check if their own email exists
-- in quria_staff (read-only, own row only). Without this policy,
-- the useQuria hook returns false for actual Quria staff because
-- the SELECT is blocked by the absence of a policy.
-- ============================================================

ALTER TABLE public.quria_staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can check their own Quria status"
ON public.quria_staff
FOR SELECT
TO authenticated
USING (email = auth.email());
