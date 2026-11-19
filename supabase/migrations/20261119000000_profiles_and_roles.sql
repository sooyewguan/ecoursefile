create type public.global_role as enum ('root', 'admin', 'lecturer', 'auditor', 'hod', 'dean', 'deputy_dean');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.global_role not null,
  primary key (user_id, role)
);

-- Users read their own rows only. With no insert, update or delete policies,
-- nobody but the service role writes here, so a user cannot clear their own flag.
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

create policy "Users read their own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create policy "Users read their own roles" on public.user_roles
  for select to authenticated using ((select auth.uid()) = user_id);

-- Every new auth user gets a profile, flagged to change their password.
create function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

create trigger create_profile_after_user_insert
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

-- Setting a new password is the only way the flag clears.
create function public.clear_must_change_password()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set must_change_password = false where id = new.id;
  return new;
end;
$$;

create trigger clear_must_change_password_after_password_update
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function public.clear_must_change_password();
