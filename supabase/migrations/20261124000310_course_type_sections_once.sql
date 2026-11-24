-- A course type names each switchable section in sections_on at most once. The form cannot repeat
-- one, but another writer could. An offering's sections_on follows from generate_series, so only
-- the course type's can hold a repeat.

-- Whether no item of the array appears twice.
create function public.no_repeats(items anyarray)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select count(*) = count(distinct item) from unnest(items) as u (item)
$$;

revoke execute on function public.no_repeats from anon, public;

-- A repeat says nothing that the first mention does not, so course types saved with one lose it.
update public.course_types
set sections_on = array(select distinct section from unnest(sections_on) as u (section) order by section)
where not public.no_repeats(sections_on);

alter table public.course_types
  add constraint course_types_sections_on_once check (public.no_repeats(sections_on));
