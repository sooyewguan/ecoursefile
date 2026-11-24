-- Catalog codes and names hold no spaces around them, whoever writes them, so "BITP 1113 " and
-- "BITP 1113" are one course code and a lookup by code finds its row. A trigger trims the code and
-- name columns of departments, courses, program codes and course types on each insert, and on each
-- update that sets one of them. It trims what [[:space:]] matches, which takes in the tab, newline
-- and no-break space that a paste can bring.

create function public.trimmed(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g')
$$;

revoke execute on function public.trimmed from anon, public;

-- Trims the columns that the trigger names as its arguments.
create function public.trim_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  column_name text;
  trimmed jsonb := '{}';
begin
  foreach column_name in array tg_argv loop
    trimmed := trimmed || jsonb_build_object(column_name, public.trimmed(to_jsonb(new) ->> column_name));
  end loop;
  return jsonb_populate_record(new, trimmed);
end;
$$;

-- Rows saved before now are trimmed too, except a row whose trimmed code another row of its table
-- already has. That row is the same entry saved twice, and offerings, staff or files may use
-- either, so it keeps its spaces until an admin merges the two. Saving it then says the code is
-- taken.
update public.departments set name = public.trimmed(name) where name <> public.trimmed(name);
update public.courses set title = public.trimmed(title) where title <> public.trimmed(title);

update public.departments d set code = public.trimmed(d.code)
where d.code <> public.trimmed(d.code)
  and not exists (select from public.departments o where o.id <> d.id and public.trimmed(o.code) = public.trimmed(d.code));

update public.courses c set code = public.trimmed(c.code)
where c.code <> public.trimmed(c.code)
  and not exists (select from public.courses o where o.id <> c.id and public.trimmed(o.code) = public.trimmed(c.code));

update public.program_codes p set code = public.trimmed(p.code)
where p.code <> public.trimmed(p.code)
  and not exists (select from public.program_codes o where o.id <> p.id and public.trimmed(o.code) = public.trimmed(p.code));

update public.course_types t set name = public.trimmed(t.name)
where t.name <> public.trimmed(t.name)
  and not exists (select from public.course_types o where o.id <> t.id and public.trimmed(o.name) = public.trimmed(t.name));

-- Names the rows left with their spaces, so whoever applies this knows which to merge.
do $$
declare
  left_over text;
begin
  select string_agg(format('%s %L', kind, value), ', ') into left_over
  from (
    select 'department' as kind, code as value from public.departments where code <> public.trimmed(code)
    union all select 'course', code from public.courses where code <> public.trimmed(code)
    union all select 'program code', code from public.program_codes where code <> public.trimmed(code)
    union all select 'course type', name from public.course_types where name <> public.trimmed(name)
  ) untrimmed;
  if left_over is not null then
    raise warning 'Another row has the same value without spaces, so these keep theirs until an admin merges them: %', left_over;
  end if;
end;
$$;

create trigger trim_code_and_name before insert or update of code, name on public.departments
  for each row execute function public.trim_columns('code', 'name');

create trigger trim_code_and_title before insert or update of code, title on public.courses
  for each row execute function public.trim_columns('code', 'title');

create trigger trim_code before insert or update of code on public.program_codes
  for each row execute function public.trim_columns('code');

create trigger trim_name before insert or update of name on public.course_types
  for each row execute function public.trim_columns('name');
