-- ============================================================
-- 017 — users.access_revoked_at  (soft-revoke for Homebase access)
-- ============================================================
-- Why: revoking a Homebase user used to be a client-side DELETE that the
-- database's row-level security silently blocked — so the user was never
-- actually removed (the "confirmed but still listed" bug), and even when the
-- profile row did delete, the underlying login account survived.
--
-- New model: revocation runs server-side via /api/revoke-user (service role)
-- and STAMPS this column instead of deleting the account. Keeping the account
-- (marked revoked) lets the app still recognize the person at sign-in and show
-- a clear "your access has been removed — contact your administrator" message,
-- while the middleware blocks them from every protected page immediately.
--
--   access_revoked_at = NULL        -> active user
--   access_revoked_at = <timestamp> -> revoked (locked out, shown the message)
--
-- Re-adding / restoring access = set this back to NULL (or re-add the user).
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS access_revoked_at timestamptz;

-- Fast filter for the active-users list (the access page hides revoked rows).
CREATE INDEX IF NOT EXISTS users_access_revoked_idx
  ON public.users (access_revoked_at);

-- NOTE: revocation no longer relies on a client DELETE — it goes through the
-- service-role route, which bypasses RLS. Existing users SELECT/UPDATE policies
-- are unchanged. (If you later want to hard-block client deletes entirely, add a
-- `FOR DELETE USING (false)` policy here, mirroring migration 014 for schedules.)
