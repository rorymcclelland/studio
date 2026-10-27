-- Supabase security advisor (lint 0011): give the trigger function a fixed,
-- empty search_path so it cannot be redirected by a caller's search_path.
-- now() resolves from pg_catalog, which is always searched.
alter function public.touch_updated_at() set search_path = '';
