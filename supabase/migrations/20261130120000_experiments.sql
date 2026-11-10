-- Experimental running experiences that need data support.
--
-- * Route collectibles: completions are computed (never stored) by matching
--   the caller's own GPS tracks to published routes, so they cannot be
--   duplicated or claimed without a matching run.
-- * Mystery runs: organisers attach a route that stays hidden until a reveal
--   time; meeting point, organiser and safety information stay visible.
-- * Virtual relays: a squad's collective distance along a simulated journey,
--   always labelled as simulated.
-- * Causes: challenges may support a community or charity campaign, shown as
--   verified only after an admin checks it. No money is handled and no
--   impact figures are claimed.

-- Collectibles ---------------------------------------------------------------------------

create function public.my_route_completions()
returns table (route_id uuid, slug text, name text, area text, distance_m numeric, verified boolean,
               times bigint, first_completed_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.slug, r.name, r.area, r.distance_m, r.verified, count(*), min(a.started_at)
  from public.routes r
  join public.activity_tracks t on t.user_id = (select auth.uid()) and t.path is not null
  join public.activities a on a.id = t.activity_id and a.status = 'ready'
  where r.status = 'published'
    and abs(a.distance_m - r.distance_m) <= r.distance_m * 0.15
    and extensions.st_dwithin(t.path, r.path, 200)
    and extensions.st_hausdorffdistance(t.path::extensions.geometry, r.path::extensions.geometry) * 111320 <= 150
  group by r.id, r.slug, r.name, r.area, r.distance_m, r.verified
  order by min(a.started_at);
$$;
revoke all on function public.my_route_completions() from public, anon;
grant execute on function public.my_route_completions() to authenticated;

-- Mystery runs ---------------------------------------------------------------------------

alter table public.events
  add column mystery_reveal_at timestamptz,
  add column mystery_route_id uuid references public.routes (id) on delete set null;
-- The hidden route is never selectable directly.
revoke select (mystery_route_id) on public.events from authenticated;
do $$
declare
  cols text;
begin
  -- Re-grant every other column explicitly (a table-level grant would include the hidden one).
  select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'events' and column_name <> 'mystery_route_id';
  execute 'revoke select on public.events from authenticated';
  execute format('grant select (%s) on public.events to authenticated', cols);
end;
$$;

create function public.set_mystery_run(p_event uuid, p_route uuid, p_reveal_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_event(p_event) then
    raise exception 'organisers only' using errcode = '42501';
  end if;
  if p_route is not null and not exists (select 1 from public.routes where id = p_route and status = 'published') then
    raise exception 'route not found' using errcode = '22023';
  end if;
  update public.events set mystery_route_id = p_route, mystery_reveal_at = case when p_route is null then null else p_reveal_at end
   where id = p_event;
  perform private.write_audit('event.mystery_set', 'event', p_event::text, null, jsonb_build_object('reveal_at', p_reveal_at));
end;
$$;

-- Returns the hidden route once revealed (or to organisers at any time).
create function public.mystery_route(p_event uuid)
returns table (revealed boolean, reveal_at timestamptz, route_id uuid, slug text, name text, distance_m numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select (e.mystery_reveal_at <= now() or private.can_manage_event(e.id)), e.mystery_reveal_at,
         case when e.mystery_reveal_at <= now() or private.can_manage_event(e.id) then r.id end,
         case when e.mystery_reveal_at <= now() or private.can_manage_event(e.id) then r.slug end,
         case when e.mystery_reveal_at <= now() or private.can_manage_event(e.id) then r.name end,
         -- Distance is always shown so runners can prepare.
         r.distance_m
  from public.events e join public.routes r on r.id = e.mystery_route_id
  where e.id = p_event and e.mystery_route_id is not null
    and (e.status = 'published' or private.can_manage_event(e.id));
$$;

revoke all on function public.set_mystery_run(uuid, uuid, timestamptz), public.mystery_route(uuid) from public, anon;
grant execute on function public.set_mystery_run(uuid, uuid, timestamptz), public.mystery_route(uuid) to authenticated;

-- Virtual relays ---------------------------------------------------------------------------

create table public.squad_relays (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references public.squads (id) on delete cascade,
  journey text not null check (journey in ('hyd_vizag', 'hyd_bengaluru', 'hyd_mumbai', 'golden_quadrilateral', 'around_the_world')),
  starts_on date not null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (squad_id, journey, starts_on)
);
alter table public.squad_relays enable row level security;
revoke all on public.squad_relays from anon, authenticated;
grant select on public.squad_relays to authenticated;
grant insert (squad_id, journey, starts_on), delete on public.squad_relays to authenticated;
create policy "squad_relays: members read" on public.squad_relays for select to authenticated
  using ((select private.is_squad_member(squad_id)));
create policy "squad_relays: captains manage" on public.squad_relays for all to authenticated
  using ((select private.is_squad_captain(squad_id))) with check ((select private.is_squad_captain(squad_id)));

create function public.squad_relay_progress(p_relay uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.squad_relays;
begin
  select * into r from public.squad_relays where id = p_relay;
  if r.id is null or not private.is_squad_member(r.squad_id) then
    raise exception 'members only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'km', round(coalesce((select sum(a.distance_m) from public.activities a
                           join public.squad_members m on m.user_id = a.user_id and m.squad_id = r.squad_id and m.status = 'active'
                          where a.status = 'ready' and a.started_at >= (r.starts_on::timestamp at time zone 'Asia/Kolkata')), 0) / 1000, 1),
    'contributors', (select count(distinct a.user_id) from public.activities a
                      join public.squad_members m on m.user_id = a.user_id and m.squad_id = r.squad_id and m.status = 'active'
                     where a.status = 'ready' and a.started_at >= (r.starts_on::timestamp at time zone 'Asia/Kolkata')));
end;
$$;
revoke all on function public.squad_relay_progress(uuid) from public, anon;
grant execute on function public.squad_relay_progress(uuid) to authenticated;

-- Causes ------------------------------------------------------------------------------------

alter table public.challenges
  add column cause_name text check (cause_name is null or char_length(cause_name) between 3 and 120),
  add column cause_url text check (cause_url is null or (cause_url ~ '^https://' and char_length(cause_url) <= 300)),
  add column cause_status text not null default 'none' check (cause_status in ('none', 'pending', 'verified', 'rejected')),
  add column cause_verified_by uuid references public.profiles (id) on delete set null;

create function public.set_challenge_cause(p_challenge uuid, p_name text, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.challenges;
begin
  select * into c from public.challenges where id = p_challenge;
  if c.id is null or not private.can_manage_challenge(c.scope, c.club_id) then
    raise exception 'challenge organisers only' using errcode = '42501';
  end if;
  update public.challenges
     set cause_name = nullif(btrim(coalesce(p_name, '')), ''),
         cause_url = nullif(btrim(coalesce(p_url, '')), ''),
         cause_status = case when nullif(btrim(coalesce(p_name, '')), '') is null then 'none' else 'pending' end,
         cause_verified_by = null
   where id = p_challenge;
  perform private.write_audit('challenge.cause_set', 'challenge', p_challenge::text, null, jsonb_build_object('cause', p_name));
end;
$$;

create function public.verify_challenge_cause(p_challenge uuid, p_verified boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role('admin') then
    raise exception 'admins only' using errcode = '42501';
  end if;
  update public.challenges
     set cause_status = case when p_verified then 'verified' else 'rejected' end,
         cause_verified_by = (select auth.uid())
   where id = p_challenge and cause_status = 'pending';
  if not found then raise exception 'no cause waiting for review' using errcode = 'P0002'; end if;
  perform private.write_audit('challenge.cause_' || case when p_verified then 'verified' else 'rejected' end,
                              'challenge', p_challenge::text, null, '{}'::jsonb);
end;
$$;
revoke all on function public.set_challenge_cause(uuid, text, text), public.verify_challenge_cause(uuid, boolean) from public, anon;
grant execute on function public.set_challenge_cause(uuid, text, text), public.verify_challenge_cause(uuid, boolean) to authenticated;
