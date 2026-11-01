-- 옳은Note v1.2: students come from orunhomework.com (live), identity is a Google account linked to a student code.
create table if not exists public.student_links (
  student_id uuid primary key,            -- orunhomework students.id
  student_code text not null,             -- orunhomework access_codes.code at link time (re-verified live)
  student_name text not null default '',
  email text not null unique,             -- Google account email (lowercase)
  auth_user_id uuid,                      -- Supabase auth user id
  linked_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create table if not exists public.email_change_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  student_code text not null,
  student_name text not null default '',
  old_email text not null,
  new_email text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists email_change_requests_status_idx on public.email_change_requests(status, created_at desc);
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  target_type text not null check (target_type in ('all','school','grade','student')),
  target_id uuid,                          -- orunhomework schools.id / grades.id / students.id (null for 'all')
  created_at timestamptz not null default now(),
  unique (material_id, target_type, target_id)
);
create index if not exists assignments_target_idx on public.assignments(target_type, target_id);
create table if not exists public.admin_emails (
  email text primary key,
  label text not null default '',
  created_at timestamptz not null default now()
);
alter table public.student_links enable row level security;
alter table public.email_change_requests enable row level security;
alter table public.assignments enable row level security;
alter table public.admin_emails enable row level security;
revoke all on public.student_links, public.email_change_requests, public.assignments, public.admin_emails from anon, authenticated;
