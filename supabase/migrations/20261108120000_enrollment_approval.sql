-- Coach-led enrolments: only a reviewer can approve a request.
--
-- Before this migration the update guard blocked only the direct
-- requested -> active change, while the runner update policy allowed
-- requested -> paused and then paused -> active, so a runner could approve
-- their own request in two steps. Any staff member could also approve their
-- own request, and runners could set coach_id and started_at on insert.
--
-- Now every status change made through the API is checked against an
-- explicit list of transitions:
--   runner (own row):  requested -> withdrawn
--                      active    -> paused | withdrawn
--                      paused    -> active | withdrawn
--   reviewer:          requested -> active | withdrawn   (never their own)
-- A reviewer is a programme manager or admin, or a user who currently holds
-- the coach role and is assigned to the runner. Completion stays server-side
-- (secret key).

-- Who may review (read and decide) a runner's enrolments.
create function private.can_review_enrollment(runner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select runner is distinct from (select auth.uid())
    and (
      exists (
        select 1 from public.user_roles ur
        where ur.user_id = (select auth.uid())
          and ur.role in ('programme_manager', 'admin')
      )
      or exists (
        -- The assignment alone is not enough: a revoked coach keeps their
        -- assignment rows, so the coach role must still be held.
        select 1
        from public.coach_assignments ca
        join public.user_roles ur on ur.user_id = ca.coach_id and ur.role = 'coach'
        where ca.coach_id = (select auth.uid())
          and ca.runner_id = runner
      )
    );
$$;

revoke all on function private.can_review_enrollment(uuid) from public;
grant execute on function private.can_review_enrollment(uuid) to authenticated;

create or replace function private.enrollment_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  -- Server-side writes (completion, demo data) use the secret key.
  if current_user in ('service_role', 'postgres') then
    return new;
  end if;
  if new.status = old.status then
    return new;
  end if;

  if old.status = 'requested' then
    if new.status = 'withdrawn' and caller = old.user_id then
      return new;
    end if;
    if new.status in ('active', 'withdrawn') and private.can_review_enrollment(old.user_id) then
      if new.status = 'active' then
        new.started_at := now();
        new.coach_id := caller;
      end if;
      return new;
    end if;
    raise exception 'enrolment requires coach approval' using errcode = '42501';
  end if;

  if caller = old.user_id and (old.status, new.status) in (
    ('active', 'paused'), ('active', 'withdrawn'), ('paused', 'active'), ('paused', 'withdrawn')
  ) then
    return new;
  end if;
  raise exception 'enrolment cannot change from % to %', old.status, new.status using errcode = '42501';
end;
$$;

-- Runners send only who and which programme; the insert trigger sets status
-- and started_at (status stays insertable so existing clients keep working,
-- but its value is ignored). coach_id is set only on approval.
revoke insert on public.enrollments from authenticated;
grant insert (user_id, programme_id, status) on public.enrollments to authenticated;

-- Staff no longer read every enrolment: reviewers read the runners they review.
drop policy "enrollments: staff read" on public.enrollments;

create policy "enrollments: reviewers read"
  on public.enrollments for select to authenticated
  using ((select private.can_review_enrollment(user_id)));

create policy "enrollments: reviewers decide requests"
  on public.enrollments for update to authenticated
  using (status = 'requested' and (select private.can_review_enrollment(user_id)))
  with check (status in ('active', 'withdrawn') and (select private.can_review_enrollment(user_id)));
