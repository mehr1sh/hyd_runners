-- pgTAP: marketplace (migration 20261128120000_marketplace): only verified,
-- listed professionals are bookable; physiotherapy needs a verified
-- physiotherapist; bookings move through request, confirm or decline, cancel
-- and complete with slot holds; payments are never collected.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- P is a verified coach, U an unverified coach, R a runner, S a stranger.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('e3000000-0000-4000-8000-0000000000a1', 'mk.p@example.test', '{"display_name":"Pro Verified"}', 'authenticated', 'authenticated'),
  ('e3000000-0000-4000-8000-0000000000b1', 'mk.u@example.test', '{"display_name":"Pro Unverified"}', 'authenticated', 'authenticated'),
  ('e3000000-0000-4000-8000-0000000000c1', 'mk.r@example.test', '{"display_name":"Runner R"}', 'authenticated', 'authenticated'),
  ('e3000000-0000-4000-8000-0000000000d1', 'mk.s@example.test', '{"display_name":"Stranger S"}', 'authenticated', 'authenticated');
insert into public.professional_profiles (user_id, profession, credentials, listed) values
  ('e3000000-0000-4000-8000-0000000000a1', 'running_coach', '[{"name":"L2"}]', true),
  ('e3000000-0000-4000-8000-0000000000b1', 'running_coach', '[{"name":"L1"}]', true);
select set_config('hyd.verifying', 'on', true);
update public.professional_profiles set verification_status = 'verified', verified_by = 'e3000000-0000-4000-8000-0000000000d1', verified_at = now()
 where user_id = 'e3000000-0000-4000-8000-0000000000a1';
select set_config('hyd.verifying', 'off', true);
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

select pg_temp.act_as('e3000000-0000-4000-8000-0000000000a1');
select lives_ok($$ with x as (insert into public.professional_services (professional_id, kind, title, duration_minutes, delivery,
  indicative_price_inr) values ('e3000000-0000-4000-8000-0000000000a1', 'form_review', 'Running form review', 45, 'in_person', 1500)
  returning id) insert into ids select 's', id from x $$, 'a verified coach lists a service');
select throws_ok($$ insert into public.professional_services (professional_id, kind, title, duration_minutes, delivery) values
  ('e3000000-0000-4000-8000-0000000000a1', 'physiotherapy', 'Injury assessment', 45, 'in_person') $$, '22023', null,
  'only physiotherapists list physiotherapy');
select lives_ok($$ with x as (insert into public.professional_slots (professional_id, starts_at, ends_at) values
  ('e3000000-0000-4000-8000-0000000000a1', now() + interval '2 days', now() + interval '2 days 1 hour') returning id)
  insert into ids select 'slot', id from x $$, 'and adds a slot');
select pg_temp.act_as('e3000000-0000-4000-8000-0000000000b1');
select lives_ok($$ with x as (insert into public.professional_services (professional_id, kind, title, duration_minutes, delivery) values
  ('e3000000-0000-4000-8000-0000000000b1', 'training_consultation', 'Consult', 30, 'online') returning id)
  insert into ids select 'us', id from x $$, 'an unverified coach can prepare a service');

select pg_temp.act_as('e3000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.professional_services where professional_id = 'e3000000-0000-4000-8000-0000000000b1'), 0::bigint,
  'unverified professionals are not listed');
select is((select count(*) from public.professional_directory() where user_id = 'e3000000-0000-4000-8000-0000000000b1'), 0::bigint,
  'or in the directory');
select is((select count(*) from public.professional_directory() where user_id = 'e3000000-0000-4000-8000-0000000000a1'), 1::bigint,
  'verified professionals are');
select throws_ok($$ select public.request_booking((select v from ids where k = 's'), (select v from ids where k = 'slot'), 'Hi', false) $$,
  '22023', null, 'runners must acknowledge the boundaries');
select throws_ok($$ select public.request_booking((select v from ids where k = 'us'), (select v from ids where k = 'slot'), null, true) $$,
  'P0002', null, 'unverified services cannot be booked');
select lives_ok($$ insert into ids values ('b', public.request_booking((select v from ids where k = 's'), (select v from ids where k = 'slot'), 'Knee fine, want form tips', true)) $$,
  'a runner requests a booking');
select is((select payment_status from public.bookings), 'not_collected', 'no payment is collected');
select throws_ok($$ update public.bookings set status = 'confirmed' $$, '42501', null, 'bookings change only through update_booking');

select pg_temp.act_as('e3000000-0000-4000-8000-0000000000d1');
select is((select count(*) from public.bookings), 0::bigint, 'strangers cannot see bookings');
select throws_ok($$ select public.request_booking((select v from ids where k = 's'), (select v from ids where k = 'slot'), null, true) $$,
  'P0002', null, 'a held slot cannot be double-booked');
select throws_ok($$ select public.update_booking((select v from ids where k = 'b'), 'confirm') $$, 'P0002', null,
  'strangers cannot act on a booking');

select pg_temp.act_as('e3000000-0000-4000-8000-0000000000c1');
select throws_ok($$ select public.update_booking((select v from ids where k = 'b'), 'confirm') $$, '42501', null,
  'runners cannot confirm their own booking');
select pg_temp.act_as('e3000000-0000-4000-8000-0000000000a1');
select lives_ok($$ select public.update_booking((select v from ids where k = 'b'), 'confirm', 'See you at KBR gate 1') $$, 'the professional confirms');
select throws_ok($$ select public.update_booking((select v from ids where k = 'b'), 'complete') $$, '22023', null,
  'sessions are completed only after they happen');
select pg_temp.act_as('e3000000-0000-4000-8000-0000000000c1');
select lives_ok($$ select public.update_booking((select v from ids where k = 'b'), 'cancel') $$, 'the runner cancels');
reset role;
select is((select status from public.professional_slots where id = (select v from ids where k = 'slot')) || ':' ||
          (select count(*) from public.audit_log where target_type = 'booking' and target_id = (select v::text from ids where k = 'b')),
  'open:3', 'the slot reopens and each step is audited');

select * from finish();
rollback;
