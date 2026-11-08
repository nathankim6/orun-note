-- App crash / error diagnostics (written only by the docs Edge Function with the service role; never readable by clients).
create table if not exists public.crash_reports (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  happened_at timestamptz,
  kind text not null,            -- java | exit | js | render
  app_version text, platform text, device text, who text,
  detail text not null
);
create index if not exists crash_reports_created_idx on public.crash_reports (created_at desc);
alter table public.crash_reports enable row level security;
