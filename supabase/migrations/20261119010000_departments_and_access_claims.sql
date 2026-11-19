create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null
);

alter table public.departments enable row level security;

-- An HoD's department is their profile's department, so one department can have several HoDs.
-- A deactivated user keeps their profile, so their name still shows wherever it appears.
alter table public.profiles
  add column department_id uuid references public.departments (id) on delete restrict,
  add column active boolean not null default true;

-- Runs each time Supabase Auth issues an access token, at sign-in and at every refresh.
-- It adds the user's global roles as the app_roles claim, and refuses the token when the
-- profile is inactive, so a deactivated user can neither sign in nor keep a session going.
create function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  uid uuid := (event ->> 'user_id')::uuid;
  roles jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = uid and p.active) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'This account is deactivated.'));
  end if;

  select coalesce(jsonb_agg(r.role order by r.role), '[]'::jsonb) into roles
  from public.user_roles r
  where r.user_id = uid;

  return jsonb_set(event, '{claims,app_roles}', roles);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

grant select on table public.profiles, public.user_roles to supabase_auth_admin;

create policy "Auth reads profiles to issue tokens" on public.profiles
  for select to supabase_auth_admin using (true);

create policy "Auth reads roles to issue tokens" on public.user_roles
  for select to supabase_auth_admin using (true);
