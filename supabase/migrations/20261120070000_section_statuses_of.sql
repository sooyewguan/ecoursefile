-- Section statuses for a set of offerings at once. The completeness reports read the statuses of
-- every offering of a semester. Calling section_statuses once per offering repeated its lookups for
-- each one: about 1 ms per offering as the table owner. As the caller it also checked the RLS policy
-- of files on every file row it read, about 65 ms per offering. So section_contents and
-- section_statuses now each have a form that takes a set of offerings, and the one-offering forms
-- read from it. section_statuses checks once that the caller reads the offering, then reads as its
-- owner.

-- What an auditor judges in each of the 19 sections of each of the offerings' course files: whether
-- the section is on, and the sorted ids of its files. A section's files are its own and the shared
-- files that the course file links into it, matched on linked_shared_keys.
create function public.section_contents_of(offering_ids uuid[])
returns table (offering_id uuid, section smallint, is_on boolean, file_ids uuid[])
language sql
stable
set search_path = ''
as $$
  select
    o.id,
    g.section::smallint,
    g.section not between 10 and 16 or g.section = any (o.sections_on),
    coalesce(f.ids, '{}')
  from public.offerings o
  cross join generate_series(1, 19) as g (section)
  left join (
    select f.offering_id, f.section, array_agg(f.id order by f.id) as ids
    from (
      select f.offering_id, f.id, f.section
      from public.files f
      where f.offering_id = any (section_contents_of.offering_ids)
      union all
      select o.id, f.id, f.section
      from public.offerings o
      cross join lateral public.linked_shared_keys(o) k
      join public.files f
        on f.semester_id = o.semester_id
        and (f.lecturer_id, f.program_code_id) is not distinct from (k.lecturer_id, k.program_code_id)
      where o.id = any (section_contents_of.offering_ids)
    ) as f
    group by f.offering_id, f.section
  ) as f on (f.offering_id, f.section) = (o.id, g.section)
  where o.id = any (section_contents_of.offering_ids)
$$;

-- section_contents of one offering, in section order.
create or replace function public.section_contents(public.offerings)
returns table (section smallint, is_on boolean, file_ids uuid[])
language sql
stable
set search_path = ''
as $$
  select c.section, c.is_on, c.file_ids from public.section_contents_of(array[$1.id]) c order by c.section
$$;

-- The status of each of the 19 sections of each of the offerings' course files, and whether the
-- section counts toward the course file's completeness.
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
-- fix. Clients cannot call it. section_statuses and the report RPCs check which offerings the
-- caller reads, then call it as its owner.
create function public.section_statuses_of(offering_ids uuid[])
returns table (offering_id uuid, section smallint, status public.section_status, counts_toward_completeness boolean)
language sql
stable
set search_path = ''
as $$
  select
    c.offering_id,
    c.section,
    case
      when c.is_on and (
        (c.file_ids = '{}' and c.section not between 7 and 9)
        or (c.section = 4 and exists (
          select 1
          from public.offering_lecturers l
          where l.offering_id = c.offering_id
            and not exists (select 1 from public.files f where f.id = any (c.file_ids) and f.lecturer_id = l.lecturer_id)
        ))
        or (c.section = 5 and exists (
          select 1
          from public.offering_program_codes t
          where t.offering_id = c.offering_id
            and not exists (select 1 from public.files f where f.id = any (c.file_ids) and f.program_code_id = t.program_code_id)
        ))
      ) then 'missing'
      when (v.file_ids, v.section_on) = (c.file_ids, c.is_on) then v.verdict::text
      when not c.is_on and v.verdict = 'needs_fix' then 'pending_review'
      when not c.is_on then 'off'
      when c.file_ids <> '{}' then 'pending_review'
      else 'empty'
    end::public.section_status,
    c.is_on or coalesce(v.verdict = 'needs_fix', false)
  from public.section_contents_of(section_statuses_of.offering_ids) c
  left join (
    select distinct on (v.offering_id, v.section) v.offering_id, v.section, v.verdict, v.file_ids, v.section_on
    from public.section_verdicts v
    where v.offering_id = any (section_statuses_of.offering_ids)
    order by v.offering_id, v.section, v.id desc
  ) as v on (v.offering_id, v.section) = (c.offering_id, c.section)
$$;

-- section_statuses_of one offering, in section order. A caller who may not read the offering gets
-- no rows.
create or replace function public.section_statuses(offering_id uuid)
returns table (section smallint, status public.section_status, counts_toward_completeness boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.section, s.status, s.counts_toward_completeness
  from public.section_statuses_of(array[section_statuses.offering_id]) s
  where public.can_read_offering(section_statuses.offering_id)
  order by s.section
$$;

revoke execute on function public.section_contents_of from anon, public;
revoke execute on function public.section_statuses_of from anon, authenticated, public;
