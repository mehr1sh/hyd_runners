-- HYD Runners local demo data: remove shared objects the demo seed created.
-- LOCAL DEVELOPMENT ONLY; run by `pnpm demo:reset`, which then deletes the
-- demo accounts themselves (their own rows go with them by cascade).
-- Only rows with demo ids, or authored by demo accounts, are touched.

\set ON_ERROR_STOP on

create function pg_temp.is_demo(id uuid) returns boolean language sql immutable as $$
  select id::text ~ '^de[0-9]{6}-0000-4000-8000-[0-9]{12}$'
$$;
create temp table demo_people as
  select id from auth.users where raw_app_meta_data ->> 'demo' = 'true' and email like '%@demo.hydrunners.test';

-- Runs created by the series scheduler have random ids but demo series.
delete from public.events where pg_temp.is_demo(id)
   or series_id in (select id from public.group_run_series where pg_temp.is_demo(id));
delete from public.group_run_series where pg_temp.is_demo(id);
delete from public.challenges where pg_temp.is_demo(id);
delete from public.leagues where pg_temp.is_demo(id);
delete from public.squads where pg_temp.is_demo(id);
delete from public.clubs where pg_temp.is_demo(id);
-- These reference their author without cascading.
delete from public.announcements where author_id in (select id from demo_people);
delete from public.location_updates where author_id in (select id from demo_people);
delete from public.feedback_replies where author_id in (select id from demo_people);
