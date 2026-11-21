-- Admins no longer read root users. Root still reads every user, and an admin reads every user who
-- is not root, with their roles. Root's profile and roles never reach an admin's Users page.

-- Whether the user holds root. It reads user_roles as its owner, so the policies below can ask it
-- without running the user_roles policies again.
create function public.is_root(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.user_roles r where r.user_id = is_root.user_id and r.role = 'root')
$$;

revoke execute on function public.is_root from anon, public;

-- may_grant and can_manage read the target's roles as the caller. An admin no longer sees a root
-- user's roles, so both ask is_root instead, or an admin could change root's roles or password.
create or replace function public.may_grant(target uuid, granted public.global_role)
returns boolean
language sql
stable
set search_path = ''
as $$
  select granted = any(public.assignable_roles())
    and target is distinct from (select auth.uid())
    and not public.is_root(target)
$$;

create or replace function public.can_manage(target uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select 'admin' = any(public.jwt_roles())
    and target is distinct from (select auth.uid())
    and not public.is_root(target)
    and not exists (select 1 from public.user_roles r where r.user_id = target and r.role = 'admin')
$$;

drop policy "Root and admins read every profile" on public.profiles;
drop policy "Root and admins read every role" on public.user_roles;

create policy "Root reads every profile, and admins every profile but root's" on public.profiles
  for select to authenticated using (
    (select public.jwt_roles()) @> '{root}'
    or ((select public.jwt_roles()) @> '{admin}' and not public.is_root(id))
  );

create policy "Root reads every role, and admins every role but root users'" on public.user_roles
  for select to authenticated using (
    (select public.jwt_roles()) @> '{root}'
    or ((select public.jwt_roles()) @> '{admin}' and not public.is_root(user_id))
  );
