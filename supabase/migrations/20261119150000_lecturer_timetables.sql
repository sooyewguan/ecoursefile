-- Lecturer timetables. Each lecturer, the coordinator included, uploads their own timetable once
-- per semester, and every course file they teach in the semester links it into section 4. The
-- shared-file key gains the lecturer: a shared file belongs to a semester, a section and, for a
-- timetable, the lecturer whose timetable it is. Section 4 is missing while any lecturer of the
-- offering has no timetable. The activity log keys its rows the same way.

alter table public.files
  drop constraint files_owner_check,
  add column lecturer_id uuid references public.profiles (id) on delete restrict,
  add constraint files_owner_check check (
    case
      when section in (1, 3, 4) then offering_id is null and semester_id is not null
      else offering_id is not null and semester_id is null
    end
  ),
  add constraint files_lecturer_check check ((lecturer_id is not null) = (section = 4));

-- Each shared-file key holds one file: a semester has one Academic Calendar and one Appointment
-- Letter, and one timetable for each lecturer.
drop index public.files_one_shared_file_idx;
create unique index files_one_shared_file_idx on public.files (semester_id, section, lecturer_id) nulls not distinct
  where semester_id is not null;

alter table public.activity_log
  add column lecturer_id uuid references public.profiles (id) on delete restrict,
  add constraint activity_log_lecturer_check check ((lecturer_id is not null) = (semester_id is not null and section = 4));

-- Whether the caller may read the shared file with this key, and its activity. Users who read every
-- offering read every shared file, and a lecturer reads their own timetable. Otherwise a lecturer
-- reads what the course files they teach link: the calendar and letter of each semester in which
-- they teach, and the timetables of the lecturers they teach an offering with.
create function public.can_read_shared_file(semester_id uuid, lecturer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.jwt_roles() && '{admin,auditor,hod,dean,deputy_dean}'
    or can_read_shared_file.lecturer_id = (select auth.uid())
    or exists (
      select 1
      from public.offerings o
      join public.offering_lecturers l on l.offering_id = o.id and l.lecturer_id = (select auth.uid())
      where o.semester_id = can_read_shared_file.semester_id
        and (
          can_read_shared_file.lecturer_id is null
          or exists (
            select 1
            from public.offering_lecturers t
            where t.offering_id = o.id and t.lecturer_id = can_read_shared_file.lecturer_id
          )
        )
    )
$$;

-- Whether the caller may upload the semester's shared file for this section: the Academic Calendar
-- or the Appointment Letter, for admins, and their own Lecturer Timetable, for a lecturer who
-- teaches an offering in the semester. Nobody uploads another lecturer's timetable.
create or replace function public.can_upload_shared_file(semester_id uuid, section smallint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when can_upload_shared_file.section in (1, 3) then
      (select public.jwt_roles()) @> '{admin}'
      and exists (select 1 from public.semesters s where s.id = can_upload_shared_file.semester_id)
    when can_upload_shared_file.section = 4 then exists (
      select 1
      from public.offerings o
      join public.offering_lecturers l on l.offering_id = o.id and l.lecturer_id = (select auth.uid())
      where o.semester_id = can_upload_shared_file.semester_id
    )
    else false
  end
$$;

-- The shared files linked into the offering's course file: its semester's Academic Calendar and
-- Appointment Letter, and the timetable of each of its lecturers. A shared file's lecturer limits
-- it to the course files of the offerings that the lecturer teaches.
create or replace function public.linked_files(public.offerings)
returns setof public.files
language sql
stable
set search_path = ''
as $$
  select f.*
  from public.files f
  where f.semester_id = $1.semester_id
    and (
      f.lecturer_id is null
      or f.lecturer_id in (select l.lecturer_id from public.offering_lecturers l where l.offering_id = $1.id)
    )
$$;

-- Whether the caller may delete the file: for a timetable, its lecturer; for another shared file,
-- an admin; for a course file's file, its uploader or the offering's coordinator, while they teach
-- the offering.
create or replace function public.deletable(public.files)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when $1.lecturer_id is not null then $1.lecturer_id = (select auth.uid())
    when $1.offering_id is null then (select public.jwt_roles()) @> '{admin}'
    else exists (
      select 1
      from public.offerings o
      join public.offering_lecturers l on l.offering_id = o.id and l.lecturer_id = (select auth.uid())
      where o.id = $1.offering_id and l.lecturer_id in (o.coordinator_id, $1.uploaded_by)
    )
  end
$$;

-- The lecturer's name, for everyone who reads the offering's lecturers. Lecturers cannot read other
-- profiles.
create function public.lecturer_name(public.offering_lecturers)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.full_name from public.profiles p where p.id = $1.lecturer_id
$$;

-- add_file gains the lecturer of the shared-file key. A new argument makes a new function, so the
-- old one goes first.
drop function public.add_file;

-- Records an uploaded file at the end of its slot and logs the upload. The slot is a course file's
-- section, item and slot, or a shared file's semester, section and lecturer. The files function
-- calls it with the service role once the stored item has passed its checks. A second call for the
-- same stored item returns the first record and logs nothing.
create function public.add_file(
  offering_id uuid,
  section smallint,
  item smallint,
  slot text,
  storage_item_id text,
  name text,
  size bigint,
  uploaded_by uuid,
  semester_id uuid default null,
  lecturer_id uuid default null
)
returns public.files
language plpgsql
set search_path = ''
as $$
declare
  added public.files;
begin
  insert into public.files (offering_id, semester_id, lecturer_id, section, item, slot, storage_item_id, name, size, position, uploaded_by)
  values (
    add_file.offering_id,
    add_file.semester_id,
    add_file.lecturer_id,
    add_file.section,
    add_file.item,
    add_file.slot,
    add_file.storage_item_id,
    add_file.name,
    add_file.size,
    (
      select coalesce(max(f.position), 0) + 1
      from public.files f
      where (f.offering_id, f.semester_id, f.lecturer_id, f.section, f.item, f.slot)
        is not distinct from (add_file.offering_id, add_file.semester_id, add_file.lecturer_id, add_file.section, add_file.item, add_file.slot)
    ),
    add_file.uploaded_by
  )
  on conflict on constraint files_storage_item_id_key do nothing
  returning * into added;

  if not found then
    select * into added from public.files f where f.storage_item_id = add_file.storage_item_id;
    return added;
  end if;

  insert into public.activity_log (offering_id, semester_id, lecturer_id, section, action, actor_id, file_name)
  values (added.offering_id, added.semester_id, added.lecturer_id, added.section, 'upload', added.uploaded_by, added.name);
  return added;
end;
$$;

-- Removes a file's record and logs the delete. The files function calls it with the service role
-- after it deletes the stored item. A second call does nothing.
create or replace function public.remove_file(file_id uuid, actor_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  removed public.files;
begin
  delete from public.files f where f.id = remove_file.file_id returning * into removed;
  if found then
    insert into public.activity_log (offering_id, semester_id, lecturer_id, section, action, actor_id, file_name)
    values (removed.offering_id, removed.semester_id, removed.lecturer_id, removed.section, 'delete', remove_file.actor_id, removed.name);
  end if;
end;
$$;

-- The status of each of the 19 sections of the offering's course file, in section order, and
-- whether the section counts toward the course file's completeness. The status is off for a
-- switchable section (10 to 16) that the offering has off, missing for section 4 while any lecturer
-- of the offering has no timetable, pending_review for a section with files of its own or linked
-- shared files, empty for sections 7 to 9, which may stay empty and are never missing, and missing
-- for every other section. Every section counts except a switched-off one. The spec makes a
-- switched-off section with an open Needs fix verdict count too; that rule belongs here once
-- verdicts exist. A caller who may not read the offering gets no rows.
create or replace function public.section_statuses(offering_id uuid)
returns table (section smallint, status public.section_status, counts_toward_completeness boolean)
language sql
stable
set search_path = ''
as $$
  select
    s.section::smallint,
    case
      when s.off then 'off'
      when s.section = 4 and exists (
        select 1
        from public.offering_lecturers l
        where l.offering_id = o.id
          and not exists (select 1 from public.linked_files(o) f where f.lecturer_id = l.lecturer_id)
      ) then 'missing'
      when exists (select 1 from public.files f where f.offering_id = o.id and f.section = s.section)
        or exists (select 1 from public.linked_files(o) f where f.section = s.section)
        then 'pending_review'
      when s.section between 7 and 9 then 'empty'
      else 'missing'
    end::public.section_status,
    not s.off
  from public.offerings o
  cross join lateral (
    select g.section, g.section between 10 and 16 and g.section <> all (o.sections_on) as off
    from generate_series(1, 19) as g (section)
  ) as s
  where o.id = section_statuses.offering_id
  order by s.section
$$;

revoke execute on function public.can_read_shared_file, public.lecturer_name from anon, public;
revoke execute on function public.add_file from anon, authenticated, public;

-- The read policies take the lecturer of the shared-file key, so can_read_shared_files goes.
drop policy "Course file and shared file readers read files" on public.files;
drop policy "Course file and shared file readers read activity" on public.activity_log;
drop function public.can_read_shared_files;

-- A row keyed by an offering is read by the offering's readers, and a row keyed by a semester by the
-- readers of the shared file with its key.
create policy "Course file and shared file readers read files" on public.files
  for select to authenticated using (public.can_read_offering(offering_id) or public.can_read_shared_file(semester_id, lecturer_id));

create policy "Course file and shared file readers read activity" on public.activity_log
  for select to authenticated using (public.can_read_offering(offering_id) or public.can_read_shared_file(semester_id, lecturer_id));
