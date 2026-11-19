-- Student timetables. The admin uploads one timetable for each program code for each semester. In
-- section 5 of an offering, its coordinator or lecturers tick the program codes whose students take
-- the course, and the course file links the timetable of each ticked code. The shared-file key
-- gains the program code: a shared file belongs to a semester, a section and, for a student
-- timetable, the program code whose timetable it is. The activity log keys its rows the same way.
--
-- A tick says which programs take the course, so it outlives its code's timetable. Deleting the
-- timetable unlinks it from every offering that ticks the code, and section 5 of each is Missing
-- until the admin uploads the code's timetable again, which links it back, or staff untick the code.

alter table public.files
  drop constraint files_owner_check,
  add column program_code_id uuid references public.program_codes (id) on delete restrict,
  add constraint files_owner_check check (
    case
      when section in (1, 3, 4, 5) then offering_id is null and semester_id is not null
      else offering_id is not null and semester_id is null
    end
  ),
  add constraint files_program_code_check check ((program_code_id is not null) = (section = 5));

-- Each shared-file key holds one file: a semester has one Academic Calendar and one Appointment
-- Letter, one timetable for each lecturer, and one student timetable for each program code.
drop index public.files_one_shared_file_idx;
create unique index files_one_shared_file_idx on public.files (semester_id, section, lecturer_id, program_code_id) nulls not distinct
  where semester_id is not null;

-- The program codes ticked in section 5 of each offering's course file.
create table public.offering_program_codes (
  offering_id uuid not null references public.offerings (id) on delete restrict,
  program_code_id uuid not null references public.program_codes (id) on delete restrict,
  primary key (offering_id, program_code_id)
);

alter table public.offering_program_codes enable row level security;

-- With no write policies, clients tick and untick codes only through tick_program_code.
create policy "Readers of an offering read its program codes" on public.offering_program_codes
  for select to authenticated using (public.can_read_offering(offering_id));

-- A tick or untick is logged with its program code, and so is each upload and delete of a student
-- timetable. Every activity row of section 5 names one.
alter type public.activity_action add value 'tick';
alter type public.activity_action add value 'untick';

alter table public.activity_log
  add column program_code_id uuid references public.program_codes (id) on delete restrict,
  add constraint activity_log_program_code_check check ((program_code_id is not null) = (section = 5));

-- Whether the caller may upload the semester's shared file for this section: the Academic Calendar,
-- the Appointment Letter or a Student Timetable, for admins, and their own Lecturer Timetable, for a
-- lecturer who teaches an offering in the semester. Nobody uploads another lecturer's timetable.
create or replace function public.can_upload_shared_file(semester_id uuid, section smallint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when can_upload_shared_file.section in (1, 3, 5) then
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
-- Appointment Letter, the timetable of each of its lecturers, and the student timetable of each
-- program code it ticks. A shared file's lecturer limits it to the course files of the offerings
-- that the lecturer teaches, and its program code to those of the offerings that tick the code.
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
    and (
      f.program_code_id is null
      or f.program_code_id in (select t.program_code_id from public.offering_program_codes t where t.offering_id = $1.id)
    )
$$;

-- The program codes that section 5 of the offering's course file can tick: those with a student
-- timetable in the offering's semester. The app reads them with the offering:
-- select=program_code_choices(...)
create function public.program_code_choices(public.offerings)
returns setof public.program_codes
language sql
stable
set search_path = ''
as $$
  select c.*
  from public.program_codes c
  where exists (
    select 1 from public.files f where f.semester_id = $1.semester_id and f.section = 5 and f.program_code_id = c.id
  )
$$;

-- Ticks or unticks a program code in section 5 of the offering and logs it. The caller must be the
-- offering's coordinator or one of its lecturers. Only a code in the offering's program_code_choices
-- can be ticked. Any ticked code can be unticked, also once its timetable is deleted. Ticking a
-- ticked code or unticking an unticked one changes nothing and logs nothing.
create function public.tick_program_code(offering_id uuid, program_code_id uuid, ticked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.offerings;
begin
  select * into target from public.offerings o where o.id = tick_program_code.offering_id;
  if not found
    or not exists (
      select 1
      from public.offering_lecturers l
      where l.offering_id = target.id and l.lecturer_id = (select auth.uid())
    )
  then
    raise exception 'You may not tick program codes for this offering.' using errcode = '42501';
  end if;
  if ticked is null then
    raise exception 'Say whether the program code is ticked.' using errcode = '22004';
  end if;

  if ticked then
    if not exists (select 1 from public.program_code_choices(target) c where c.id = tick_program_code.program_code_id) then
      raise exception 'This program code has no student timetable for the semester.' using errcode = '23503';
    end if;
    insert into public.offering_program_codes (offering_id, program_code_id)
    values (target.id, tick_program_code.program_code_id)
    on conflict do nothing;
  else
    delete from public.offering_program_codes t
    where t.offering_id = target.id and t.program_code_id = tick_program_code.program_code_id;
  end if;

  if found then
    insert into public.activity_log (offering_id, section, program_code_id, action, actor_id)
    values (
      target.id,
      5,
      tick_program_code.program_code_id,
      case when ticked then 'tick' else 'untick' end::public.activity_action,
      (select auth.uid())
    );
  end if;
end;
$$;

-- add_file gains the program code of the shared-file key. A new argument makes a new function, so
-- the old one goes first.
drop function public.add_file;

-- Records an uploaded file at the end of its slot and logs the upload. The slot is a course file's
-- section, item and slot, or a shared file's semester, section, lecturer and program code. The files
-- function calls it with the service role once the stored item has passed its checks. A second call
-- for the same stored item returns the first record and logs nothing.
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
    insert into public.activity_log (offering_id, semester_id, lecturer_id, program_code_id, section, action, actor_id, file_name)
    values (
      removed.offering_id, removed.semester_id, removed.lecturer_id, removed.program_code_id, removed.section, 'delete', remove_file.actor_id, removed.name
    );
  end if;
end;
$$;

-- The status of each of the 19 sections of the offering's course file, in section order, and
-- whether the section counts toward the course file's completeness. The status is off for a
-- switchable section (10 to 16) that the offering has off, missing for section 4 while any lecturer
-- of the offering has no timetable, missing for section 5 while any ticked program code has no
-- timetable, pending_review for a section with files of its own or linked shared files, empty for
-- sections 7 to 9, which may stay empty and are never missing, and missing for every other section,
-- such as section 5 with no code ticked. Every section counts except a switched-off one. The spec
-- makes a switched-off section with an open Needs fix verdict count too; that rule belongs here
-- once verdicts exist. A caller who may not read the offering gets no rows.
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
      when s.section = 5 and exists (
        select 1
        from public.offering_program_codes t
        where t.offering_id = o.id
          and not exists (select 1 from public.linked_files(o) f where f.program_code_id = t.program_code_id)
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

revoke execute on function public.program_code_choices, public.tick_program_code from anon, public;
revoke execute on function public.add_file from anon, authenticated, public;
