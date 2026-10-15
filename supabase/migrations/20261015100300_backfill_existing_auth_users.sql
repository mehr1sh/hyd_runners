-- Backfill profiles and the baseline runner role for accounts that existed
-- before the auth.users signup trigger was installed. Conflict handling keeps
-- existing profile names and roles unchanged.

insert into public.profiles (id, display_name)
select
  u.id,
  left(
    coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
      nullif(
        split_part(coalesce(nullif(btrim(u.email), ''), 'runner'), '@', 1),
        ''
      ),
      'Runner'
    ),
    60
  )
from auth.users as u
on conflict (id) do nothing;

insert into public.user_roles (user_id, role)
select p.id, 'runner'::public.app_role
from public.profiles as p
join auth.users as u on u.id = p.id
on conflict (user_id, role) do nothing;
