-- The lecturer's email, for everyone who reads the offering's lecturers, as lecturer_name gives
-- their name. The course file page links each of its coordinator and lecturers by email, and an
-- auditor whose request notified nobody emails them from it. Lecturers cannot read other profiles.
create function public.lecturer_email(public.offering_lecturers)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.email from public.profiles p where p.id = $1.lecturer_id
$$;

revoke execute on function public.lecturer_email from anon, public;
