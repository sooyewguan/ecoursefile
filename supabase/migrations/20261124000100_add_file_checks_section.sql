-- add_file records a course file's upload only while the uploader may upload to its section, as
-- reuse_file does. The files function asks can_upload before it records the file, but a section
-- switched off between that check and the record took the file. add_file now holds the offering's
-- row while it checks and records, so a switch of the offering's sections waits for it, and an
-- upload that comes after a switch sees it.
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
