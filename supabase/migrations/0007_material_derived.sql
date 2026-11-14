-- Pre-rendered page images (see docs/derived-pages.md). null = not generated yet.
alter table public.materials add column if not exists derived jsonb;
-- derived page images + word boxes are stored next to the PDFs
update storage.buckets set allowed_mime_types = array['application/pdf','image/jpeg','application/json','image/webp'] where id = 'materials';
