-- Each user's phone number, which gets the TAC that every password change needs. The user registers
-- it at their first sign-in, when they set their own password, and changes it on their profile. An
-- admin clears it for a user who lost their phone. It is in E.164 form, such as +60123456789, and no
-- two users share one. Only the password Edge Function and the accounts function write it, with the
-- service role: the update grant on profiles leaves it out.
alter table public.profiles
  add column phone text unique check (phone ~ '^\+[1-9][0-9]{7,14}$');

-- A password changes only after the password or accounts function has checked a TAC, or an admin's
-- right to reset it, and granted the change. Supabase Auth's own updateUser would let a stolen
-- session change the password with no TAC, so the trigger below refuses any change without a grant.
-- A grant serves one change, within a minute.
create table public.password_change_grants (
  user_id uuid primary key references auth.users (id) on delete cascade,
  expires_at timestamptz not null
);

alter table public.password_change_grants enable row level security;
revoke all on public.password_change_grants from anon, authenticated;

-- Grants the user's next password change, for the Edge Functions and the seed script, which call it
-- with the service role just before they set the password through the Supabase Auth admin API.
create function public.allow_password_change(user_id uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.password_change_grants (user_id, expires_at)
  values (allow_password_change.user_id, now() + interval '1 minute')
  on conflict (user_id) do update set expires_at = excluded.expires_at
$$;

revoke execute on function public.allow_password_change from anon, authenticated, public;

-- Uses up the user's grant, or refuses the password change. Supabase Auth then fails the request
-- with HTTP 500, and the password stays as it was.
create function public.require_password_change_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.password_change_grants g where g.user_id = new.id and g.expires_at > now();
  if not found then
    raise exception 'A password changes only with a TAC, through the password Edge Function.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger require_password_change_grant_before_password_update
  before update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function public.require_password_change_grant();
