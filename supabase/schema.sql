-- ============================================================
-- HOMEBASE — COMPLETE DATABASE SCHEMA
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- COMPANIES
-- One row per client business
-- ============================================================
create table companies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  industry text,
  timezone text not null default 'America/New_York',
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- USERS
-- Managers who log into Homebase
-- ============================================================
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  email text not null,
  name text not null,
  role text not null default 'manager',
  created_at timestamptz not null default now()
);

-- ============================================================
-- EMPLOYEES
-- The workforce Aegis operates against
-- ============================================================
create table employees (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  primary_role text not null,
  qualified_roles text[] not null default '{}',
  max_weekly_hours integer not null default 40,
  contact_phone text,
  contact_email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- AVAILABILITY
-- When each employee can work
-- ============================================================
create table availability (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid not null references employees(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  day_of_week integer not null check (day_of_week >= 0 and day_of_week <= 6),
  start_time time not null,
  end_time time not null,
  unique(employee_id, day_of_week)
);

-- ============================================================
-- TIME OFF REQUESTS
-- Pending and decided time-off
-- ============================================================
create table time_off_requests (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid not null references employees(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references users(id)
);

-- ============================================================
-- SHIFT REQUIREMENTS
-- What roles + counts are needed per shift
-- ============================================================
create table shift_requirements (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  shift_name text not null,
  role text not null,
  required_count integer not null default 1,
  start_time time not null,
  end_time time not null,
  days_active integer[] not null default '{0,1,2,3,4,5,6}'
);

-- ============================================================
-- SCHEDULES
-- AI-generated weekly schedules
-- ============================================================
create table schedules (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  generated_at timestamptz not null default now(),
  generated_by text not null default 'aegis' check (generated_by in ('aegis', 'manager')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  data jsonb not null default '{}'
);

-- ============================================================
-- POLICIES
-- Company rules that Aegis must follow
-- ============================================================
create table policies (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  policy_key text not null,
  policy_value text not null,
  policy_type text not null check (policy_type in ('hours', 'fairness', 'eligibility', 'overtime', 'custom')),
  description text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  unique(company_id, policy_key)
);

-- ============================================================
-- ACTIVITY LOG
-- Every action taken by Aegis, managers, or the system
-- ============================================================
create table activity_log (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  actor text not null check (actor in ('aegis', 'manager', 'soteria', 'system')),
  action text not null,
  entity_type text,
  entity_id uuid,
  summary text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- AEGIS CONVERSATIONS
-- All messages in and out of Aegis
-- ============================================================
create table aegis_conversations (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  direction text not null check (direction in ('inbound', 'outbound')),
  content text not null,
  processed boolean not null default false,
  thread_id text,
  from_address text,
  to_address text,
  subject text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Ensures users only see their own company's data
-- ============================================================

alter table companies enable row level security;
alter table users enable row level security;
alter table employees enable row level security;
alter table availability enable row level security;
alter table time_off_requests enable row level security;
alter table shift_requirements enable row level security;
alter table schedules enable row level security;
alter table policies enable row level security;
alter table activity_log enable row level security;
alter table aegis_conversations enable row level security;

-- Helper function: get the company_id for the current logged-in user
create or replace function get_my_company_id()
returns uuid
language sql
security definer
as $$
  select company_id from users where id = auth.uid()
$$;

-- Companies: users can only see their own company
create policy "Users see own company"
  on companies for select
  using (id = get_my_company_id());

-- Users: users can only see users in their company
create policy "Users see own company users"
  on users for select
  using (company_id = get_my_company_id());

create policy "Users can update own profile"
  on users for update
  using (id = auth.uid());

-- Employees
create policy "Company employees access"
  on employees for all
  using (company_id = get_my_company_id());

-- Availability
create policy "Company availability access"
  on availability for all
  using (company_id = get_my_company_id());

-- Time off requests
create policy "Company time off access"
  on time_off_requests for all
  using (company_id = get_my_company_id());

-- Shift requirements
create policy "Company shift requirements access"
  on shift_requirements for all
  using (company_id = get_my_company_id());

-- Schedules
create policy "Company schedules access"
  on schedules for all
  using (company_id = get_my_company_id());

-- Policies
create policy "Company policies access"
  on policies for all
  using (company_id = get_my_company_id());

-- Activity log
create policy "Company activity access"
  on activity_log for all
  using (company_id = get_my_company_id());

-- Aegis conversations
create policy "Company conversations access"
  on aegis_conversations for all
  using (company_id = get_my_company_id());

-- ============================================================
-- SEED: Watermark Country Club
-- First client — we'll populate real data in Phase 2
-- ============================================================
insert into companies (id, name, industry, timezone, onboarding_complete)
values (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Watermark Country Club',
  'Hospitality',
  'America/Detroit',
  false
);
