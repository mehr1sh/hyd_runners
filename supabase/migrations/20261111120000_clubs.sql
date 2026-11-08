-- Clubs (Release 1, workstream B).
--
-- * Programme managers create clubs and appoint the first club admin.
-- * Club roles (admin, captain, member) are scoped to one club. A club admin
--   is never a global admin and gains nothing outside their club.
-- * Joining: open clubs admit immediately; "request" clubs need approval by
--   a club admin or captain; invite links (expiring, revocable, use-limited)
--   admit directly through public.join_club_with_invite().
-- * Club events (events.club_id), announcements for members, statistics and
--   a members-only weekly leaderboard that respects leaderboard opt-out.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '' check (char_length(description) <= 2000),
  area text check (area is null or char_length(area) between 2 and 80),
  home_location_id uuid references public.locations (id) on delete set null,
  join_policy text not null default 'request' check (join_policy in ('open', 'request', 'invite')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clubs_name_idx on public.clubs (lower(name));

create trigger clubs_set_updated_at
  before update on public.clubs
  for each row execute function private.set_updated_at();

create table public.club_members (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'captain', 'member')),
  status text not null default 'pending' check (status in ('pending', 'active')),
  requested_at timestamptz not null default now(),
  joined_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  primary key (club_id, user_id)
);

create index club_members_user_idx on public.club_members (user_id);
create index club_members_pending_idx on public.club_members (club_id, requested_at) where status = 'pending';

create table public.club_invites (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  -- Random, unguessable code shared in the invite link.
  code text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  created_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  max_uses integer not null default 50 check (max_uses between 1 and 1000),
  uses integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint club_invites_uses check (uses between 0 and max_uses)
);

create index club_invites_club_idx on public.club_invites (club_id, created_at desc);

create table public.club_announcements (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index club_announcements_club_idx on public.club_announcements (club_id, created_at desc);

alter table public.events add column club_id uuid references public.clubs (id) on delete set null;
create index events_club_idx on public.events (club_id, starts_at);

-- ---------------------------------------------------------------------------
-- Permission helpers (all return false, never NULL)
-- ---------------------------------------------------------------------------

create function private.club_role(p_club uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.club_members m
  where m.club_id = p_club and m.user_id = (select auth.uid()) and m.status = 'active';
$$;

create function private.is_club_member(p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.club_role(p_club) is not null, false);
$$;

create function private.can_admin_club(p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.has_role('programme_manager')) or (select private.has_role('admin'))
      or private.club_role(p_club) = 'admin',
    false);
$$;

create function private.can_lead_club(p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.can_admin_club(p_club) or private.club_role(p_club) = 'captain', false);
$$;

revoke all on function private.club_role(uuid) from public;
revoke all on function private.is_club_member(uuid) from public;
revoke all on function private.can_admin_club(uuid) from public;
revoke all on function private.can_lead_club(uuid) from public;
grant execute on function private.club_role(uuid) to authenticated;
grant execute on function private.is_club_member(uuid) to authenticated;
grant execute on function private.can_admin_club(uuid) to authenticated;
grant execute on function private.can_lead_club(uuid) to authenticated;

-- Club admins manage their club's events too (replaces 20261110120000's version).
create or replace function private.can_manage_event(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.has_role('programme_manager'))
      or (select private.has_role('admin'))
      or private.event_team_role(p_event) = 'organiser'
      or exists (
        select 1 from public.events e
        where e.id = p_event and e.club_id is not null and private.club_role(e.club_id) = 'admin'
      ),
    false);
$$;

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------

revoke all on public.clubs, public.club_members, public.club_invites, public.club_announcements from anon, authenticated;

grant select on public.clubs to anon, authenticated;
grant insert (id, slug, name, description, area, home_location_id, join_policy, created_by) on public.clubs to authenticated;
grant update (name, description, area, home_location_id, join_policy, status) on public.clubs to authenticated;

grant select on public.club_members to authenticated;
grant insert (club_id, user_id) on public.club_members to authenticated;
grant update (role, status) on public.club_members to authenticated;
grant delete on public.club_members to authenticated;

grant select, delete on public.club_invites to authenticated;
grant insert (id, club_id, created_by, expires_at, max_uses) on public.club_invites to authenticated;
grant update (revoked_at) on public.club_invites to authenticated;

grant select, insert, delete on public.club_announcements to authenticated;

alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.club_invites enable row level security;
alter table public.club_announcements enable row level security;

create policy "clubs: anyone reads active clubs"
  on public.clubs for select to anon, authenticated
  using (status = 'active');
create policy "clubs: admins read their archived clubs"
  on public.clubs for select to authenticated
  using ((select private.can_admin_club(id)));
create policy "clubs: managers create"
  on public.clubs for insert to authenticated
  with check (
    ((select private.has_role('programme_manager')) or (select private.has_role('admin')))
    and created_by = (select auth.uid())
  );
create policy "clubs: club admins update"
  on public.clubs for update to authenticated
  using ((select private.can_admin_club(id)))
  with check ((select private.can_admin_club(id)));

-- Members see their club's members; leaders see requests; everyone sees their own row.
create policy "club_members: read"
  on public.club_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or (status = 'active' and (select private.is_club_member(club_id)))
    or (select private.can_lead_club(club_id))
  );
-- Runners add only themselves; the trigger decides pending vs active.
create policy "club_members: join self"
  on public.club_members for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "club_members: leaders decide"
  on public.club_members for update to authenticated
  using ((select private.can_lead_club(club_id)))
  with check ((select private.can_lead_club(club_id)));
create policy "club_members: leave or remove"
  on public.club_members for delete to authenticated
  using (user_id = (select auth.uid()) or (select private.can_lead_club(club_id)));

create policy "club_invites: admins read"
  on public.club_invites for select to authenticated
  using ((select private.can_admin_club(club_id)));
create policy "club_invites: admins create"
  on public.club_invites for insert to authenticated
  with check ((select private.can_admin_club(club_id)) and created_by = (select auth.uid()));
create policy "club_invites: admins revoke"
  on public.club_invites for update to authenticated
  using ((select private.can_admin_club(club_id)))
  with check ((select private.can_admin_club(club_id)));
create policy "club_invites: admins delete"
  on public.club_invites for delete to authenticated
  using ((select private.can_admin_club(club_id)));

create policy "club_announcements: members read"
  on public.club_announcements for select to authenticated
  using ((select private.is_club_member(club_id)) or (select private.can_admin_club(club_id)));
create policy "club_announcements: leaders post"
  on public.club_announcements for insert to authenticated
  with check ((select private.can_lead_club(club_id)) and author_id = (select auth.uid()));
create policy "club_announcements: leaders delete"
  on public.club_announcements for delete to authenticated
  using ((select private.can_lead_club(club_id)));

-- Club admins create events for their own club.
create policy "events: club admins create club events"
  on public.events for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and club_id is not null
    and (select private.club_role(club_id)) = 'admin'
  );

-- ---------------------------------------------------------------------------
-- Membership rules
-- ---------------------------------------------------------------------------

-- Runs with the caller's rights (not SECURITY DEFINER), so current_user
-- really is the caller and the service-role bypass below means what it says.
create function private.club_members_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c record;
  admins int;
begin
  if current_user in ('service_role', 'postgres') and current_setting('hyd.club_rpc', true) is distinct from 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    -- The RPCs below insert as the definer with hyd.club_rpc set.
    if current_setting('hyd.club_rpc', true) = 'on' then
      return new;
    end if;
    select cl.join_policy, cl.status into c from public.clubs cl where cl.id = new.club_id;
    if c is null or c.status <> 'active' then
      raise exception 'This club is not accepting members' using errcode = '23514';
    end if;
    if c.join_policy = 'invite' then
      raise exception 'This club is invite-only' using errcode = '42501';
    end if;
    new.role := 'member';
    new.decided_by := null;
    new.requested_at := now();
    if c.join_policy = 'open' then
      new.status := 'active';
      new.joined_at := now();
    else
      new.status := 'pending';
      new.joined_at := null;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.club_id <> old.club_id or new.user_id <> old.user_id then
      raise exception 'A membership cannot be moved' using errcode = '42501';
    end if;
    if new.status = 'pending' and old.status = 'active' then
      raise exception 'An active member cannot be made pending' using errcode = '23514';
    end if;
    -- Only club admins (or managers) change roles; captains approve requests.
    if new.role <> old.role and not private.can_admin_club(new.club_id) then
      raise exception 'Only club admins change roles' using errcode = '42501';
    end if;
    if new.status = 'pending' and new.role <> 'member' then
      raise exception 'Approve the request before giving a role' using errcode = '23514';
    end if;
    if old.status = 'pending' and new.status = 'active' then
      new.joined_at := now();
      new.decided_by := (select auth.uid());
    end if;
    if old.role = 'admin' and new.role <> 'admin' then
      select count(*) into admins from public.club_members m
       where m.club_id = old.club_id and m.role = 'admin' and m.status = 'active' and m.user_id <> old.user_id;
      if admins = 0 then
        raise exception 'A club needs at least one admin' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  -- DELETE: keep at least one admin; captains cannot remove admins.
  if old.role = 'admin' and old.status = 'active' then
    if old.user_id <> (select auth.uid()) and not private.can_admin_club(old.club_id) then
      raise exception 'Only club admins remove admins' using errcode = '42501';
    end if;
    select count(*) into admins from public.club_members m
     where m.club_id = old.club_id and m.role = 'admin' and m.status = 'active' and m.user_id <> old.user_id;
    if admins = 0 then
      raise exception 'A club needs at least one admin' using errcode = '23514';
    end if;
  end if;
  return old;
end;
$$;

create trigger club_members_guard
  before insert or update or delete on public.club_members
  for each row execute function private.club_members_guard();

-- Appoint a club admin (managers), e.g. when creating a club.
create function public.appoint_club_admin(p_club_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ((select private.has_role('programme_manager')) or (select private.has_role('admin'))) then
    raise exception 'Programme managers only' using errcode = '42501';
  end if;
  perform set_config('hyd.club_rpc', 'on', true);
  insert into public.club_members (club_id, user_id, role, status, joined_at, decided_by)
  values (p_club_id, p_user_id, 'admin', 'active', now(), (select auth.uid()))
  on conflict (club_id, user_id) do update
    set role = 'admin', status = 'active', joined_at = coalesce(public.club_members.joined_at, now()),
        decided_by = (select auth.uid());
  perform set_config('hyd.club_rpc', '', true);
end;
$$;

-- Join through an invite link. The code itself is the credential; refusals
-- are deliberately generic.
create function public.join_club_with_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv record;
begin
  if uid is null then
    raise exception 'Sign in to join' using errcode = '42501';
  end if;
  perform private.enforce_rate_limit('club_invite', 10, interval '1 hour');
  select i.id, i.club_id into inv
    from public.club_invites i
    join public.clubs c on c.id = i.club_id
   where i.code = p_code and i.revoked_at is null and i.expires_at > now()
     and i.uses < i.max_uses and c.status = 'active'
   for update of i;
  if inv is null then
    raise exception 'This invite link is invalid or has expired' using errcode = 'P0002';
  end if;
  perform set_config('hyd.club_rpc', 'on', true);
  insert into public.club_members (club_id, user_id, role, status, joined_at)
  values (inv.club_id, uid, 'member', 'active', now())
  on conflict (club_id, user_id) do update
    set status = 'active', joined_at = coalesce(public.club_members.joined_at, now());
  perform set_config('hyd.club_rpc', '', true);
  update public.club_invites set uses = uses + 1 where id = inv.id;
  return inv.club_id;
end;
$$;

revoke all on function public.appoint_club_admin(uuid, uuid) from public, anon;
revoke all on function public.join_club_with_invite(text) from public, anon;
grant execute on function public.appoint_club_admin(uuid, uuid) to authenticated;
grant execute on function public.join_club_with_invite(text) to authenticated;

create function private.audit_club_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit('club_member.joined', 'club', new.club_id::text, new.user_id,
      jsonb_build_object('role', new.role, 'status', new.status));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      perform private.write_audit('club_member.role_changed', 'club', new.club_id::text, new.user_id,
        jsonb_build_object('from', old.role, 'to', new.role));
    end if;
    if new.status is distinct from old.status then
      perform private.write_audit('club_member.approved', 'club', new.club_id::text, new.user_id, '{}'::jsonb);
    end if;
    return new;
  end if;
  perform private.write_audit('club_member.removed', 'club', old.club_id::text, old.user_id,
    jsonb_build_object('role', old.role, 'self', old.user_id = auth.uid()));
  return old;
end;
$$;

create trigger club_members_audit
  after insert or update or delete on public.club_members
  for each row execute function private.audit_club_members();

-- ---------------------------------------------------------------------------
-- Read helpers
-- ---------------------------------------------------------------------------

-- Member names and roles, for members and leaders (pending requests for leaders).
create function public.club_roster(p_club_id uuid)
returns table (user_id uuid, display_name text, role text, status text, requested_at timestamptz, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.is_club_member(p_club_id) or private.can_lead_club(p_club_id)) then
    raise exception 'Club members only' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.display_name, m.role, m.status, m.requested_at, m.joined_at
    from public.club_members m
    join public.profiles p on p.id = m.user_id
    where m.club_id = p_club_id
      and (m.status = 'active' or private.can_lead_club(p_club_id))
    order by m.status desc, case m.role when 'admin' then 0 when 'captain' then 1 else 2 end, p.display_name
    limit 2000;
end;
$$;

-- Public statistics (counts only).
create function public.club_stats(p_club_ids uuid[])
returns table (club_id uuid, members bigint, upcoming_events bigint, attended_last_30_days bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,
    (select count(*) from public.club_members m where m.club_id = c.id and m.status = 'active'),
    (select count(*) from public.events e where e.club_id = c.id and e.status = 'published' and e.ends_at > now()),
    (select count(*) from public.event_rsvps r join public.events e on e.id = r.event_id
      where e.club_id = c.id and r.checked_in_at > now() - interval '30 days')
  from public.clubs c
  where c.id = any (p_club_ids) and c.status = 'active';
$$;

-- This week's XP among the club's members, respecting leaderboard opt-out
-- (the caller always sees their own row). Members only.
create function public.club_leaderboard(p_club_id uuid, p_week_start date, p_timezone text default 'Asia/Kolkata', p_limit integer default 20)
returns table (rank bigint, display_name text, xp bigint, workouts bigint, is_me boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_club_member(p_club_id) then
    raise exception 'Club members only' using errcode = '42501';
  end if;
  return query
  with bounds as (
    select (p_week_start::timestamp at time zone p_timezone) as from_ts,
           ((p_week_start + 7)::timestamp at time zone p_timezone) as to_ts
  ),
  members as (
    select m.user_id from public.club_members m where m.club_id = p_club_id and m.status = 'active'
  ),
  totals as (
    select l.user_id, sum(l.delta_xp)::bigint as xp,
           count(*) filter (where l.reason = 'workout_completed')::bigint as workouts
    from public.xp_ledger l, bounds b
    where l.user_id in (select user_id from members) and l.occurred_at >= b.from_ts and l.occurred_at < b.to_ts
    group by l.user_id
    having sum(l.delta_xp) > 0
  ),
  visible as (
    select t.*, p.display_name from totals t
    join public.profiles p on p.id = t.user_id
    left join public.runner_settings s on s.user_id = t.user_id
    where coalesce(s.show_on_leaderboard, true) or t.user_id = (select auth.uid())
  ),
  ranked as (
    select rank() over (order by v.xp desc) as rnk, v.display_name, v.xp, v.workouts, v.user_id = (select auth.uid()) as me
    from visible v
  )
  select r.rnk, r.display_name, r.xp, r.workouts, r.me from ranked r
  where r.rnk <= greatest(1, least(p_limit, 100)) or r.me
  order by r.rnk, r.display_name;
end;
$$;

revoke all on function public.club_roster(uuid) from public, anon;
revoke all on function public.club_stats(uuid[]) from public;
revoke all on function public.club_leaderboard(uuid, date, text, integer) from public, anon;
grant execute on function public.club_roster(uuid) to authenticated;
grant execute on function public.club_stats(uuid[]) to anon, authenticated;
grant execute on function public.club_leaderboard(uuid, date, text, integer) to authenticated;
