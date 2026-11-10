-- Storytelling and profile customisation.
--
-- * activity_reflections: the runner's own words about an activity (what was
--   hard, what they enjoyed, who they ran with, what they achieved, a story).
--   Private by default; shared only when the runner ticks "show my story"
--   and the viewer can already see the activity.
-- * Profile customisation: theme, up to six showcased badges (that the runner
--   has earned), up to five favourite routes, and opt-in race history.
--   runner_showcase() returns them under the same block rules as
--   runner_profile().

create table public.activity_reflections (
  activity_id uuid primary key references public.activities (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  difficult text check (difficult is null or char_length(difficult) <= 300),
  enjoyed text check (enjoyed is null or char_length(enjoyed) <= 300),
  ran_with text check (ran_with is null or char_length(ran_with) <= 120),
  achieved text check (achieved is null or char_length(achieved) <= 300),
  story text check (story is null or char_length(story) <= 1500),
  share_story boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger activity_reflections_updated_at before update on public.activity_reflections
  for each row execute function private.set_updated_at();

create function private.reflections_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.activities a where a.id = new.activity_id and a.user_id = new.user_id) then
    raise exception 'activity not found' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger activity_reflections_guard before insert or update on public.activity_reflections
  for each row execute function private.reflections_guard();

alter table public.activity_reflections enable row level security;
revoke all on public.activity_reflections from anon, authenticated;
grant select, delete on public.activity_reflections to authenticated;
grant insert (activity_id, user_id, difficult, enjoyed, ran_with, achieved, story, share_story) on public.activity_reflections to authenticated;
grant update (difficult, enjoyed, ran_with, achieved, story, share_story) on public.activity_reflections to authenticated;
create policy "activity_reflections: owner" on public.activity_reflections for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Others see a shared story only on an activity they can already see (activities RLS applies in the subquery).
create policy "activity_reflections: shared story" on public.activity_reflections for select to authenticated
  using (share_story and exists (select 1 from public.activities a where a.id = activity_id));

-- Profile customisation ----------------------------------------------------------------

alter table public.profiles
  add column profile_theme text not null default 'classic' check (profile_theme in ('classic', 'night', 'sunrise', 'lake')),
  add column showcase_badges text[] not null default '{}' check (cardinality(showcase_badges) <= 6),
  add column favourite_route_ids uuid[] not null default '{}' check (cardinality(favourite_route_ids) <= 5),
  add column show_race_history boolean not null default false;
grant update (profile_theme, showcase_badges, favourite_route_ids, show_race_history) on public.profiles to authenticated;

create function public.runner_showcase(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  p public.profiles;
begin
  if uid is null then raise exception 'Sign in to view runners' using errcode = '42501'; end if;
  if private.is_blocked_between(p_user, uid) then return null; end if;
  select * into p from public.profiles where id = p_user;
  if p.id is null then return null; end if;
  return jsonb_build_object(
    'theme', p.profile_theme,
    -- Only badges the runner has actually earned are shown.
    'badges', coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'title', b.title, 'earnedAt', ub.earned_at)
                                         order by array_position(p.showcase_badges, b.code))
                        from public.user_badges ub join public.badges b on b.code = ub.badge_code
                        where ub.user_id = p.id and b.code = any (p.showcase_badges)), '[]'::jsonb),
    -- Only published routes.
    'routes', coalesce((select jsonb_agg(jsonb_build_object('slug', r.slug, 'name', r.name, 'distanceM', r.distance_m))
                        from public.routes r where r.id = any (p.favourite_route_ids) and r.status = 'published'), '[]'::jsonb),
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('slug', c.slug, 'name', c.name) order by c.name)
                       from public.club_members m join public.clubs c on c.id = m.club_id
                       where m.user_id = p.id and m.status = 'active' and c.status = 'active'), '[]'::jsonb),
    'races', case when p.show_race_history or p.id = uid then coalesce((
               select jsonb_agg(x order by x->>'date' desc) from (
                 select jsonb_build_object('name', e.title, 'date', (e.starts_at at time zone 'Asia/Kolkata')::date,
                                           'seconds', er.finish_seconds, 'source', 'organizer_verified') x
                   from public.event_results er join public.events e on e.id = er.event_id
                  where er.user_id = p.id and er.outcome = 'finished'
                 union all
                 select jsonb_build_object('name', re.name, 'date', re.race_date, 'seconds', re.result_seconds, 'source', re.result_source)
                   from public.race_entries re
                  where re.user_id = p.id and re.status = 'completed' and re.result_seconds is not null
                    and (re.event_id is null or not exists (select 1 from public.event_results er2
                                                              where er2.event_id = re.event_id and er2.user_id = p.id))
                 limit 20) q), '[]'::jsonb) else null end,
    'bests', case when p.id = uid or p.show_race_history then coalesce((
               select jsonb_object_agg(k, s) from (
                 select e.key k, min(e.value::integer) s from public.activities a, jsonb_each_text(a.best_efforts) e
                  where a.user_id = p.id and a.status = 'ready' and a.visibility <> 'private' and e.key in ('5k', '10k', 'half', 'marathon')
                  group by e.key) b), '{}'::jsonb) else null end
  );
end;
$$;
revoke all on function public.runner_showcase(uuid) from public, anon;
grant execute on function public.runner_showcase(uuid) to authenticated;
