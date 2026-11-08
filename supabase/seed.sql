-- Local development seed data. Runs on `supabase db reset` only.
-- Sample locations and events come from the migration
-- 20261108150000_sample_community_content.sql. This adds one event dated
-- relative to today so local and CI test runs always have an upcoming event.

insert into public.events (id, title, description, starts_at, ends_at, location_id, capacity, status) values
  ('00000000-0000-4000-8000-000000000201', 'Sample: Beginner walk-run', 'Placeholder event for local development.',
   (date_trunc('week', now()) + interval '12 days 0 hours 30 minutes'),
   (date_trunc('week', now()) + interval '12 days 1 hour 30 minutes'),
   '5eed0001-0000-4000-8000-000000000001', 40, 'published');
