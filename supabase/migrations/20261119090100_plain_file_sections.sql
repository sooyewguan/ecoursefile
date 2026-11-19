-- Coordinators and lecturers upload to every section that holds plain files: Teaching Plan (2),
-- Attendance Record (6), Replacement Notices (7), Proof of Absence (8), Warning Letters (9),
-- Week 12 Marks (17), Grade List (18) and LO/PO Analysis (19). The files of LO/PO Analysis go into
-- four named slots. section_statuses already treats 7 to 9 as empty rather than missing.

-- The slot of a file in a section with slots, by its name in the code constant SECTION_SLOTS.
-- Files of other sections have no slot.
alter table public.files
  add column slot text,
  add constraint files_slot_check check (
    case section
      when 19 then coalesce(slot in ('po_achievement', 'lo_achievement', 'lo_po_evaluation', 'cqi'), false)
      else slot is null
    end
  );

-- Whether the caller may upload to this section of the offering: a section with plain files, for
-- the offering's coordinator and lecturers.
create or replace function public.can_upload(offering_id uuid, section smallint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select can_upload.section in (2, 6, 7, 8, 9, 17, 18, 19)
    and exists (
      select 1
      from public.offering_lecturers l
      where l.offering_id = can_upload.offering_id and l.lecturer_id = (select auth.uid())
    )
$$;

-- add_file gains the slot. A new argument makes a new function, so the old one goes first.
drop function public.add_file;

-- Records an uploaded file at the end of its section, and so of its slot, and logs the upload. The files function calls
-- it with the service role once the stored item has passed its checks. A second call for the
-- same item returns the first record and logs nothing.
create function public.add_file(
  offering_id uuid,
  section smallint,
  slot text,
  storage_item_id text,
  name text,
  size bigint,
  uploaded_by uuid
)
returns public.files
language plpgsql
set search_path = ''
as $$
declare
  added public.files;
begin
  insert into public.files (offering_id, section, slot, storage_item_id, name, size, position, uploaded_by)
  values (
    add_file.offering_id,
    add_file.section,
    add_file.slot,
    add_file.storage_item_id,
    add_file.name,
    add_file.size,
    (
      select coalesce(max(f.position), 0) + 1
      from public.files f
      where f.offering_id = add_file.offering_id and f.section = add_file.section
    ),
    add_file.uploaded_by
  )
  on conflict on constraint files_storage_item_id_key do nothing
  returning * into added;

  if not found then
    select * into added from public.files f where f.storage_item_id = add_file.storage_item_id;
    return added;
  end if;

  insert into public.activity_log (offering_id, section, action, actor_id, file_name)
  values (added.offering_id, added.section, 'upload', added.uploaded_by, added.name);
  return added;
end;
$$;

revoke execute on function public.add_file from anon, authenticated, public;

-- Puts one slot's files in the given order. The caller must be allowed to upload to the
-- section, and every file must be in the slot.
create or replace function public.reorder_files(file_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.files;
begin
  select * into target from public.files f where f.id = file_ids[1];
  if not found
    or not public.can_upload(target.offering_id, target.section)
    or exists (
      select 1
      from public.files f
      where f.id = any (file_ids)
        and (f.offering_id, f.section, f.slot) is distinct from (target.offering_id, target.section, target.slot)
    )
  then
    raise exception 'You may not reorder these files.' using errcode = '42501';
  end if;

  update public.files f
  set position = o.position
  from unnest(file_ids) with ordinality as o (id, position)
  where f.id = o.id;
end;
$$;
