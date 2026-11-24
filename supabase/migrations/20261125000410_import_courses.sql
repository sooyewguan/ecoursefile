-- The admin adds courses from a CSV file. The browser reads the file into rows, and this function
-- checks every row against the catalog and adds the valid ones, so one reader applies every rule.
-- A rejected row stops no other row. Each row of the answer says what happened to it.

create function public.import_courses(courses jsonb)
returns table (
  -- The row's number in the file, as a spreadsheet shows it.
  file_row integer,
  code text,
  -- The new course, or null when the row was rejected.
  course_id uuid,
  -- Why the row was rejected: missing_value, duplicate_code, code_exists, unknown_department or
  -- unknown_course_type. Null when the course was added.
  problem text,
  reason text
)
language plpgsql
set search_path = ''
as $$
begin
  if not (select public.jwt_roles()) @> '{admin}' then
    raise exception 'Only admins import courses.' using errcode = '42501';
  end if;
  if jsonb_array_length(courses) > 500 then
    raise exception 'A file may hold at most 500 courses. Split it into smaller files.' using errcode = '22023';
  end if;

  return query
  with input as (
    select
      (r ->> 'row')::integer as file_row,
      public.trimmed(coalesce(r ->> 'code', '')) as code,
      public.trimmed(coalesce(r ->> 'title', '')) as title,
      public.trimmed(coalesce(r ->> 'department', '')) as department,
      public.trimmed(coalesce(r ->> 'course_type', '')) as course_type
    from jsonb_array_elements(courses) r
  ),
  checked as (
    select i.*, d.id as department_id, t.id as course_type_id, verdict.problem, verdict.reason
    from input i
    left join public.departments d on lower(d.code) = lower(i.department)
    -- A course type matches by its name as written, or else in any case when only one matches so.
    left join lateral (
      select t.id from public.course_types t
      where lower(t.name) = lower(i.course_type)
        and (t.name = i.course_type or (select count(*) from public.course_types o where lower(o.name) = lower(i.course_type)) = 1)
      order by t.name = i.course_type desc
      limit 1
    ) t on true
    cross join lateral (
      select twins.rows from (
        select string_agg(o.file_row::text, ', ' order by o.file_row) as rows
        from input o where o.code = i.code and o.file_row <> i.file_row
      ) twins
    ) twin
    cross join lateral (
      select * from (values
        (1, i.code = '', 'missing_value', 'The row has no code.'),
        (2, i.title = '', 'missing_value', 'The row has no title.'),
        (3, i.department = '', 'missing_value', 'The row has no department.'),
        (4, i.course_type = '', 'missing_value', 'The row has no course type.'),
        (5, twin.rows is not null, 'duplicate_code', format('The code is also on row %s.', twin.rows)),
        (6, exists (select 1 from public.courses c where c.code = i.code), 'code_exists', format('A course with the code %s already exists.', i.code)),
        (7, d.id is null, 'unknown_department', format('No department has the code "%s".', i.department)),
        (8, t.id is null, 'unknown_course_type', format('No course type is named "%s".', i.course_type))
      ) as checks (step, failed, problem, reason)
      where checks.failed
      union all
      select 9, true, null, null
      order by 1
      limit 1
    ) verdict
  ),
  added as (
    insert into public.courses as course (code, title, department_id, course_type_id)
    select c.code, c.title, c.department_id, c.course_type_id from checked c where c.problem is null
    returning course.id, course.code
  )
  select c.file_row, c.code, a.id, c.problem, c.reason
  from checked c
  left join added a on a.code = c.code and c.problem is null
  order by c.file_row;
end;
$$;

revoke execute on function public.import_courses from anon, public;
