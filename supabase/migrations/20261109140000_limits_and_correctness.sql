-- Rate limits, aggregate reads and timezone validation (Release 0,
-- workstream E). Depends on 20261109130000_moderation_and_audit_log for
-- private.enforce_rate_limit and private.rate_limit_events.
--
-- * Per-user limits on messages, feedback, feedback replies, timetable
--   uploads and event RSVPs, enforced by triggers for the signed-in caller.
--   Workouts are written by the server with the secret key on the runner's
--   behalf, so the server consumes their limit explicitly through
--   public.consume_rate_limit(), which only the service role may call.
-- * Aggregate functions so totals and streaks no longer depend on reading
--   every row through the Data API (which returns at most 1000 rows).
-- * profiles.timezone and user_preferences.timezone must be a timezone
--   Postgres knows; an unknown value broke the weekly leaderboard.

-- ---------------------------------------------------------------------------
-- Rate limits
-- ---------------------------------------------------------------------------

-- Core limiter for an explicit subject. The existing
-- private.enforce_rate_limit(bucket, max, period) keeps working for the
-- signed-in caller and now delegates here.
create function private.enforce_rate_limit_for(subject uuid, bucket text, max_count int, period interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent int;
begin
  if subject is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(subject::text || ':' || bucket, 0));

  delete from private.rate_limit_events e
   where e.user_id = subject and e.bucket = enforce_rate_limit_for.bucket and e.created_at < now() - interval '1 day';

  select count(*) into recent
    from private.rate_limit_events e
   where e.user_id = subject
     and e.bucket = enforce_rate_limit_for.bucket
     and e.created_at > now() - period;

  if recent >= max_count then
    raise exception 'rate_limited'
      using errcode = 'PT429',
            detail = bucket,
            hint = 'Too many requests. Please wait a little and try again.';
  end if;

  insert into private.rate_limit_events (user_id, bucket) values (subject, enforce_rate_limit_for.bucket);
end;
$$;

revoke all on function private.enforce_rate_limit_for(uuid, text, int, interval) from public, anon, authenticated;

create or replace function private.enforce_rate_limit(bucket text, max_count int, period interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The service role and migrations (no signed-in user) are not limited here.
  perform private.enforce_rate_limit_for(auth.uid(), bucket, max_count, period);
end;
$$;

-- Limits per table. Each bucket has a short burst window and a daily cap.
-- Windows are counted per bucket, so the burst and daily buckets are separate.
create function private.rate_limit_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  case tg_table_name
    when 'messages' then
      perform private.enforce_rate_limit('message:burst', 20, interval '5 minutes');
      perform private.enforce_rate_limit('message:day', 300, interval '1 day');
    when 'feedback' then
      perform private.enforce_rate_limit('feedback:burst', 5, interval '1 hour');
      perform private.enforce_rate_limit('feedback:day', 20, interval '1 day');
    when 'feedback_replies' then
      perform private.enforce_rate_limit('feedback_reply:burst', 20, interval '10 minutes');
      perform private.enforce_rate_limit('feedback_reply:day', 200, interval '1 day');
    when 'timetable_uploads' then
      perform private.enforce_rate_limit('upload:burst', 10, interval '1 hour');
      perform private.enforce_rate_limit('upload:day', 30, interval '1 day');
    when 'event_rsvps' then
      -- An upsert fires BEFORE INSERT and then, on conflict, BEFORE UPDATE.
      -- Count it once: the insert path marks the row, the update path skips it.
      if tg_op = 'UPDATE' and current_setting('hyd.rsvp_counted', true) = new.event_id::text || ':' || new.user_id::text then
        perform set_config('hyd.rsvp_counted', '', true);
        return new;
      end if;
      perform private.enforce_rate_limit('rsvp:burst', 20, interval '10 minutes');
      perform private.enforce_rate_limit('rsvp:day', 100, interval '1 day');
      if tg_op = 'INSERT' then
        perform set_config('hyd.rsvp_counted', new.event_id::text || ':' || new.user_id::text, true);
      end if;
    else
      raise exception 'No rate limit defined for %', tg_table_name;
  end case;
  return new;
end;
$$;

create trigger messages_rate_limit before insert on public.messages
  for each row execute function private.rate_limit_writes();
create trigger feedback_rate_limit before insert on public.feedback
  for each row execute function private.rate_limit_writes();
create trigger feedback_replies_rate_limit before insert on public.feedback_replies
  for each row execute function private.rate_limit_writes();
create trigger timetable_uploads_rate_limit before insert on public.timetable_uploads
  for each row execute function private.rate_limit_writes();
-- RSVPs are upserted, so going/cancelled toggles count too.
create trigger event_rsvps_rate_limit before insert or update of status on public.event_rsvps
  for each row execute function private.rate_limit_writes();

-- Server-side limiter for writes made with the secret key on a user's behalf
-- (workouts). Only the service role may call it.
create function public.consume_rate_limit(p_user_id uuid, p_bucket text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  case p_bucket
    when 'workout' then
      perform private.enforce_rate_limit_for(p_user_id, 'workout:burst', 10, interval '10 minutes');
      perform private.enforce_rate_limit_for(p_user_id, 'workout:day', 60, interval '1 day');
    else
      raise exception 'Unknown rate limit bucket %', p_bucket using errcode = '22023';
  end case;
end;
$$;

revoke all on function public.consume_rate_limit(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Aggregate reads (one row each, so the 1000-row API cap never applies)
-- ---------------------------------------------------------------------------

-- The caller's lifetime XP and coins. Invoker rights: RLS limits the sum to
-- the caller's own ledger rows.
create function public.my_reward_totals()
returns table (total_xp bigint, total_coins bigint, ledger_rows bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(l.delta_xp), 0)::bigint, coalesce(sum(l.delta_coins), 0)::bigint, count(*)::bigint
  from public.xp_ledger l
  where l.user_id = (select auth.uid());
$$;

-- Every local date on which the caller completed at least `p_min_seconds` of
-- activity, oldest first, as one array (for streaks and active-day counts).
create function public.my_active_dates(p_timezone text, p_min_seconds integer default 0)
returns date[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(d order by d), '{}')
  from (
    select distinct (w.started_at at time zone p_timezone)::date as d
    from public.workout_logs w
    where w.user_id = (select auth.uid())
      and w.status = 'completed'
      and coalesce(w.duration_seconds, 0) >= p_min_seconds
  ) days;
$$;

revoke all on function public.my_reward_totals() from public, anon;
revoke all on function public.my_active_dates(text, integer) from public, anon;
grant execute on function public.my_reward_totals() to authenticated;
grant execute on function public.my_active_dates(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Timezone validation
-- ---------------------------------------------------------------------------

create function private.is_valid_timezone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select tz is not null and exists (select 1 from pg_catalog.pg_timezone_names n where n.name = tz);
$$;

create function private.validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_valid_timezone(new.timezone) then
    raise exception 'Unknown timezone "%"', left(new.timezone, 64) using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Correct values saved before validation existed, so the leaderboard and
-- planner cannot fail on them. Only invalid values change; the count is
-- reported.
do $$
declare
  fixed_profiles int;
  fixed_preferences int;
begin
  update public.profiles set timezone = 'Asia/Kolkata' where not private.is_valid_timezone(timezone);
  get diagnostics fixed_profiles = row_count;
  update public.user_preferences set timezone = 'Asia/Kolkata' where not private.is_valid_timezone(timezone);
  get diagnostics fixed_preferences = row_count;
  raise notice 'Reset % profile and % preference timezone(s) that Postgres does not recognise.', fixed_profiles, fixed_preferences;
end;
$$;

create trigger profiles_validate_timezone before insert or update of timezone on public.profiles
  for each row execute function private.validate_timezone();
create trigger user_preferences_validate_timezone before insert or update of timezone on public.user_preferences
  for each row execute function private.validate_timezone();
