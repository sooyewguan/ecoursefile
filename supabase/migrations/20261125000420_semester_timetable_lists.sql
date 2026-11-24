-- The semester page lists what the semester still lacks. The student timetable list holds every
-- program code, with its timetable for the semester or none. The lecturer timetable list holds every
-- lecturer who teaches an offering of the semester, with their timetable or none, and every
-- timetable of the semester whose lecturer no longer teaches there, which the admin may delete.
-- missing marks a row without its timetable, so the app lists those first and counts them. Both
-- lists are the admin's: anyone else reads no rows.

-- A shared file as the semester page shows it: who uploaded it and when, whether the caller may
-- delete it, and the offerings whose course files link it, as linked_offerings gives them.
create function public.shared_file_summary(public.files)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', $1.id,
    'section', $1.section,
    'name', $1.name,
    'uploaded_at', $1.uploaded_at,
    'uploader_name', public.uploader_name($1),
    'deletable', public.deletable($1),
    'linked_offerings', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'course', jsonb_build_object('code', c.code, 'title', c.title)) order by c.code)
      from public.linked_offerings($1) o
      join public.courses c on c.id = o.course_id
    ), '[]')
  )
$$;

create function public.semester_student_timetables(semester_id uuid)
returns table (program_code_id uuid, code text, missing boolean, file jsonb)
language sql
stable
set search_path = ''
as $$
  select p.id, p.code, f.id is null, case when f.id is not null then public.shared_file_summary(f) end
  from public.program_codes p
  left join public.files f
    on f.semester_id = semester_student_timetables.semester_id and f.section = 5 and f.program_code_id = p.id
  where (select public.jwt_roles()) @> '{admin}'
$$;

create function public.semester_lecturer_timetables(semester_id uuid)
returns table (lecturer_id uuid, display_name text, full_name text, email text, active boolean, courses text[], missing boolean, file jsonb)
language sql
stable
set search_path = ''
as $$
  with lecturers as (
    select l.lecturer_id
    from public.offerings o
    join public.offering_lecturers l on l.offering_id = o.id
    where o.semester_id = semester_lecturer_timetables.semester_id
    union
    select f.lecturer_id
    from public.files f
    where f.semester_id = semester_lecturer_timetables.semester_id and f.section = 4
  )
  select
    p.id,
    p.display_name,
    p.full_name,
    p.email,
    p.active,
    taught.courses,
    f.id is null,
    case when f.id is not null then public.shared_file_summary(f) end
  from lecturers x
  join public.profiles p on p.id = x.lecturer_id
  left join public.files f
    on f.semester_id = semester_lecturer_timetables.semester_id and f.section = 4 and f.lecturer_id = p.id
  cross join lateral (
    select coalesce(array_agg(c.code order by c.code), '{}') as courses
    from public.offerings o
    join public.offering_lecturers l on l.offering_id = o.id and l.lecturer_id = p.id
    join public.courses c on c.id = o.course_id
    where o.semester_id = semester_lecturer_timetables.semester_id
  ) taught
  where (select public.jwt_roles()) @> '{admin}'
$$;

revoke execute on function public.shared_file_summary, public.semester_student_timetables, public.semester_lecturer_timetables from anon, public;
