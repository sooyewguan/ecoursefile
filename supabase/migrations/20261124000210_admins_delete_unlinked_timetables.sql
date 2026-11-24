-- An admin deletes a lecturer's timetable that no course file links, such as the timetable of a
-- lecturer taken off every offering of its semester, or of a lecturer whose only offering was
-- deleted. No course file lists it, so its lecturer has no page to delete it from. A timetable that
-- a course file links stays its lecturer's to delete.

-- Whether the caller may delete the file: for a timetable, its lecturer, and an admin while no
-- course file links it; for another shared file, an admin; for a course file's file, its uploader
-- or the offering's coordinator, while they teach the offering.
create or replace function public.deletable(public.files)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when $1.lecturer_id is not null then
      $1.lecturer_id = (select auth.uid())
      or ((select public.jwt_roles()) @> '{admin}' and not exists (select 1 from public.linked_offerings($1)))
    when $1.offering_id is null then (select public.jwt_roles()) @> '{admin}'
    else exists (
      select 1
      from public.offerings o
      join public.offering_lecturers l on l.offering_id = o.id and l.lecturer_id = (select auth.uid())
      where o.id = $1.offering_id and l.lecturer_id in (o.coordinator_id, $1.uploaded_by)
    )
  end
$$;
