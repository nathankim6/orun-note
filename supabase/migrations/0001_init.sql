-- 옳은Docs: access codes, materials, assignments. All access goes through the `docs` Edge Function (service role);
-- RLS is enabled with no policies so the anon key cannot read or write these tables directly.
create extension if not exists pgcrypto;
create table if not exists public.access_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  file_name text not null default '',
  storage_path text not null,
  size bigint not null default 0,
  pages int not null default 0,
  ready boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.code_materials (
  code_id uuid not null references public.access_codes(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (code_id, material_id)
);
create table if not exists public.access_log (
  id bigserial primary key, code text, action text, ok boolean, at timestamptz not null default now()
);
alter table public.access_codes enable row level security;
alter table public.materials enable row level security;
alter table public.code_materials enable row level security;
alter table public.access_log enable row level security;
revoke all on public.access_codes, public.materials, public.code_materials, public.access_log from anon, authenticated;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('materials', 'materials', false, 52428800, array['application/pdf'])
  on conflict (id) do nothing;
