-- ============================================================
-- 004 — activity_log: actor_name + quria_admin actor
-- ============================================================
-- Adds an actor_name column so the activity feed can display
-- the actual person who performed an action (instead of just
-- their role) and extends the actor enum to include
-- 'quria_admin' for platform-level Quria actions.
-- ============================================================

alter table public.activity_log
  add column if not exists actor_name text;

-- Replace the actor CHECK constraint to allow 'quria_admin'.
do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.activity_log'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%actor%';

  if constraint_name is not null then
    execute format('alter table public.activity_log drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.activity_log
  add constraint activity_log_actor_check
  check (actor in ('aegis', 'manager', 'soteria', 'system', 'quria_admin'));
