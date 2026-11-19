-- Every authorization rule for user and role management lives in this file. RLS policies,
-- the accounts Edge Function and the app all ask these functions.

-- The caller's global roles, from the app_roles claim that the access token hook adds.
create function public.jwt_roles()
returns public.global_role[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(r::public.global_role), '{}')
  from jsonb_array_elements_text(coalesce(auth.jwt() -> 'app_roles', '[]')) as r
$$;

-- The roles the caller may grant and revoke. Root grants admin, admins grant staff roles,
-- and nobody grants root.
create function public.assignable_roles()
returns public.global_role[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct g.granted order by g.granted), '{}')
  from (
    values
      ('root'::public.global_role, 'admin'::public.global_role),
      ('admin', 'lecturer'),
      ('admin', 'auditor'),
      ('admin', 'hod'),
      ('admin', 'dean'),
      ('admin', 'deputy_dean')
  ) as g (grantor, granted)
  where g.grantor = any(public.jwt_roles())
$$;

-- Whether the caller may grant or revoke this role for this user. Nobody changes their own
-- roles or the roles of a root user.
create function public.may_grant(target uuid, granted public.global_role)
returns boolean
language sql
stable
set search_path = ''
as $$
  select granted = any(public.assignable_roles())
    and target is distinct from (select auth.uid())
    and not exists (select 1 from public.user_roles r where r.user_id = target and r.role = 'root')
$$;

-- Whether the caller may edit this user's profile, deactivate them or reset their password.
-- Admins manage everyone except themselves, other admins and root. Root manages nobody.
create function public.can_manage(target uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select 'admin' = any(public.jwt_roles())
    and target is distinct from (select auth.uid())
    and not exists (select 1 from public.user_roles r where r.user_id = target and r.role in ('admin', 'root'))
$$;

-- The same answer as a column, so the app can read it with each profile: select=*,manageable
create function public.manageable(public.profiles)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.can_manage($1.id)
$$;

revoke execute on function public.jwt_roles, public.assignable_roles, public.may_grant, public.can_manage,
  public.manageable from anon, public;

create policy "Root and admins read every profile" on public.profiles
  for select to authenticated using ((select public.jwt_roles()) && '{root,admin}');

create policy "Root and admins read every role" on public.user_roles
  for select to authenticated using ((select public.jwt_roles()) && '{root,admin}');

-- Clients may write only these profile columns. The email belongs to Supabase Auth, and the
-- must-change-password flag follows password changes.
revoke update on public.profiles from authenticated, anon;
grant update (full_name, department_id, active) on public.profiles to authenticated;

-- An HoD always has a department.
create policy "Admins edit the profiles they manage" on public.profiles
  for update to authenticated
  using (public.can_manage(id))
  with check (
    public.can_manage(id)
    and (
      department_id is not null
      or not exists (select 1 from public.user_roles r where r.user_id = profiles.id and r.role = 'hod')
    )
  );

create policy "Granting a role follows the grant rules" on public.user_roles
  for insert to authenticated
  with check (
    public.may_grant(user_id, role)
    and (
      role <> 'hod'
      or exists (select 1 from public.profiles p where p.id = user_roles.user_id and p.department_id is not null)
    )
  );

create policy "Revoking a role follows the grant rules" on public.user_roles
  for delete to authenticated using (public.may_grant(user_id, role));

create policy "Signed-in users read departments" on public.departments
  for select to authenticated using (true);

create policy "Admins manage departments" on public.departments
  for all to authenticated
  using ((select public.jwt_roles()) @> '{admin}')
  with check ((select public.jwt_roles()) @> '{admin}');
