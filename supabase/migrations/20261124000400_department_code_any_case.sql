-- A department code names one department in any case, so "FTMK" and "ftmk" are one code. A file of
-- users to import may write it either way and still find the department, and a second department
-- cannot take the code in another case.

-- Departments that differ only by case are the same entry saved twice, and staff and courses may
-- use either, so the migration stops and names them rather than pick one. An admin merges them, then
-- applies it again.
do $$
declare
  clashes text;
begin
  select string_agg(codes, '; ') into clashes
  from (
    select string_agg(format('%L', code), ', ' order by code) as codes
    from public.departments
    group by lower(code)
    having count(*) > 1
  ) clashing;
  if clashes is not null then
    raise exception 'These department codes differ only by case. Merge each set into one department, then apply this again: %', clashes;
  end if;
end;
$$;

create unique index departments_code_any_case_key on public.departments (lower(code));

-- The code in lower case, as the index compares codes. The accounts function looks departments up
-- by it: select=id,lower_code&lower_code=in.(...)
create function public.lower_code(public.departments)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower($1.code)
$$;

revoke execute on function public.lower_code from anon, public;
