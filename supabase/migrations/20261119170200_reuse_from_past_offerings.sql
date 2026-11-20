-- Reuse from past offerings. The coordinator and lecturers of an offering pick a file from a past
-- offering of the same course, in a reusable slot, and the files Edge Function copies it into their
-- offering's course file as a new, independent file. The reusable slots are the code constant
-- isReusable. Clients call neither function here: the files function lists the past files and
-- records the copy with the service role, once the caller may upload to the slot. RLS on past
-- offerings stays as it was, so a lecturer still reads only the offerings they teach.

-- A reuse is logged with the past offering that its file came from. It names a file like an upload.
alter table public.activity_log
  add column source_offering_id uuid references public.offerings (id) on delete restrict,
  drop constraint activity_log_file_name_check,
  add constraint activity_log_file_name_check check ((file_name is not null) = (action in ('upload', 'delete', 'reuse'))),
  add constraint activity_log_source_offering_check check ((source_offering_id is not null) = (action = 'reuse'));

-- Whether the user may upload to this section of the offering: a section that staff upload to, for
-- the offering's coordinator and lecturers, and a switchable section only while the offering has it
-- on. can_upload asks it for the caller, and reuse_file for the user who picked a file to reuse.
create function public.user_can_upload(user_id uuid, offering_id uuid, section smallint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select user_can_upload.section in (2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)
    and exists (
      select 1
      from public.offerings o
      join public.offering_lecturers l on l.offering_id = o.id and l.lecturer_id = user_can_upload.user_id
      where o.id = user_can_upload.offering_id
        and (user_can_upload.section not between 10 and 16 or user_can_upload.section = any (o.sections_on))
    )
$$;

-- Whether the caller may upload to this section of the offering. It runs as its owner so that it may
-- call user_can_upload, which clients cannot. The answer is the same, since it is about the caller.
create or replace function public.can_upload(offering_id uuid, section smallint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.user_can_upload((select auth.uid()), can_upload.offering_id, can_upload.section)
$$;

-- The files that staff may reuse into a slot of the offering's course file: the files in the same
-- section and slot of each past offering of its course. A past offering is an offering of the same
-- catalog course, so of the same course code, in an earlier semester: one with an earlier start year,
-- or the same start year and a lower number. Semester codes have a fixed width, so semester_code
-- sorts in semester order. source_offering_id is the past offering's.
create function public.reusable_files(offering_id uuid, section smallint, slot text)
returns table (
  id uuid,
  source_offering_id uuid,
  semester_code text,
  item smallint,
  name text,
  size bigint,
  storage_item_id text,
  "position" integer
)
language sql
stable
set search_path = ''
as $$
  select f.id, past.id, s.code, f.item, f.name, f.size, f.storage_item_id, f.position
  from public.offerings o
  join public.semesters os on os.id = o.semester_id
  join public.offerings past on past.course_id = o.course_id
  join public.semesters s on s.id = past.semester_id
  join public.files f on f.offering_id = past.id
  where o.id = reusable_files.offering_id
    and (s.start_year, s.number) < (os.start_year, os.number)
    and f.section = reusable_files.section
    and f.slot is not distinct from reusable_files.slot
$$;

-- Records a reused file: the copy that the files function stored of a file from the past offering
-- source_offering_id, at the end of its slot in the offering's course file. The user who picked it
-- is its uploader. Logs the reuse with the past offering. The files function checks that the user
-- may upload to the slot before it copies, and this checks again as it records, since the section
-- may have been switched off, or the user unassigned, while the file was copied.
create function public.reuse_file(
  source_offering_id uuid,
  offering_id uuid,
  section smallint,
  item smallint,
  slot text,
  storage_item_id text,
  name text,
  size bigint,
  actor_id uuid
)
returns public.files
language plpgsql
set search_path = ''
as $$
declare
  added public.files;
begin
  if not public.user_can_upload(reuse_file.actor_id, reuse_file.offering_id, reuse_file.section) then
    raise exception 'You may not upload to this section.' using errcode = '42501';
  end if;

  insert into public.files (offering_id, section, item, slot, storage_item_id, name, size, position, uploaded_by)
  select
    reuse_file.offering_id,
    reuse_file.section,
    reuse_file.item,
    reuse_file.slot,
    reuse_file.storage_item_id,
    reuse_file.name,
    reuse_file.size,
    coalesce(max(f.position), 0) + 1,
    reuse_file.actor_id
  from public.files f
  where (f.offering_id, f.section, f.item, f.slot)
    is not distinct from (reuse_file.offering_id, reuse_file.section, reuse_file.item, reuse_file.slot)
  returning * into added;

  insert into public.activity_log (offering_id, section, action, actor_id, file_name, source_offering_id)
  values (added.offering_id, added.section, 'reuse', added.uploaded_by, added.name, reuse_file.source_offering_id);
  return added;
end;
$$;

revoke execute on function public.user_can_upload, public.reusable_files, public.reuse_file from anon, authenticated, public;
