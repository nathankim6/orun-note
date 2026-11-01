// Public (anon) Supabase credentials. The anon key has no table access; all reads/writes go through the `docs` Edge Function.
export const SUPABASE_URL = 'https://waywqmxmruhxcpsnnwbr.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_xOYWRDjpe7UkPpsWeOrw6Q_J3tJalFY';
export const DOCS_FN = `${SUPABASE_URL}/functions/v1/docs`;
export const APP_NAME = '옳은Note';
