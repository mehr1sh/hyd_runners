-- pgTAP: route search (migration 20261117120000_route_search): RLS still
-- applies, every typed filter, near-me radius, ratings, open condition
-- reports, sort orders and input validation. Free text is treated as data.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('7b000000-0000-4000-8000-0000000000a1', 'rs.a@example.test', '{"display_name":"Rs Author"}', 'authenticated', 'authenticated'),
  ('7b000000-0000-4000-8000-0000000000a2', 'rs.r@example.test', '{"display_name":"Rs Runner"}', 'authenticated', 'authenticated'),
  ('7b000000-0000-4000-8000-0000000000a3', 'rs.s@example.test', '{"display_name":"Rs Second"}', 'authenticated', 'authenticated');

-- Four published routes and one draft, all named "Zqsearch …" so the seed
-- data never interferes. A: 1.06 km flat lit loop at KBR-ish coordinates;
-- B: ~2.1 km hilly trail 3 km east; C: ~5.3 km road far away; D: archived; E: draft.
insert into public.routes (id, slug, name, area, path, source, source_ref, source_attribution, status, is_loop, terrain,
                           surface, lighting, shade, beginner_suitable, water_refill, toilets, verified, created_by)
values
  ('7b000000-0000-4000-8000-0000000000f1', 'zq-a', 'Zqsearch Alpha', 'Banjara Hills',
   'SRID=4326;LINESTRING(78.4200 17.4200, 78.4300 17.4200)', 'gpx', 'a.gpx', 'GPX', 'published', true, 'flat',
   'road', 'lit', 'good', true, true, true, false, null),
  ('7b000000-0000-4000-8000-0000000000f2', 'zq-b', 'Zqsearch Bravo', 'Jubilee Hills',
   'SRID=4326;LINESTRING(78.4500 17.4200, 78.4700 17.4200)', 'gpx', 'b.gpx', 'GPX', 'published', false, 'hilly',
   'trail', 'unlit', 'little', false, null, null, false, null),
  ('7b000000-0000-4000-8000-0000000000f3', 'zq-c', 'Zqsearch Charlie 100%_off', 'Gachibowli',
   'SRID=4326;LINESTRING(78.3000 17.4400, 78.3500 17.4400)', 'gpx', 'c.gpx', 'GPX', 'published', false, 'rolling',
   'road', 'partly_lit', 'some', null, null, null, false, null),
  ('7b000000-0000-4000-8000-0000000000f4', 'zq-d', 'Zqsearch Delta', null,
   'SRID=4326;LINESTRING(78.4200 17.4200, 78.4300 17.4200)', 'gpx', 'd.gpx', 'GPX', 'archived', false, 'flat',
   'road', 'lit', 'good', true, true, true, false, null),
  ('7b000000-0000-4000-8000-0000000000f5', 'zq-e', 'Zqsearch Echo', null,
   'SRID=4326;LINESTRING(78.4200 17.4200, 78.4300 17.4200)', 'gpx', 'e.gpx', 'GPX', 'draft', false, 'flat',
   'road', 'lit', 'good', true, true, true, false, '7b000000-0000-4000-8000-0000000000a1');
update public.routes set verified = true, verified_by = '7b000000-0000-4000-8000-0000000000a1', verified_at = now()
  where id in ('7b000000-0000-4000-8000-0000000000f1', '7b000000-0000-4000-8000-0000000000f4');
insert into public.route_reviews (route_id, user_id, rating) values
  ('7b000000-0000-4000-8000-0000000000f1', '7b000000-0000-4000-8000-0000000000a2', 5),
  ('7b000000-0000-4000-8000-0000000000f1', '7b000000-0000-4000-8000-0000000000a3', 4),
  ('7b000000-0000-4000-8000-0000000000f2', '7b000000-0000-4000-8000-0000000000a2', 3);
insert into public.route_reports (route_id, reporter_id, kind, note) values
  ('7b000000-0000-4000-8000-0000000000f2', '7b000000-0000-4000-8000-0000000000a2', 'closure', 'Gate locked');
insert into public.route_reports (route_id, reporter_id, kind, note, resolved_at) values
  ('7b000000-0000-4000-8000-0000000000f1', '7b000000-0000-4000-8000-0000000000a2', 'hazard', 'Old pothole', now());

create temp table r (k text, v text);
grant all on r to authenticated;
create function pg_temp.q(k text, sql text) returns void language plpgsql as $$
declare v text;
begin
  execute format('select coalesce(string_agg(ro.name, %L order by s.ord), %L) from
    (select id, row_number() over () as ord from (%s) x) s join public.routes ro using (id)', ',', '', sql) into v;
  insert into r values (k, v);
end $$;

select pg_temp.act_as('7b000000-0000-4000-8000-0000000000a2');
select pg_temp.q('all', $$ select id from public.search_routes(p_text => 'zqsearch', p_sort => 'name') $$);
select pg_temp.q('flat', $$ select id from public.search_routes(p_text => 'zqsearch', p_terrain => array['flat']) $$);
select pg_temp.q('trail_or_rolling', $$ select id from public.search_routes(p_text => 'zqsearch', p_terrain => array['hilly', 'rolling'], p_sort => 'name') $$);
select pg_temp.q('2to6', $$ select id from public.search_routes(p_text => 'zqsearch', p_min_m => 2000, p_max_m => 6000, p_sort => 'distance_asc') $$);
select pg_temp.q('longest', $$ select id from public.search_routes(p_text => 'zqsearch', p_sort => 'distance_desc') $$);
select pg_temp.q('facilities', $$ select id from public.search_routes(p_text => 'zqsearch', p_beginner => true,
  p_verified => true, p_water => true, p_toilets => true, p_lighting => array['lit'], p_shade => array['good']) $$);
select pg_temp.q('near', $$ select id from public.search_routes(p_text => 'zqsearch', p_near_lat => 17.42, p_near_lon => 78.421,
  p_radius_m => 5000, p_sort => 'nearest') $$);
select pg_temp.q('near_small', $$ select id from public.search_routes(p_text => 'zqsearch', p_near_lat => 17.42, p_near_lon => 78.421,
  p_radius_m => 500) $$);
select pg_temp.q('rating', $$ select id from public.search_routes(p_text => 'zqsearch', p_min_rating => 4) $$);
select pg_temp.q('by_rating', $$ select id from public.search_routes(p_text => 'zqsearch', p_sort => 'rating') $$);
select pg_temp.q('no_reports', $$ select id from public.search_routes(p_text => 'zqsearch', p_no_open_reports => true, p_sort => 'name') $$);
select pg_temp.q('area', $$ select id from public.search_routes(p_text => 'zqsearch jubilee') $$);
select pg_temp.q('relevance', $$ select id from public.search_routes(p_text => 'zqsearch bravo') $$);
select pg_temp.q('wild', $$ select id from public.search_routes(p_text => '100%_') $$);
select pg_temp.q('pct', $$ select id from public.search_routes(p_text => '%') $$);

select is((select v from r where k = 'all'), 'Zqsearch Alpha,Zqsearch Bravo,Zqsearch Charlie 100%_off',
  'runners find published routes only: no archived routes and no one else''s drafts');
select is((select v from r where k = 'flat'), 'Zqsearch Alpha', 'terrain filter');
select is((select v from r where k = 'trail_or_rolling'), 'Zqsearch Bravo,Zqsearch Charlie 100%_off', 'several values of one attribute are OR-ed');
select is((select v from r where k = '2to6'), 'Zqsearch Bravo,Zqsearch Charlie 100%_off', 'distance range, shortest first');
select is((select v from r where k = 'longest'), 'Zqsearch Charlie 100%_off,Zqsearch Bravo,Zqsearch Alpha', 'longest first');
select is((select v from r where k = 'facilities'), 'Zqsearch Alpha', 'beginner, verified, water, toilets, lighting and shade filters combine');
select is((select v from r where k = 'near'), 'Zqsearch Alpha,Zqsearch Bravo', 'near a point within the radius, nearest start first');
select is((select v from r where k = 'near_small'), 'Zqsearch Alpha', 'a smaller radius excludes routes starting further away');
select is((select v from r where k = 'rating'), 'Zqsearch Alpha', 'minimum rating uses the review average (4.5)');
select is((select v from r where k = 'by_rating'), 'Zqsearch Alpha,Zqsearch Bravo,Zqsearch Charlie 100%_off', 'highest rated first, unrated last');
select is((select v from r where k = 'no_reports'), 'Zqsearch Alpha,Zqsearch Charlie 100%_off', 'routes with open condition reports can be excluded; resolved ones do not count');
select is((select v from r where k = 'area'), 'Zqsearch Bravo', 'free text matches the area');
select is((select v from r where k = 'relevance'), 'Zqsearch Bravo', 'all words must match');
select is((select v from r where k = 'wild'), 'Zqsearch Charlie 100%_off', 'LIKE wildcards in search text are matched literally');
select is((select v from r where k = 'pct'), 'Zqsearch Charlie 100%_off', 'a lone % does not match everything');
select is((select open_reports from public.search_routes(p_text => 'zqsearch bravo')), 1::bigint, 'open reports are counted');

select throws_ok($$ select * from public.search_routes(p_terrain => array['lava']) $$, '22023', 'Unknown route attribute.', 'unknown attribute values are rejected');
select throws_ok($$ select * from public.search_routes(p_sort => 'name; drop table routes') $$, '22023', 'Unknown sort order.', 'unknown sort orders are rejected');
select throws_ok($$ select * from public.search_routes(p_near_lat => 17.4) $$, '22023', 'Invalid search location.', 'a half location is rejected');
select throws_ok($$ select * from public.search_routes(p_radius_m => 1000000) $$, '22023', null, 'the radius is capped');
select throws_ok($$ select * from public.search_routes(p_text => repeat('a', 201)) $$, '22023', null, 'search text is capped at 200 characters');

select pg_temp.act_as('7b000000-0000-4000-8000-0000000000a1');
select is((select count(*) from public.search_routes(p_text => 'zqsearch echo')), 1::bigint, 'authors find their own drafts');

select * from finish();
rollback;
