-- ============================================================
-- 007 — activity_log: actor_avatar_url
-- ============================================================
-- Stores the avatar URL of the human actor at the moment the
-- activity was recorded so the activity feed can display real
-- profile pictures without joining to the users table at read
-- time and without breaking if the user later changes avatars.
-- ============================================================

alter table public.activity_log
  add column if not exists actor_avatar_url text;
