-- remove_file removes a lecturer's timetable for anyone but its lecturer only while no course file
-- links it, as deletable says. The files function asks deletable before it removes the file, but a
-- timetable linked between that check and the remove left the course files that link it. A link
-- comes from an offering_lecturers row of the lecturer, whose foreign key holds the lecturer's
-- profile row while it is added. remove_file now holds that row for update while it checks and
-- removes, so an assignment of the lecturer waits for the remove, and a remove that comes after an
-- assignment sees it. It refuses with 42501, which PostgREST answers with 403.
create or replace function public.remove_file(file_id uuid, actor_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  target public.files;
  removed public.files;
begin
  select * into target from public.files f where f.id = remove_file.file_id;
  if target.lecturer_id is not null and target.lecturer_id <> remove_file.actor_id then
    perform from public.profiles p where p.id = target.lecturer_id for update;
    if exists (select 1 from public.linked_offerings(target)) then
      raise exception 'Only its lecturer may delete a timetable, or the admin while no course file links it.' using errcode = '42501';
    end if;
  end if;

  delete from public.files f where f.id = remove_file.file_id returning * into removed;
  if found then
    insert into public.activity_log (offering_id, semester_id, lecturer_id, program_code_id, section, action, actor_id, file_name)
    values (
      removed.offering_id, removed.semester_id, removed.lecturer_id, removed.program_code_id, removed.section, 'delete', remove_file.actor_id, removed.name
    );
  end if;
end;
$$;
