-- Store releases not discoverable through a public version API (Google Play).
-- Populate only AFTER a release is available to existing users, never after merely building an AAB.
create table if not exists public.app_update_releases (
  channel text primary key check (channel in ('android-play')),
  version text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  url text not null check (url = 'https://play.google.com/store/apps/details?id=com.paperly.study'),
  published_at timestamptz not null,
  enabled boolean not null default false
);
alter table public.app_update_releases enable row level security;
revoke all on public.app_update_releases from anon, authenticated;

-- Shared source cache + atomic refresh lease prevents a whole class launching together
-- from exhausting Apple's/GitHub's public API limits. No user data is stored here.
create table if not exists public.app_update_cache (
  channel text primary key check (channel in ('ios','android-apk','android-play','windows','mac')),
  release jsonb,
  checked_at timestamptz,
  refresh_after timestamptz not null default '1970-01-01T00:00:00Z'
);
alter table public.app_update_cache enable row level security;
revoke all on public.app_update_cache from anon, authenticated;
insert into public.app_update_cache(channel) values ('ios'),('android-apk'),('android-play'),('windows'),('mac') on conflict do nothing;
