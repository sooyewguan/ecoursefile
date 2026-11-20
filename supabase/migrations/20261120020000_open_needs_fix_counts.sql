-- A switched-off section counts toward completeness while its latest verdict is Needs fix, which
-- the auditor gave to challenge the switch. Before, it counted only while its status was needs_fix,
-- so deleting a file from it, or switching a flagged section off, made it stop counting although
-- the switch was just as wrong. Such a section is now pending_review once it changes, like a
-- section that is on, until the auditor gives a new verdict.

-- The status of each of the 19 sections of the offering's course file, in section order, and
-- whether the section counts toward the course file's completeness.
--
-- - missing: the section is on and has no files, except sections 7 to 9, which may stay empty.
--   Section 4 is also missing while any lecturer of the offering has no timetable, and section 5
--   while any ticked program code has none. A verdict does not change it.
-- - verified or needs_fix: the latest verdict, while section_contents still returns what it did
--   when the verdict was given.
-- - pending_review: a section with files, with no verdict or a section changed since, and a
--   switched-off section changed since a Needs fix verdict.
-- - off: a switchable section (10 to 16) that the offering has off, with no verdict or a section
--   changed since a Verified verdict.
-- - empty: sections 7 to 9 with no files, with no verdict or a section changed since.
--
-- Every section counts except a switched-off one, which counts while its latest verdict is Needs
-- fix. A caller who may not read the offering gets no rows.
create or replace function public.section_statuses(offering_id uuid)
returns table (section smallint, status public.section_status, counts_toward_completeness boolean)
language sql
stable
set search_path = ''
as $$
  select s.section, s.status, s.is_on or s.needs_fix
  from (
    select
      c.section,
      c.is_on,
      coalesce(v.verdict = 'needs_fix', false) as needs_fix,
      case
        when c.is_on and (
          (c.file_ids = '{}' and c.section not between 7 and 9)
          or (c.section = 4 and exists (
            select 1
            from public.offering_lecturers l
            where l.offering_id = o.id
              and not exists (select 1 from public.linked_files(o) f where f.lecturer_id = l.lecturer_id)
          ))
          or (c.section = 5 and exists (
            select 1
            from public.offering_program_codes t
            where t.offering_id = o.id
              and not exists (select 1 from public.linked_files(o) f where f.program_code_id = t.program_code_id)
          ))
        ) then 'missing'
        when (v.file_ids, v.section_on) = (c.file_ids, c.is_on) then v.verdict::text
        when not c.is_on and v.verdict = 'needs_fix' then 'pending_review'
        when not c.is_on then 'off'
        when c.file_ids <> '{}' then 'pending_review'
        else 'empty'
      end::public.section_status as status
    from public.offerings o
    cross join lateral public.section_contents(o) c
    left join lateral (
      select v.verdict, v.file_ids, v.section_on
      from public.section_verdicts v
      where v.offering_id = o.id and v.section = c.section
      order by v.id desc
      limit 1
    ) as v on true
    where o.id = section_statuses.offering_id
  ) as s
  order by s.section
$$;
