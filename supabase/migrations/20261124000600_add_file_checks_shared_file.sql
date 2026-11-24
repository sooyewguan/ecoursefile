-- add_file records a shared file only while the uploader may upload it, as it does for a course
-- file's section since 20261124000100. The files function asks can_upload_shared_file before it
-- records the file, but a lecturer unassigned from every offering of the semester between that check
-- and the record still got their timetable recorded. add_file now holds the rows the rule reads
-- while it checks and records: the uploader's offering_lecturers rows in the semester, and their
-- admin role. An unassign, an offering's delete or a revoke of the role waits for the record, and a
-- record that comes after one sees it.

-- Whether the user may upload the semester's shared file for this section: the Academic Calendar,
-- the Appointment Letter or a Student Timetable, for admins, and their own Lecturer Timetable, for a
-- lecturer who teaches an offering in the semester. Nobody uploads another lecturer's timetable.
-- can_upload_shared_file asks it for the caller, and add_file for the uploader. It reads the admin
-- role from user_roles, as add_file runs with the service role and has no token of the uploader.
create function public.user_can_upload_shared_file(user_id uuid, semester_id uuid, section smallint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when user_can_upload_shared_file.section in (1, 3, 5) then
      exists (select 1 from public.user_roles r where r.user_id = user_can_upload_shared_file.user_id and r.role = 'admin')
      and exists (select 1 from public.semesters s where s.id = user_can_upload_shared_file.semester_id)
    when user_can_upload_shared_file.section = 4 then exists (
      select 1
      from public.offerings o
      join public.offering_lecturers l on l.offering_id = o.id and l.lecturer_id = user_can_upload_shared_file.user_id
      where o.semester_id = user_can_upload_shared_file.semester_id
    )
    else false
  end
$$;

-- Whether the caller may upload the semester's shared file for this section. It runs as its owner so
-- that it may call user_can_upload_shared_file, which clients cannot.
create or replace function public.can_upload_shared_file(semester_id uuid, section smallint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.user_can_upload_shared_file((select auth.uid()), can_upload_shared_file.semester_id, can_upload_shared_file.section)
$$;

create or replace function public.add_file(
  offering_id uuid,
  section smallint,
  item smallint,
  slot text,
  storage_item_id text,
  name text,
  size bigint,
  uploaded_by uuid,
  semester_id uuid default null,
  lecturer_id uuid default null,
  program_code_id uuid default null
)
returns public.files
language plpgsql
set search_path = ''
as $$
declare
  added public.files;
begin
  select * into added from public.files f where f.storage_item_id = add_file.storage_item_id;
  if found then
    return added;
  end if;

  if add_file.offering_id is not null then
    perform from public.offerings o where o.id = add_file.offering_id for share;
    if not public.user_can_upload(add_file.uploaded_by, add_file.offering_id, add_file.section) then
      raise exception 'You may not upload to this section.' using errcode = '42501';
    end if;
  else
    perform from public.offering_lecturers l
    join public.offerings o on o.id = l.offering_id
    where l.lecturer_id = add_file.uploaded_by and o.semester_id = add_file.semester_id
    for share of l;
    perform from public.user_roles r where r.user_id = add_file.uploaded_by and r.role = 'admin' for share;
    if not public.user_can_upload_shared_file(add_file.uploaded_by, add_file.semester_id, add_file.section) then
      raise exception 'You may not upload this shared file.' using errcode = '42501';
    end if;
  end if;

  insert into public.files (
    offering_id, semester_id, lecturer_id, program_code_id, section, item, slot, storage_item_id, name, size, position, uploaded_by
  )
  values (
    add_file.offering_id,
    add_file.semester_id,
    add_file.lecturer_id,
    add_file.program_code_id,
    add_file.section,
    add_file.item,
    add_file.slot,
    add_file.storage_item_id,
    add_file.name,
    add_file.size,
    (
      select coalesce(max(f.position), 0) + 1
      from public.files f
      where (f.offering_id, f.semester_id, f.lecturer_id, f.program_code_id, f.section, f.item, f.slot)
        is not distinct from (
          add_file.offering_id, add_file.semester_id, add_file.lecturer_id, add_file.program_code_id, add_file.section, add_file.item, add_file.slot
        )
    ),
    add_file.uploaded_by
  )
  on conflict on constraint files_storage_item_id_key do nothing
  returning * into added;

  if not found then
    select * into added from public.files f where f.storage_item_id = add_file.storage_item_id;
    return added;
  end if;

  insert into public.activity_log (offering_id, semester_id, lecturer_id, program_code_id, section, action, actor_id, file_name)
  values (added.offering_id, added.semester_id, added.lecturer_id, added.program_code_id, added.section, 'upload', added.uploaded_by, added.name);
  return added;
end;
$$;

revoke execute on function public.user_can_upload_shared_file from anon, authenticated, public;
