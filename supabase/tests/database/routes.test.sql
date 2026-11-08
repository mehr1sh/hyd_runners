-- pgTAP: routes (migration 20261113120000_routes): geometry-derived values,
-- provenance and verification, contributor permissions, reviews, condition
-- reports and the curated OSM seed.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('7a000000-0000-4000-8000-0000000000d1', 'rt.m@example.test', '{"display_name":"Rt Manager"}', 'authenticated', 'authenticated'),
  ('7a000000-0000-4000-8000-0000000000a1', 'rt.c@example.test', '{"display_name":"Rt Club Admin"}', 'authenticated', 'authenticated'),
  ('7a000000-0000-4000-8000-0000000000a2', 'rt.r@example.test', '{"display_name":"Rt Runner"}', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values ('7a000000-0000-4000-8000-0000000000d1', 'programme_manager');
insert into public.clubs (id, slug, name) values ('7a000000-0000-4000-8000-0000000000c1', 'rt-club', 'Rt Club');
insert into public.club_members (club_id, user_id, role, status, joined_at)
values ('7a000000-0000-4000-8000-0000000000c1', '7a000000-0000-4000-8000-0000000000a1', 'admin', 'active', now());

-- A ~1.1 km out-and-back line in Hyderabad and a ~600 m square loop.
create temp table fixture (k text, wkt text);
insert into fixture values
  ('line', 'SRID=4326;LINESTRING(78.4200 17.4200, 78.4300 17.4200)'),
  ('loop', 'SRID=4326;LINESTRING(78.4200 17.4200, 78.4214 17.4200, 78.4214 17.4214, 78.4200 17.4214, 78.4200 17.4200)'),
  ('mumbai', 'SRID=4326;LINESTRING(72.8700 19.0700, 72.8800 19.0700)'),
  ('tiny', 'SRID=4326;LINESTRING(78.4200 17.4200, 78.4201 17.4200)');
grant select on fixture to authenticated;

-- ---------------------------------------------------------------- who may create
select pg_temp.act_as('7a000000-0000-4000-8000-0000000000a2');
select throws_ok(
  $$ insert into public.routes (slug, name, path, source, source_ref, source_attribution)
     values ('runner-route', 'Runner route', (select wkt from fixture where k = 'line')::extensions.geography, 'gpx', 'my.gpx', 'Uploaded GPX') $$,
  '42501', null, 'runners cannot create routes');

select pg_temp.act_as('7a000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$ insert into public.routes (slug, name, path, source, source_ref, source_attribution, distance_m)
     values ('club-fake', 'Club fake', (select wkt from fixture where k = 'line')::extensions.geography, 'gpx', 'club.gpx', 'GPX', 1) $$,
  '42501', null, 'clients cannot send a distance');
select lives_ok(
  $$ insert into public.routes (id, slug, name, path, source, source_ref, source_attribution)
     values ('7a000000-0000-4000-8000-0000000000f1', 'club-draft', 'Club draft', (select wkt from fixture where k = 'line')::extensions.geography,
             'gpx', 'club.gpx', 'GPX recorded by the club') $$,
  'a club admin submits a draft route');
select throws_ok(
  $$ insert into public.routes (slug, name, path, source, source_ref, source_attribution, status)
     values ('club-published', 'Club published', (select wkt from fixture where k = 'line')::extensions.geography, 'gpx', 'x.gpx', 'GPX', 'published') $$,
  '42501', null, 'club admins cannot publish');
select throws_ok(
  $$ update public.routes set verified = true where id = '7a000000-0000-4000-8000-0000000000f1' $$,
  '42501', null, 'club admins cannot verify');
select is((select created_by::text from public.routes where id = '7a000000-0000-4000-8000-0000000000f1'), '7a000000-0000-4000-8000-0000000000a1',
  'the author is recorded by the database');

-- ---------------------------------------------------------------- derived values
select ok((select distance_m between 1050 and 1070 from public.routes where id = '7a000000-0000-4000-8000-0000000000f1'),
  'distance is computed from the geometry');
select is((select is_loop from public.routes where id = '7a000000-0000-4000-8000-0000000000f1'), false, 'a line is not a loop');
select throws_ok(
  $$ insert into public.routes (slug, name, path, source, source_ref, source_attribution)
     values ('mumbai-route', 'Elsewhere', (select wkt from fixture where k = 'mumbai')::extensions.geography, 'gpx', 'x.gpx', 'GPX') $$,
  '23514', 'Routes must be in the Hyderabad area', 'routes outside Hyderabad are rejected');
select throws_ok(
  $$ insert into public.routes (slug, name, path, source, source_ref, source_attribution)
     values ('tiny-route', 'Tiny', (select wkt from fixture where k = 'tiny')::extensions.geography, 'gpx', 'x.gpx', 'GPX') $$,
  '23514', 'Routes must be between 200 m and 100 km long', 'very short routes are rejected');

-- ---------------------------------------------------------------- visibility and review
select pg_temp.act_as('7a000000-0000-4000-8000-0000000000a2');
select is((select count(*)::int from public.routes where id = '7a000000-0000-4000-8000-0000000000f1'), 0, 'drafts are hidden from runners');
select pg_temp.act_as('7a000000-0000-4000-8000-0000000000d1');
select is((select count(*)::int from public.routes where id = '7a000000-0000-4000-8000-0000000000f1'), 1, 'managers see drafts');
select lives_ok($$ update public.routes set status = 'published', verified = true, beginner_suitable = true where id = '7a000000-0000-4000-8000-0000000000f1' $$,
  'a manager publishes and verifies a route');
select is((select verified_by::text from public.routes where id = '7a000000-0000-4000-8000-0000000000f1'), '7a000000-0000-4000-8000-0000000000d1',
  'verification is stamped with the manager');
select lives_ok(
  $$ insert into public.routes (id, slug, name, path, source, source_ref, source_attribution, status)
     values ('7a000000-0000-4000-8000-0000000000f2', 'square-loop', 'Square loop', (select wkt from fixture where k = 'loop')::extensions.geography,
             'gpx', 'loop.gpx', 'GPX', 'published') $$,
  'a manager publishes a loop');
select is((select is_loop from public.routes where id = '7a000000-0000-4000-8000-0000000000f2'), true, 'a closed path is a loop');
select is((select verified from public.routes where id = '7a000000-0000-4000-8000-0000000000f2'), false, 'routes are unverified unless marked');
select is((select (public.route_geojson(r) ->> 'type') from public.routes r where id = '7a000000-0000-4000-8000-0000000000f2'), 'LineString',
  'routes are served as GeoJSON lines');

select pg_temp.act_as('7a000000-0000-4000-8000-0000000000a2');
select is((select count(*)::int from public.routes where id::text like '7a000000-%'), 2, 'runners see published routes');
update public.routes set name = 'Hijacked' where id = '7a000000-0000-4000-8000-0000000000f2';
reset role;
select is((select name from public.routes where id = '7a000000-0000-4000-8000-0000000000f2'), 'Square loop', 'runners cannot edit routes');

-- ---------------------------------------------------------------- reviews and reports
select pg_temp.act_as('7a000000-0000-4000-8000-0000000000a2');
select lives_ok(
  $$ insert into public.route_reviews (route_id, user_id, rating, shade, comment)
     values ('7a000000-0000-4000-8000-0000000000f2', '7a000000-0000-4000-8000-0000000000a2', 4, 2, 'Little shade after 8 am') $$,
  'a runner reviews a published route');
select throws_ok(
  $$ insert into public.route_reviews (route_id, user_id, rating) values ('7a000000-0000-4000-8000-0000000000f2', '7a000000-0000-4000-8000-0000000000d1', 1) $$,
  '42501', null, 'nobody reviews on someone else''s behalf');
select is((select reviews::int || ':' || rating::text || ':' || shade::text from public.route_review_summary(array['7a000000-0000-4000-8000-0000000000f2'::uuid])),
  '1:4.0:2.0', 'the summary averages each aspect');
select is((select comment from public.route_review_comments('7a000000-0000-4000-8000-0000000000f2')), 'Little shade after 8 am',
  'comments are shown');
select lives_ok(
  $$ insert into public.route_reports (route_id, reporter_id, kind, note)
     values ('7a000000-0000-4000-8000-0000000000f2', '7a000000-0000-4000-8000-0000000000a2', 'construction', 'Pipe works near the east side') $$,
  'a runner reports construction');
select is((select expires_at > now() + interval '13 days' from public.route_reports where route_id = '7a000000-0000-4000-8000-0000000000f2'), true,
  'reports expire after two weeks unless renewed');
update public.route_reports set resolved_at = now() where route_id = '7a000000-0000-4000-8000-0000000000f2';
reset role;
select is((select resolved_at from public.route_reports where route_id = '7a000000-0000-4000-8000-0000000000f2'), null,
  'runners cannot resolve reports');

-- ---------------------------------------------------------------- curated OSM seed
select is((select count(*)::int from public.routes where id::text like '5eed0005-%' and source = 'osm' and status = 'published'
             and not verified and source_attribution like '%OpenStreetMap%' and surface = 'unknown'), 2,
  'the curated routes are attributed OSM traces, published but not verified, with unknown surfaces');
select is((select round(distance_m)::int || '/' || is_loop::text from public.routes where slug = 'bachupally-jogging-track'), '373/true',
  'the Bachupally track is a 373 m loop');
select is((select count(*)::int from public.routes where id::text like '5eed0005-%' and created_by is null), 2,
  'the curated routes have no fabricated author');

select * from finish();
rollback;
