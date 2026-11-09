-- Release 2 / Workstream H: Social v1.
--
-- Follows (with optional approval), blocks, kudos and comments on activities,
-- a followers feed, runner search and minimal public profiles. Activity
-- visibility now honours "followers" and blocks. Reports and moderator hiding
-- reuse the existing content_reports workflow (new targets: activity,
-- activity_comment).
--
-- Privacy rules:
-- - profiles stay readable only by their owner (and staff); other runners see
--   a minimal card through runner_profile()/search_runners(): name, bio and
--   follower counts, never email, roles or training data;
-- - a block works both ways: neither runner can see the other's activities,
--   comments or kudos, follow, or find the other in search;
-- - activity visibility: owner; public; followers = accepted followers only.

-- ---------------------------------------------------------------------------
-- Profile settings
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column bio text check (bio is null or char_length(bio) between 1 and 160),
  add column approve_followers boolean not null default true,
  add column discoverable boolean not null default true;

comment on column public.profiles.approve_followers is 'New followers need approval (default) before seeing followers-only activities.';
comment on column public.profiles.discoverable is 'Whether other runners can find this profile with search.';

grant update (bio, approve_followers, discoverable) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------

create table public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

create function private.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1 from public.user_blocks b
     where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a)
  ), false);
$$;
revoke all on function private.is_blocked_between(uuid, uuid) from public;
grant execute on function private.is_blocked_between(uuid, uuid) to authenticated;

alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon, authenticated;
grant select, delete on public.user_blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.user_blocks to authenticated;
create policy "user_blocks: own" on public.user_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
create policy "user_blocks: block" on public.user_blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));
create policy "user_blocks: unblock" on public.user_blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Follows
-- ---------------------------------------------------------------------------

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id),
  check ((status = 'accepted') = (accepted_at is not null))
);
create index follows_followee_idx on public.follows (followee_id, status);

create function private.follows_accepted(p_follower uuid, p_followee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1 from public.follows f
     where f.follower_id = p_follower and f.followee_id = p_followee and f.status = 'accepted'
  ), false);
$$;
revoke all on function private.follows_accepted(uuid, uuid) from public;
grant execute on function private.follows_accepted(uuid, uuid) to authenticated;

-- Blocking removes follows in both directions (rows the blocker cannot otherwise delete).
create function private.user_blocks_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.follows f
   where (f.follower_id = new.blocker_id and f.followee_id = new.blocked_id)
      or (f.follower_id = new.blocked_id and f.followee_id = new.blocker_id);
  return new;
end;
$$;
create trigger user_blocks_cleanup after insert on public.user_blocks
  for each row execute function private.user_blocks_cleanup();

-- New follows: blocked pairs cannot follow; status depends on the followee's
-- setting (read with definer rights: profiles are owner-only). Rate-limited.
create function private.follows_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  approve boolean;
begin
  if private.is_blocked_between(new.follower_id, new.followee_id) then
    raise exception 'You can''t follow this runner' using errcode = '42501';
  end if;
  select p.approve_followers into approve from public.profiles p where p.id = new.followee_id;
  if approve is null then
    raise exception 'Runner not found' using errcode = 'P0002';
  end if;
  perform private.enforce_rate_limit('follow', 60, interval '1 hour');
  new.created_at := now();
  if approve then
    new.status := 'pending';
    new.accepted_at := null;
  else
    new.status := 'accepted';
    new.accepted_at := now();
  end if;
  return new;
end;
$$;
create trigger follows_before_insert before insert on public.follows
  for each row execute function private.follows_before_insert();

-- The only allowed update: the followee accepts a pending request.
create function private.follows_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.follower_id <> old.follower_id or new.followee_id <> old.followee_id
     or old.status <> 'pending' or new.status <> 'accepted' then
    raise exception 'Only a pending follow request can be accepted' using errcode = '42501';
  end if;
  new.accepted_at := now();
  new.created_at := old.created_at;
  return new;
end;
$$;
create trigger follows_guard_update before update on public.follows
  for each row execute function private.follows_guard_update();

alter table public.follows enable row level security;
revoke all on public.follows from anon, authenticated;
grant select, delete on public.follows to authenticated;
grant insert (follower_id, followee_id) on public.follows to authenticated;
grant update (status) on public.follows to authenticated;
create policy "follows: either side reads" on public.follows for select to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));
create policy "follows: follow" on public.follows for insert to authenticated
  with check (follower_id = (select auth.uid()));
create policy "follows: followee accepts" on public.follows for update to authenticated
  using (followee_id = (select auth.uid())) with check (followee_id = (select auth.uid()));
create policy "follows: unfollow or remove a follower" on public.follows for delete to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Activity visibility: followers and blocks; moderator hiding
-- ---------------------------------------------------------------------------

create or replace function private.can_view_activity(p_owner uuid, p_visibility text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_owner = (select auth.uid())
    or (not private.is_blocked_between(p_owner, (select auth.uid()))
        and (p_visibility = 'public'
             or (p_visibility = 'followers' and private.follows_accepted((select auth.uid()), p_owner)))),
    false);
$$;

alter table public.activities
  add column hidden_at timestamptz,
  add column hidden_by uuid references public.profiles (id) on delete set null;
comment on column public.activities.hidden_at is 'Set when a moderator hides the activity after a report; the owner still sees it.';

drop policy "activities: owner reads all, others per visibility" on public.activities;
create policy "activities: owner reads all, others per visibility"
  on public.activities for select to authenticated
  using (user_id = (select auth.uid())
         or (status = 'ready' and hidden_at is null and (select private.can_view_activity(user_id, visibility))));

-- ---------------------------------------------------------------------------
-- Kudos
-- ---------------------------------------------------------------------------

create table public.activity_reactions (
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);
create index activity_reactions_user_idx on public.activity_reactions (user_id);

create function private.activity_reactions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enforce_rate_limit('reaction', 300, interval '1 hour');
  new.created_at := now();
  return new;
end;
$$;
create trigger activity_reactions_before_insert before insert on public.activity_reactions
  for each row execute function private.activity_reactions_before_insert();

alter table public.activity_reactions enable row level security;
revoke all on public.activity_reactions from anon, authenticated;
grant select, delete on public.activity_reactions to authenticated;
grant insert (activity_id, user_id) on public.activity_reactions to authenticated;
-- The subqueries on activities run with the caller's rights, so activities RLS applies.
create policy "activity_reactions: on visible activities" on public.activity_reactions for select to authenticated
  using (exists (select 1 from public.activities a where a.id = activity_id)
         and not (select private.is_blocked_between(user_id, (select auth.uid()))));
create policy "activity_reactions: give kudos" on public.activity_reactions for insert to authenticated
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.activities a
                           where a.id = activity_id and a.status = 'ready' and a.hidden_at is null
                             and a.user_id <> (select auth.uid())));
create policy "activity_reactions: take back" on public.activity_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

create table public.activity_comments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500 and body = btrim(body)),
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id) on delete set null
);
create index activity_comments_activity_idx on public.activity_comments (activity_id, created_at);
create index activity_comments_author_idx on public.activity_comments (author_id);

create function private.activity_comments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enforce_rate_limit('comment', 30, interval '1 hour');
  new.created_at := now();
  new.hidden_at := null;
  new.hidden_by := null;
  return new;
end;
$$;
create trigger activity_comments_before_insert before insert on public.activity_comments
  for each row execute function private.activity_comments_before_insert();

alter table public.activity_comments enable row level security;
revoke all on public.activity_comments from anon, authenticated;
grant select, delete on public.activity_comments to authenticated;
grant insert (id, activity_id, author_id, body) on public.activity_comments to authenticated;
create policy "activity_comments: on visible activities" on public.activity_comments for select to authenticated
  using (exists (select 1 from public.activities a where a.id = activity_id)
         and (hidden_at is null or author_id = (select auth.uid()))
         and not (select private.is_blocked_between(author_id, (select auth.uid()))));
create policy "activity_comments: comment" on public.activity_comments for insert to authenticated
  with check (author_id = (select auth.uid())
              and exists (select 1 from public.activities a
                           where a.id = activity_id and a.status = 'ready' and a.hidden_at is null));
create policy "activity_comments: author or activity owner deletes" on public.activity_comments
  for delete to authenticated
  using (author_id = (select auth.uid())
         or exists (select 1 from public.activities a where a.id = activity_id and a.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Names, profiles, search and the feed
-- ---------------------------------------------------------------------------

-- A runner's display name, only to someone with a social connection to them
-- (themselves, a follow either way, or a comment/kudos on a visible activity).
create function private.social_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name from public.profiles p
   where p.id = p_user
     and not private.is_blocked_between(p_user, (select auth.uid()))
     and (p_user = (select auth.uid())
          or exists (select 1 from public.follows f
                      where (f.follower_id = (select auth.uid()) and f.followee_id = p_user)
                         or (f.follower_id = p_user and f.followee_id = (select auth.uid())))
          or exists (select 1 from public.activity_comments c join public.activities a on a.id = c.activity_id
                      where c.author_id = p_user and c.hidden_at is null
                        and (a.user_id = (select auth.uid()) or private.can_view_activity(a.user_id, a.visibility)))
          or exists (select 1 from public.activity_reactions r join public.activities a on a.id = r.activity_id
                      where r.user_id = p_user and a.user_id = (select auth.uid()))
          or exists (select 1 from public.activities a
                      where a.user_id = p_user and a.status = 'ready' and a.hidden_at is null
                        and private.can_view_activity(a.user_id, a.visibility)));
$$;
revoke all on function private.social_name(uuid) from public;
grant execute on function private.social_name(uuid) to authenticated;

-- A minimal profile card. Not found when either runner has blocked the other.
create function public.runner_profile(p_user uuid)
returns table (
  id uuid,
  display_name text,
  bio text,
  followers bigint,
  following bigint,
  approve_followers boolean,
  my_follow text,
  follows_me boolean,
  blocked_by_me boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in to view runners' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_blocks b where b.blocker_id = p_user and b.blocked_id = uid) then
    return;
  end if;
  return query
    select p.id, p.display_name, p.bio,
           (select count(*) from public.follows f where f.followee_id = p.id and f.status = 'accepted'),
           (select count(*) from public.follows f where f.follower_id = p.id and f.status = 'accepted'),
           p.approve_followers,
           coalesce((select f.status from public.follows f where f.follower_id = uid and f.followee_id = p.id), 'none'),
           exists (select 1 from public.follows f where f.follower_id = p.id and f.followee_id = uid and f.status = 'accepted'),
           exists (select 1 from public.user_blocks b where b.blocker_id = uid and b.blocked_id = p.id)
      from public.profiles p
     where p.id = p_user;
end;
$$;

-- Find runners by name: discoverable profiles only, never blocked pairs or yourself.
create function public.search_runners(p_query text, p_limit integer default 20)
returns table (id uuid, display_name text, bio text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  q text := btrim(coalesce(p_query, ''));
begin
  if uid is null then
    raise exception 'Sign in to search runners' using errcode = '42501';
  end if;
  if char_length(q) < 2 or char_length(q) > 60 then
    raise exception 'Search with 2 to 60 characters' using errcode = '22023';
  end if;
  return query
    select p.id, p.display_name, p.bio
      from public.profiles p
     where p.discoverable
       and p.id <> uid
       and p.display_name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
       and not private.is_blocked_between(p.id, uid)
     order by (p.display_name ilike replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%') desc,
              p.display_name, p.id
     limit greatest(1, least(coalesce(p_limit, 20), 20));
end;
$$;

-- The caller's feed: their own and followed runners' ready activities that
-- RLS lets them see, newest first. Caller's rights throughout.
create function public.activity_feed(p_before timestamptz default null, p_limit integer default 20)
returns table (
  id uuid,
  user_id uuid,
  author_name text,
  activity_type text,
  name text,
  visibility text,
  started_at timestamptz,
  distance_m numeric,
  moving_seconds integer,
  avg_pace_s integer,
  elevation_gain_m numeric,
  route_geojson json,
  kudos bigint,
  my_kudos boolean,
  comments bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id, a.user_id, private.social_name(a.user_id), a.activity_type, a.name, a.visibility, a.started_at,
         a.distance_m, a.moving_seconds, a.avg_pace_s, a.elevation_gain_m, public.activity_public_geojson(a),
         (select count(*) from public.activity_reactions r where r.activity_id = a.id),
         exists (select 1 from public.activity_reactions r where r.activity_id = a.id and r.user_id = (select auth.uid())),
         (select count(*) from public.activity_comments c where c.activity_id = a.id and c.hidden_at is null)
    from public.activities a
   where a.status = 'ready'
     and a.hidden_at is null
     and (a.user_id = (select auth.uid())
          or exists (select 1 from public.follows f
                      where f.follower_id = (select auth.uid()) and f.followee_id = a.user_id and f.status = 'accepted'))
     and (p_before is null or a.started_at < p_before)
   order by a.started_at desc, a.id desc
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

-- Names for the caller's own follower/following lists and requests.
create function public.my_connections()
returns table (user_id uuid, display_name text, direction text, status text, since timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.followee_id, private.social_name(f.followee_id), 'following', f.status, f.created_at
    from public.follows f where f.follower_id = (select auth.uid())
  union all
  select f.follower_id, private.social_name(f.follower_id), 'follower', f.status, f.created_at
    from public.follows f where f.followee_id = (select auth.uid())
  order by 5 desc
  limit 500;
$$;

-- Comment author names on one activity (visible comments only).
create function public.activity_comment_list(p_activity_id uuid)
returns table (id uuid, author_id uuid, author_name text, body text, created_at timestamptz, hidden boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.author_id, private.social_name(c.author_id), c.body, c.created_at, c.hidden_at is not null
    from public.activity_comments c
   where c.activity_id = p_activity_id
   order by c.created_at, c.id
   limit 200;
$$;

revoke all on function public.runner_profile(uuid) from public, anon;
revoke all on function public.search_runners(text, integer) from public, anon;
revoke all on function public.activity_feed(timestamptz, integer) from public, anon;
revoke all on function public.my_connections() from public, anon;
revoke all on function public.activity_comment_list(uuid) from public, anon;
grant execute on function public.runner_profile(uuid) to authenticated;
grant execute on function public.search_runners(text, integer) to authenticated;
grant execute on function public.activity_feed(timestamptz, integer) to authenticated;
grant execute on function public.my_connections() to authenticated;
grant execute on function public.activity_comment_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reports and moderation: activities and comments
-- ---------------------------------------------------------------------------

alter type public.report_target add value if not exists 'activity';
alter type public.report_target add value if not exists 'activity_comment';

create or replace function public.report_content(
  p_target_type public.report_target,
  p_target_id uuid,
  p_reason public.report_reason,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  author uuid;
  new_id uuid;
  clean_details text := nullif(btrim(p_details), '');
begin
  if uid is null then
    raise exception 'Sign in to report content' using errcode = '42501';
  end if;

  if p_target_type = 'message' then
    -- Only the recipient reports a message.
    select m.sender_id into author
      from public.messages m
     where m.id = p_target_id and m.recipient_id = uid and m.hidden_at is null;
  elsif p_target_type = 'feedback_reply' then
    select r.author_id into author
      from public.feedback_replies r
      join public.feedback f on f.id = r.feedback_id
     where r.id = p_target_id
       and r.hidden_at is null
       and (
         f.user_id = uid
         or (f.assigned_to = uid and private.holds_assignee_role(uid))
         or private.is_moderator()
       );
  elsif p_target_type = 'feedback' then
    -- Staff who can see a feedback item may report it.
    select f.user_id into author
      from public.feedback f
     where f.id = p_target_id
       and ((f.assigned_to = uid and private.holds_assignee_role(uid)) or private.is_moderator());
  elsif p_target_type::text = 'activity' then
    -- Anyone who can see the activity may report it.
    select a.user_id into author
      from public.activities a
     where a.id = p_target_id and a.status = 'ready' and a.hidden_at is null
       and private.can_view_activity(a.user_id, a.visibility);
  elsif p_target_type::text = 'activity_comment' then
    select c.author_id into author
      from public.activity_comments c
      join public.activities a on a.id = c.activity_id
     where c.id = p_target_id and c.hidden_at is null
       and not private.is_blocked_between(c.author_id, uid)
       and private.can_view_activity(a.user_id, a.visibility);
  end if;

  if author is null or author = uid then
    raise exception 'That content cannot be reported' using errcode = '42501';
  end if;

  if clean_details is not null and char_length(clean_details) > 1000 then
    raise exception 'Details must be 1000 characters or fewer' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.content_reports cr
     where cr.reporter_id = uid and cr.target_type = p_target_type and cr.target_id = p_target_id
  ) then
    raise exception 'You have already reported this' using errcode = '23505';
  end if;

  perform private.enforce_rate_limit('content_report', 10, interval '1 hour');

  insert into public.content_reports (reporter_id, target_type, target_id, subject_id, reason, details)
  values (uid, p_target_type, p_target_id, author, p_reason, clean_details)
  returning id into new_id;

  perform private.write_audit('report.submitted', 'content_report', new_id::text, author,
    jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id, 'reason', p_reason));
  return new_id;
end;
$$;

create or replace function public.moderation_report_content(p_report_id uuid)
returns table (
  target_type public.report_target,
  body text,
  author_id uuid,
  author_name text,
  created_at timestamptz,
  hidden_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  report public.content_reports%rowtype;
begin
  if not private.is_moderator() then
    raise exception 'Moderators only' using errcode = '42501';
  end if;

  select * into report from public.content_reports cr where cr.id = p_report_id;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;

  perform private.write_audit('report.content_viewed', 'content_report', report.id::text, report.subject_id,
    jsonb_build_object('target_type', report.target_type, 'target_id', report.target_id));

  if report.target_type = 'message' then
    return query
      select report.target_type, m.body, m.sender_id, p.display_name, m.created_at, m.hidden_at
        from public.messages m
        left join public.profiles p on p.id = m.sender_id
       where m.id = report.target_id;
  elsif report.target_type = 'feedback_reply' then
    return query
      select report.target_type, r.body, r.author_id, p.display_name, r.created_at, r.hidden_at
        from public.feedback_replies r
        left join public.profiles p on p.id = r.author_id
       where r.id = report.target_id;
  elsif report.target_type::text = 'activity' then
    -- The activity's name and summary only, never its track.
    return query
      select report.target_type,
             coalesce(a.name, '(untitled ' || a.activity_type || ')') || ' · '
               || round(coalesce(a.distance_m, 0) / 1000, 2) || ' km · visibility ' || a.visibility,
             a.user_id, p.display_name, a.created_at, a.hidden_at
        from public.activities a
        left join public.profiles p on p.id = a.user_id
       where a.id = report.target_id;
  elsif report.target_type::text = 'activity_comment' then
    return query
      select report.target_type, c.body, c.author_id, p.display_name, c.created_at, c.hidden_at
        from public.activity_comments c
        left join public.profiles p on p.id = c.author_id
       where c.id = report.target_id;
  else
    return query
      select report.target_type, f.body, f.user_id, p.display_name, f.created_at, null::timestamptz
        from public.feedback f
        left join public.profiles p on p.id = f.user_id
       where f.id = report.target_id;
  end if;
end;
$$;

create or replace function public.resolve_report(
  p_report_id uuid,
  p_decision public.report_decision,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  report public.content_reports%rowtype;
  clean_note text := nullif(btrim(p_note), '');
  new_status public.report_status := case when p_decision = 'dismiss' then 'dismissed' else 'actioned' end;
begin
  if not private.is_moderator() then
    raise exception 'Moderators only' using errcode = '42501';
  end if;

  select * into report from public.content_reports cr where cr.id = p_report_id for update;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  if report.status <> 'open' then
    raise exception 'This report has already been resolved' using errcode = '55000';
  end if;
  if report.subject_id = uid or report.reporter_id = uid then
    raise exception 'Another moderator must resolve a report you are part of' using errcode = '42501';
  end if;
  if p_decision = 'hide_content' and report.target_type = 'feedback' then
    raise exception 'Feedback items cannot be hidden; uphold or dismiss the report' using errcode = '22023';
  end if;
  if clean_note is not null and char_length(clean_note) > 1000 then
    raise exception 'Notes must be 1000 characters or fewer' using errcode = '23514';
  end if;

  if p_decision = 'hide_content' then
    if report.target_type = 'message' then
      update public.messages set hidden_at = now(), hidden_by = uid
       where id = report.target_id and hidden_at is null;
      perform private.write_audit('message.hidden', 'message', report.target_id::text, report.subject_id,
        jsonb_build_object('report_id', report.id));
    elsif report.target_type::text = 'activity' then
      update public.activities set hidden_at = now(), hidden_by = uid
       where id = report.target_id and hidden_at is null;
      perform private.write_audit('activity.hidden', 'activity', report.target_id::text, report.subject_id,
        jsonb_build_object('report_id', report.id));
    elsif report.target_type::text = 'activity_comment' then
      update public.activity_comments set hidden_at = now(), hidden_by = uid
       where id = report.target_id and hidden_at is null;
      perform private.write_audit('activity_comment.hidden', 'activity_comment', report.target_id::text,
        report.subject_id, jsonb_build_object('report_id', report.id));
    else
      update public.feedback_replies set hidden_at = now(), hidden_by = uid
       where id = report.target_id and hidden_at is null;
      perform private.write_audit('feedback_reply.hidden', 'feedback_reply', report.target_id::text, report.subject_id,
        jsonb_build_object('report_id', report.id));
    end if;
  end if;

  update public.content_reports cr
     set status = new_status, decision = p_decision, resolution_note = clean_note,
         resolved_by = uid, resolved_at = now()
   where cr.id = report.id
      or (p_decision = 'hide_content' and cr.status = 'open'
          and cr.target_type = report.target_type and cr.target_id = report.target_id);

  perform private.write_audit('report.resolved', 'content_report', report.id::text, report.subject_id,
    jsonb_build_object('decision', p_decision, 'target_type', report.target_type, 'target_id', report.target_id));
end;
$$;
