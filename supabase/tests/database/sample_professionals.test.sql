-- pgTAP: sample professionals (migration 20261201120000_sample_professionals):
-- only listed, unverified or pending profiles of accounts flagged demo in
-- app metadata are returned; user metadata cannot opt in; verified
-- profiles never appear; anonymous callers cannot call it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- D: demo, pending. E: demo, unlisted. F: demo, verified. G: real account.
-- H: real account claiming demo in user metadata. R: a runner looking.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role) values
  ('f5000000-0000-4000-8000-0000000000d1', 'sp.d@example.test', '{"display_name":"Demo D (sample)"}', '{"demo":true}', 'authenticated', 'authenticated'),
  ('f5000000-0000-4000-8000-0000000000e1', 'sp.e@example.test', '{"display_name":"Demo E (sample)"}', '{"demo":true}', 'authenticated', 'authenticated'),
  ('f5000000-0000-4000-8000-0000000000f1', 'sp.f@example.test', '{"display_name":"Demo F (sample)"}', '{"demo":true}', 'authenticated', 'authenticated'),
  ('f5000000-0000-4000-8000-0000000000a1', 'sp.g@example.test', '{"display_name":"Real G"}', '{}', 'authenticated', 'authenticated'),
  ('f5000000-0000-4000-8000-0000000000b1', 'sp.h@example.test', '{"display_name":"Real H","demo":true}', '{}', 'authenticated', 'authenticated'),
  ('f5000000-0000-4000-8000-0000000000c1', 'sp.r@example.test', '{"display_name":"Runner R"}', '{}', 'authenticated', 'authenticated');
insert into public.professional_profiles (user_id, profession, listed) values
  ('f5000000-0000-4000-8000-0000000000d1', 'running_coach', true),
  ('f5000000-0000-4000-8000-0000000000e1', 'running_coach', false),
  ('f5000000-0000-4000-8000-0000000000f1', 'running_coach', true),
  ('f5000000-0000-4000-8000-0000000000a1', 'running_coach', true),
  ('f5000000-0000-4000-8000-0000000000b1', 'running_coach', true);
insert into public.professional_services (professional_id, kind, title, duration_minutes, delivery) values
  ('f5000000-0000-4000-8000-0000000000d1', 'training_consultation', 'Plan review', 45, 'online');
update public.professional_profiles set verification_status = 'pending' where user_id = 'f5000000-0000-4000-8000-0000000000d1';
select set_config('hyd.verifying', 'on', true);
update public.professional_profiles set verification_status = 'verified', verified_by = 'f5000000-0000-4000-8000-0000000000c1', verified_at = now()
 where user_id = 'f5000000-0000-4000-8000-0000000000f1';
select set_config('hyd.verifying', 'off', true);

select pg_temp.act_as('f5000000-0000-4000-8000-0000000000c1');
select is((select array_agg(user_id order by user_id) from public.sample_professionals() where user_id::text like 'f5000000-%'),
  array['f5000000-0000-4000-8000-0000000000d1'::uuid], 'only the listed, unverified demo profile is a sample');
select is((select verification_status from public.sample_professionals() where user_id = 'f5000000-0000-4000-8000-0000000000d1'),
  'pending', 'its real verification status is returned');
select is((select jsonb_array_length(services) from public.sample_professionals() where user_id = 'f5000000-0000-4000-8000-0000000000d1'),
  1, 'its services are listed');
select is((select count(*) from public.sample_professionals() where user_id = 'f5000000-0000-4000-8000-0000000000b1'), 0::bigint,
  'user metadata cannot make an account a sample');
select is((select count(*) from public.sample_professionals() where user_id = 'f5000000-0000-4000-8000-0000000000f1'), 0::bigint,
  'a verified profile is never shown as a sample');
select is((select count(*) from public.professional_directory() where user_id = 'f5000000-0000-4000-8000-0000000000d1'), 0::bigint,
  'a sample profile is not in the bookable directory');
reset role;
select ok(not has_function_privilege('anon', 'public.sample_professionals()', 'execute'), 'anonymous callers cannot list samples');
select ok(has_function_privilege('authenticated', 'public.sample_professionals()', 'execute'), 'signed-in runners can');

select * from finish();
rollback;
