-- Files in course file sections, and the activity log. Coordinators and lecturers upload PDFs
-- to Teaching Plan (section 2) through the files Edge Function, which keeps each file in the
-- storage library and records it here with the service role. Clients only read these tables.

-- A file belongs to one section of one offering's course file. storage_item_id is the item in
-- the storage library. position orders the files of a section; ties fall back to upload time.
create table public.files (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.offerings (id) on delete restrict,
  section smallint not null check (section between 1 and 19),
  storage_item_id text not null unique,
  name text not null,
  size bigint not null,
  position integer not null,
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  uploaded_at timestamptz not null default now()
);

create index files_offering_id_section_idx on public.files (offering_id, section);

create type public.activity_action as enum ('upload', 'delete');

-- Append-only. The functions and RPCs that make a change add its row, and nobody changes or
-- removes rows, not even the service role.
create table public.activity_log (
  id bigint generated always as identity primary key,
  offering_id uuid not null references public.offerings (id) on delete restrict,
  section smallint not null check (section between 1 and 19),
  action public.activity_action not null,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  file_name text not null,
  created_at timestamptz not null default now()
);

create index activity_log_offering_id_idx on public.activity_log (offering_id);

-- Whether the caller may upload to this section of the offering: Teaching Plan, for the
-- offering's coordinator and lecturers.
create function public.can_upload(offering_id uuid, section smallint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select can_upload.section = 2
    and exists (
      select 1
      from public.offering_lecturers l
      where l.offering_id = can_upload.offering_id and l.lecturer_id = (select auth.uid())
    )
$$;

-- Whether the caller may delete the file: its uploader or the offering's coordinator, while they
-- teach the offering. The app reads it with each file: select=*,deletable
create function public.deletable(public.files)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.offerings o
    join public.offering_lecturers l on l.offering_id = o.id and l.lecturer_id = (select auth.uid())
    where o.id = $1.offering_id and l.lecturer_id in (o.coordinator_id, $1.uploaded_by)
  )
$$;

-- The uploader's name, for everyone who reads the file. Lecturers cannot read other profiles.
create function public.uploader_name(public.files)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.full_name from public.profiles p where p.id = $1.uploaded_by
$$;

-- Records an uploaded file at the end of its section and logs the upload. The files function
-- calls it with the service role once the stored item has passed its checks. A second call for
-- the same item returns the first record and logs nothing.
create function public.add_file(
  offering_id uuid,
  section smallint,
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
  insert into public.files (offering_id, section, storage_item_id, name, size, position, uploaded_by)
  values (
    add_file.offering_id,
    add_file.section,
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

-- Removes a file's record and logs the delete. The files function calls it with the service role
-- after it deletes the stored item. A second call does nothing.
create function public.remove_file(file_id uuid, actor_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  removed public.files;
begin
  delete from public.files f where f.id = remove_file.file_id returning * into removed;
  if found then
    insert into public.activity_log (offering_id, section, action, actor_id, file_name)
    values (removed.offering_id, removed.section, 'delete', remove_file.actor_id, removed.name);
  end if;
end;
$$;

-- Puts one section's files in the given order. The caller must be allowed to upload to the
-- section, and every file must be in it.
create function public.reorder_files(file_ids uuid[])
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
      where f.id = any (file_ids) and (f.offering_id, f.section) <> (target.offering_id, target.section)
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

-- section_status gains pending_review, for a section with files and no verdict. The type is made
-- again, since section_statuses is the only thing that uses it.
drop function public.section_statuses;
drop type public.section_status;

create type public.section_status as enum ('missing', 'pending_review', 'empty', 'off');

-- The status of each of the 19 sections of the offering's course file, in section order: off for
-- a switchable section (10 to 16) that the offering has off, pending_review for a section with
-- files, empty for sections 7 to 9, which may stay empty and are never missing, and missing for
-- every other section. A caller who may not read the offering gets no rows.
create function public.section_statuses(offering_id uuid)
returns table (section smallint, status public.section_status)
language sql
stable
set search_path = ''
as $$
  select
    s.section::smallint,
    case
      when s.section between 10 and 16 and s.section <> all (o.sections_on) then 'off'
      when exists (select 1 from public.files f where f.offering_id = o.id and f.section = s.section) then 'pending_review'
      when s.section between 7 and 9 then 'empty'
      else 'missing'
    end::public.section_status
  from public.offerings o
  cross join generate_series(1, 19) as s (section)
  where o.id = section_statuses.offering_id
  order by s.section
$$;

revoke execute on function public.can_upload, public.deletable, public.uploader_name, public.reorder_files,
  public.section_statuses from anon, public;
revoke execute on function public.add_file, public.remove_file from anon, authenticated, public;

alter table public.files enable row level security;
alter table public.activity_log enable row level security;

-- With no write policies, clients change files only through the files function and reorder_files.
create policy "Readers of an offering read its files" on public.files
  for select to authenticated using (public.can_read_offering(offering_id));

create policy "Readers of an offering read its activity" on public.activity_log
  for select to authenticated using (public.can_read_offering(offering_id));

revoke update, delete, truncate on public.activity_log from anon, authenticated, service_role;
