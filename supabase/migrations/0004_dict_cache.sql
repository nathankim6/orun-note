create table if not exists public.dict_cache (q text primary key, data jsonb not null, created_at timestamptz not null default now());
alter table public.dict_cache enable row level security;
revoke all on public.dict_cache from anon, authenticated;
