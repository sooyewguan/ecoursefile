-- The activity of a course file, for the Activity tab of its page. A course file's activity is the
-- log entries of its offering, and those of the shared files that it links: the calendar and letter
-- of its semester, the timetables of its lecturers and the student timetables of the program codes
-- it ticks. A course file links the lecturers and ticks it has now, as linked_files has it, so the
-- activity follows the same rule. The database does not record when a lecturer was assigned, so the
-- activity holds a lecturer's timetable entries while the lecturer teaches the offering, and a code's
-- while the code is ticked. A tick and an untick are entries of the offering, and stay.
--
-- course_file_activity checks once that the caller reads the offering, then reads the log as its
-- owner, a page at a time from an index, newest first. Reading the log as the caller would run the
-- RLS policy's checks on every entry of the offering before it sorted them.

-- The keys of the shared files that the offering's course file links, in its semester: no lecturer
-- and no program code for the calendar and the letter, each of its lecturers for their timetable,
-- and each program code it ticks for its student timetable. linked_files and course_file_activity
-- both match on them.
create function public.linked_shared_keys(public.offerings)
returns table (lecturer_id uuid, program_code_id uuid)
language sql
stable
set search_path = ''
as $$
  select null::uuid, null::uuid
  union all
  select l.lecturer_id, null from public.offering_lecturers l where l.offering_id = $1.id
  union all
  select null, t.program_code_id from public.offering_program_codes t where t.offering_id = $1.id
$$;

-- The shared files linked into the offering's course file: the files of its semester with one of
-- its linked_shared_keys.
create or replace function public.linked_files(public.offerings)
returns setof public.files
language sql
stable
set search_path = ''
as $$
  select f.*
  from public.files f
  where f.semester_id = $1.semester_id
    and exists (
      select 1
      from public.linked_shared_keys($1) k
      where (k.lecturer_id, k.program_code_id) is not distinct from (f.lecturer_id, f.program_code_id)
    )
$$;

-- Each page of an offering's or a semester's entries is a range of one of these, read backwards.
drop index public.activity_log_offering_id_idx;
create index activity_log_offering_id_created_at_idx on public.activity_log (offering_id, created_at, id);
create index activity_log_semester_id_created_at_idx on public.activity_log (semester_id, created_at, id)
  where semester_id is not null;

-- A page of the activity of the offering's course file, newest first: at most page_size entries
-- older than the entry with before_created_at and before_id, or the newest entries when both are
-- null. Each entry has its actor's name, the code of its program code, and for a reuse the course
-- code and semester code of the past offering, which a lecturer of this offering may not read. A
-- deactivated actor keeps their name. A caller who may not read the offering, or an offering that
-- does not exist, fails with Postgres error 42501.
create function public.course_file_activity(
  offering_id uuid,
  before_created_at timestamptz default null,
  before_id bigint default null,
  page_size integer default 50
)
returns table (
  id bigint,
  created_at timestamptz,
  action public.activity_action,
  section smallint,
  actor_name text,
  file_name text,
  program_code text,
  source_course_code text,
  source_semester_code text,
  reason text,
  comment text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  target public.offerings;
  -- The first page starts after every entry.
  cursor_created_at timestamptz := coalesce(course_file_activity.before_created_at, 'infinity');
  cursor_id bigint := coalesce(course_file_activity.before_id, 9223372036854775807);
begin
  select * into target from public.offerings o where o.id = course_file_activity.offering_id;
  if not found or not public.can_read_offering(target.id) then
    raise exception 'You may not read the activity of this course file.' using errcode = '42501';
  end if;

  return query
  select a.id, a.created_at, a.action, a.section, p.full_name, a.file_name, c.code, sc.code, ss.code, a.reason, a.comment
  from (
    (
      select *
      from public.activity_log a
      where a.offering_id = target.id and (a.created_at, a.id) < (cursor_created_at, cursor_id)
      order by a.created_at desc, a.id desc
      limit course_file_activity.page_size
    )
    union all
    (
      select *
      from public.activity_log a
      where a.semester_id = target.semester_id
        and (a.created_at, a.id) < (cursor_created_at, cursor_id)
        and exists (
          select 1
          from public.linked_shared_keys(target) k
          where (k.lecturer_id, k.program_code_id) is not distinct from (a.lecturer_id, a.program_code_id)
        )
      order by a.created_at desc, a.id desc
      limit course_file_activity.page_size
    )
  ) as a
  join public.profiles p on p.id = a.actor_id
  left join public.program_codes c on c.id = a.program_code_id
  left join public.offerings so on so.id = a.source_offering_id
  left join public.courses sc on sc.id = so.course_id
  left join public.semesters ss on ss.id = so.semester_id
  order by a.created_at desc, a.id desc
  limit course_file_activity.page_size;
end;
$$;

revoke execute on function public.linked_shared_keys, public.course_file_activity from anon, public;
