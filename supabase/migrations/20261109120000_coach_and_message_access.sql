-- Coach and private-message access (Release 0, workstream A).
--
-- 1. Coach-specific access needs BOTH a current staff role and an assignment.
--    Before this migration, the policies on profiles, user_preferences,
--    feedback and feedback_replies checked only the assignment (or the
--    feedback assignee), so a coach whose role was revoked kept access.
-- 2. Revoking someone's last staff role removes their coach assignments and
--    returns feedback assigned to them to the managers' queue. Enrolments,
--    feedback, replies and messages themselves are never deleted.
-- 3. Private messages are readable only by their sender and recipient.
--    Managers and admins lose blanket read access; reported messages reach
--    moderators only through the moderation workflow (next migration).
-- 4. Runners may message staff only where a relationship exists: their own
--    active coach or mentor, or a manager/admin who has already written to
--    them. Runners without a coach reach the programme team through Feedback.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Roles that may hold coach assignments. Matches private.coach_assignment_roles.
create function private.holds_assignee_role(person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = person
      and ur.role in ('coach', 'mentor', 'programme_manager', 'admin')
  );
$$;

-- True when `coach` is assigned to `runner` AND still holds an assignee role.
-- Every coach-specific policy goes through this one function.
create function private.is_active_coach(coach uuid, runner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coach is not null
    and runner is not null
    and exists (
      select 1
      from public.coach_assignments ca
      where ca.coach_id = coach
        and ca.runner_id = runner
    )
    and private.holds_assignee_role(coach);
$$;

comment on function private.is_active_coach(uuid, uuid) is
  'Coach-specific access check: an assignment plus a current coach, mentor, manager or admin role.';

revoke all on function private.holds_assignee_role(uuid) from public;
revoke all on function private.is_active_coach(uuid, uuid) from public;
grant execute on function private.holds_assignee_role(uuid) to authenticated;
grant execute on function private.is_active_coach(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Coach policies: role + assignment
-- ---------------------------------------------------------------------------

drop policy "profiles: coaches read assigned" on public.profiles;
create policy "profiles: coaches read assigned"
  on public.profiles for select to authenticated
  using ((select private.is_active_coach((select auth.uid()), profiles.id)));

drop policy "user_preferences: coaches read assigned" on public.user_preferences;
create policy "user_preferences: coaches read assigned"
  on public.user_preferences for select to authenticated
  using ((select private.is_active_coach((select auth.uid()), user_preferences.user_id)));

-- An assignee sees feedback assigned to them only while they hold a staff role.
drop policy "feedback: read visible" on public.feedback;
create policy "feedback: read visible"
  on public.feedback for select to authenticated
  using (
    user_id = (select auth.uid())
    or (assigned_to = (select auth.uid()) and (select private.holds_assignee_role((select auth.uid()))))
    or (select private.has_role('programme_manager'))
    or (select private.has_role('admin'))
  );

drop policy "feedback_replies: read with parent" on public.feedback_replies;
create policy "feedback_replies: read with parent"
  on public.feedback_replies for select to authenticated
  using (
    exists (
      select 1
      from public.feedback f
      where f.id = feedback_id
        and (
          f.user_id = (select auth.uid())
          or (f.assigned_to = (select auth.uid()) and (select private.holds_assignee_role((select auth.uid()))))
          or (select private.has_role('programme_manager'))
          or (select private.has_role('admin'))
        )
    )
  );

drop policy "feedback_replies: insert authorized" on public.feedback_replies;
create policy "feedback_replies: insert authorized"
  on public.feedback_replies for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1
      from public.feedback f
      where f.id = feedback_id
        and (
          f.user_id = (select auth.uid())
          or (f.assigned_to = (select auth.uid()) and (select private.holds_assignee_role((select auth.uid()))))
          or (select private.has_role('programme_manager'))
          or (select private.has_role('admin'))
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Messages: participants only
-- ---------------------------------------------------------------------------

drop policy "messages: participants read" on public.messages;
create policy "messages: participants read"
  on public.messages for select to authenticated
  using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));

-- Who the caller may start or continue a conversation with.
create or replace function private.can_message(recipient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    recipient is not null
    and (select auth.uid()) is not null
    and recipient is distinct from (select auth.uid())
    and (
      -- Managers and admins may write to anyone.
      (select private.has_role('programme_manager'))
      or (select private.has_role('admin'))
      -- An active coach or mentor and their runner, in either direction.
      or private.is_active_coach((select auth.uid()), recipient)
      or private.is_active_coach(recipient, (select auth.uid()))
      -- A reply to a manager or admin who has already written to the caller.
      or (
        exists (
          select 1
          from public.user_roles ur
          where ur.user_id = recipient
            and ur.role in ('programme_manager', 'admin')
        )
        and exists (
          select 1
          from public.messages m
          where m.sender_id = recipient
            and m.recipient_id = (select auth.uid())
        )
      )
    );
$$;

comment on function private.can_message(uuid) is
  'Managers/admins: anyone. Coaches/mentors: active assigned runners. Runners: their active coach, or a manager/admin who wrote to them first.';

-- ---------------------------------------------------------------------------
-- Revocation cleanup
-- ---------------------------------------------------------------------------

create function private.cleanup_after_role_revoked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role in ('coach', 'mentor', 'programme_manager', 'admin')
     and not private.holds_assignee_role(old.user_id) then
    delete from public.coach_assignments where coach_id = old.user_id;
    -- The feedback stays; it returns to the managers' unassigned queue.
    update public.feedback set assigned_to = null where assigned_to = old.user_id;
  end if;
  return old;
end;
$$;

comment on function private.cleanup_after_role_revoked() is
  'When someone loses their last staff role, remove their coach assignments and unassign their feedback.';

create trigger user_roles_cleanup_after_revoke
  after delete on public.user_roles
  for each row execute function private.cleanup_after_role_revoked();

-- Restore the invariant for rows left by earlier revocations: assignments and
-- feedback assignments whose holder no longer has any staff role grant
-- nothing under the policies above, but would silently return if the role
-- were granted again.
do $$
declare
  stale_assignments int;
  stale_feedback int;
begin
  delete from public.coach_assignments ca
   where not private.holds_assignee_role(ca.coach_id);
  get diagnostics stale_assignments = row_count;

  update public.feedback f
     set assigned_to = null
   where f.assigned_to is not null
     and not private.holds_assignee_role(f.assigned_to);
  get diagnostics stale_feedback = row_count;

  raise notice 'Removed % stale coach assignment(s); unassigned % feedback item(s).', stale_assignments, stale_feedback;
end;
$$;
