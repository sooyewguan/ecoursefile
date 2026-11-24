-- The admin changes an offering's course, or deletes the offering, while its course file is not in
-- use. A course file is in use once it has an item or an entry in its activity log: an upload, a
-- reuse, a switch, a tick, a verdict or an audit request, even of a file deleted since. The log
-- keeps every entry and names the offering, and the course names the folder that holds the files,
-- so an offering in use keeps its course and stays. Its coordinator and lecturers still change.

-- Whether the offering's course file is in use. The app reads it with each offering:
-- select=*,in_use
create function public.in_use(public.offerings)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.activity_log a where a.offering_id = $1.id)
    or exists (select 1 from public.items i where i.offering_id = $1.id)
$$;

grant update (course_id) on public.offerings to authenticated;
alter policy "Admins change coordinators" on public.offerings rename to "Admins change offerings";

-- A new course gives the offering its course type's sections, as a new offering gets them. Saving
-- the same course again leaves them, so later edits to the type still leave the offering as it was.
create trigger copy_course_type_sections_before_course_change
  before update of course_id on public.offerings
  for each row when (old.course_id is distinct from new.course_id)
  execute function public.copy_course_type_sections();

-- An offering in use keeps its course. It fails with 23503, as deleting it does, because what its
-- course file holds refers to it.
create function public.keep_course_in_use()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.in_use(old) then
    raise exception 'This course file is in use, so the offering keeps its course.' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger keep_course_in_use_before_course_change
  before update of course_id on public.offerings
  for each row when (old.course_id is distinct from new.course_id)
  execute function public.keep_course_in_use();

-- Its lecturers go with it. The foreign keys of its files, items, ticks, verdicts, audit requests
-- and activity log refuse the delete of an offering in use with 23503.
create policy "Admins delete offerings" on public.offerings
  for delete to authenticated using ((select public.jwt_roles()) @> '{admin}');

revoke execute on function public.in_use, public.keep_course_in_use from anon, public;
