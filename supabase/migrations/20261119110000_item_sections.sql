-- Coordinators and lecturers add numbered items, such as Lab 1 or Quiz 2, to sections 11 to 16
-- while the offering has the section on, and upload PDFs into each item's slots. The slots of each
-- section are the code constant SECTION_SLOTS. The script high, medium and low slots hold one file
-- each. The browser merges answer scripts 4 pages to a page before it uploads them.

-- An item of section 11 to 16. A new item takes the number after the section's highest.
create table public.items (
  offering_id uuid not null references public.offerings (id) on delete restrict,
  section smallint not null check (section between 11 and 16),
  number smallint not null check (number > 0),
  primary key (offering_id, section, number)
);

-- A file in section 11 to 16 belongs to one item, by its number, and to one of the section's
-- slots. An item's files must go before the item does.
alter table public.files
  add column item smallint,
  add constraint files_item_check check ((item is not null) = (section between 11 and 16)),
  add constraint files_item_fkey foreign key (offering_id, section, item)
    references public.items (offering_id, section, number);

alter table public.files drop constraint files_slot_check;

alter table public.files
  add constraint files_slot_check check (
    case
      when section = 11 then coalesce(slot in ('lab_sheet', 'answer_scheme', 'script_high', 'script_medium', 'script_low'), false)
      when section = 12 then coalesce(slot in ('question', 'answer_scheme'), false)
      when section = 13 then coalesce(slot in ('question', 'answer_scheme', 'scripts'), false)
      when section = 14 then coalesce(slot in ('question', 'rubric', 'moderation_form', 'script_high', 'script_medium', 'script_low'), false)
      when section in (15, 16) then
        coalesce(slot in ('question', 'answer_scheme', 'moderation_form', 'script_high', 'script_medium', 'script_low'), false)
      when section = 19 then coalesce(slot in ('po_achievement', 'lo_achievement', 'lo_po_evaluation', 'cqi'), false)
      else slot is null
    end
  );

-- The script high, medium and low slots of an item hold one file each.
create unique index files_one_file_slots_idx on public.files (offering_id, section, item, slot)
  where slot in ('script_high', 'script_medium', 'script_low');

-- Whether the caller may upload to this section of the offering: a section that staff upload to,
-- for the offering's coordinator and lecturers, and a switchable section only while the offering
-- has it on.
create or replace function public.can_upload(offering_id uuid, section smallint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select can_upload.section in (2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)
    and exists (
      select 1
      from public.offerings o
      join public.offering_lecturers l on l.offering_id = o.id and l.lecturer_id = (select auth.uid())
      where o.id = can_upload.offering_id
        and (can_upload.section not between 10 and 16 or can_upload.section = any (o.sections_on))
    )
$$;

-- Adds the next item to a section with items and returns its number. The caller must be allowed
-- to upload to the section.
create function public.add_item(offering_id uuid, section smallint)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  added smallint;
begin
  if add_item.section not between 11 and 16 or not public.can_upload(add_item.offering_id, add_item.section) then
    raise exception 'You may not add items to this section.' using errcode = '42501';
  end if;

  insert into public.items (offering_id, section, number)
  select add_item.offering_id, add_item.section, coalesce(max(i.number), 0) + 1
  from public.items i
  where i.offering_id = add_item.offering_id and i.section = add_item.section
  returning number into added;
  return added;
end;
$$;

-- Whether the caller may delete the item and its files: they teach the offering and may delete
-- every file in it. The coordinator may delete any item, and every lecturer an empty one. The app
-- reads it with each item: select=*,deletable
create function public.deletable(public.items)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
      select 1
      from public.offering_lecturers l
      where l.offering_id = $1.offering_id and l.lecturer_id = (select auth.uid())
    )
    and not exists (
      select 1
      from public.files f
      where f.offering_id = $1.offering_id and f.section = $1.section and f.item = $1.number and not public.deletable(f)
    )
$$;

-- add_file gains the item. A new argument makes a new function, so the old one goes first.
drop function public.add_file;

-- Records an uploaded file at the end of its slot, which is its section, item and slot, and logs
-- the upload. The files function calls it with the service role once the stored item has passed
-- its checks. A second call for the same stored item returns the first record and logs nothing.
create function public.add_file(
  offering_id uuid,
  section smallint,
  item smallint,
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
  insert into public.files (offering_id, section, item, slot, storage_item_id, name, size, position, uploaded_by)
  values (
    add_file.offering_id,
    add_file.section,
    add_file.item,
    add_file.slot,
    add_file.storage_item_id,
    add_file.name,
    add_file.size,
    (
      select coalesce(max(f.position), 0) + 1
      from public.files f
      where (f.offering_id, f.section, f.item, f.slot)
        is not distinct from (add_file.offering_id, add_file.section, add_file.item, add_file.slot)
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

-- Puts one slot's files in the given order. The caller must be allowed to upload to the section,
-- and every file must be in the same section, item and slot.
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
        and (f.offering_id, f.section, f.item, f.slot)
          is distinct from (target.offering_id, target.section, target.item, target.slot)
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

revoke execute on function public.add_item, public.deletable(public.items) from anon, public;
revoke execute on function public.add_file from anon, authenticated, public;

alter table public.items enable row level security;

-- With no write policies, clients add items only through add_item, and delete them only through
-- the files function.
create policy "Readers of an offering read its items" on public.items
  for select to authenticated using (public.can_read_offering(offering_id));
