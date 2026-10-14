-- pgTAP tests for the foundation migration. Run with: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

-- RLS is on for every foundation table
select ok(relrowsecurity, format('RLS enabled on %s', relname))
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('profiles', 'user_roles', 'locations', 'events')
order by relname;

-- Two users created through auth trigger
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values
  ('11111111-1111-4111-8111-111111111111', 'runner.a@example.test', '{"display_name":"Runner A"}', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'runner.b@example.test', '{}', 'authenticated', 'authenticated');

select is(
  (select display_name from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'Runner A',
  'sign-up trigger creates a profile from metadata'
);

select is(
  (select array_agg(role)::text from public.user_roles where user_id = '22222222-2222-4222-8222-222222222222'),
  '{runner}',
  'sign-up trigger grants the runner role'
);

-- Act as runner A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select is((select count(*)::int from public.profiles), 1, 'runner sees only their own profile');

select throws_ok(
  $$ insert into public.user_roles (user_id, role) values ('11111111-1111-4111-8111-111111111111', 'admin') $$,
  '42501',
  null,
  'runner cannot grant themselves admin'
);

update public.profiles set display_name = 'Hacked' where id = '22222222-2222-4222-8222-222222222222';
reset role;
select is(
  (select display_name from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  'runner.b',
  'runner cannot update another profile'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select throws_ok(
  $$ insert into public.locations (name, latitude, longitude) values ('X', 1, 1) $$,
  '42501',
  null,
  'runner cannot create locations'
);

-- Anonymous visitors see published events only
reset role;
insert into public.events (title, starts_at, ends_at, status)
values ('Draft run', now() + interval '1 day', now() + interval '1 day 1 hour', 'draft');
set local role anon;
select is(
  (select count(*)::int from public.events where status <> 'published'),
  0,
  'anon cannot see draft events'
);

reset role;
select * from finish();
rollback;
