-- Coordinators and lecturers upload Lecture Notes (section 10) while the offering has the section
-- on. The browser merges each PDF at 8 pages per page before it uploads it, and only the merged
-- file is stored. section_statuses already shows a section that the offering has off as off,
-- whatever files it holds.

-- Whether the caller may upload to this section of the offering: a section with plain files, for
-- the offering's coordinator and lecturers, and a switchable section only while the offering has
-- it on.
create or replace function public.can_upload(offering_id uuid, section smallint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select can_upload.section in (2, 6, 7, 8, 9, 10, 17, 18, 19)
    and exists (
      select 1
      from public.offerings o
      join public.offering_lecturers l on l.offering_id = o.id and l.lecturer_id = (select auth.uid())
      where o.id = can_upload.offering_id
        and (can_upload.section not between 10 and 16 or can_upload.section = any (o.sections_on))
    )
$$;
