-- Recorded activities: runs recorded by the HYD Runners mobile app
-- (workstream J, POST /api/v1/activities/recorded).
--
-- * The app gives every recording a client-generated UUID (client_ref) and
--   retries uploads until the server confirms. One runner's client_ref maps to
--   at most one activity, so a retry can never insert the run twice.
-- * Recorded runs go through finalize_activity_import() like GPX/FIT imports
--   (same metrics, best efforts, privacy trim and duplicate detection); their
--   source_format and import_source are 'app'.
-- * Runners may set client_ref and import_source only when registering their
--   own activity (RLS "activities: register own upload" still applies); they
--   can never change them afterwards, and metrics stay service-role only.

alter table public.activities add column client_ref uuid;

alter table public.activities drop constraint activities_import_source_check;
alter table public.activities
  add constraint activities_import_source_check check (import_source in ('upload', 'app'));

alter table public.activities drop constraint activities_source_format_check;
alter table public.activities
  add constraint activities_source_format_check check (source_format in ('gpx', 'fit', 'app'));

-- A client_ref only ever identifies an app recording.
alter table public.activities
  add constraint activities_client_ref_is_app check (client_ref is null or import_source = 'app');

create unique index activities_user_client_ref_key on public.activities (user_id, client_ref)
  where client_ref is not null;

-- Insert only (no update grant): the reference is fixed once registered.
grant insert (client_ref, import_source) on public.activities to authenticated;
