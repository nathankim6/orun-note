-- Pre-rendered page images (see docs/derived-pages.md). null = not generated yet.
alter table public.materials add column if not exists derived jsonb;
