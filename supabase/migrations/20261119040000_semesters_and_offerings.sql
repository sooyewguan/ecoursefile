-- Semesters and offerings. The admin creates semesters, offers catalog courses in them and
-- assigns each offering a coordinator and lecturers. Lecturers read the offerings they teach.
-- Auditors, management and admins read every offering. Root reads none.

-- A semester's code, such as 2026/2027-1, follows from its start year and number. Semester 3
-- is the short semester.
create table public.semesters (
  id uuid primary key default gen_random_uuid(),
  start_year smallint not null check (start_year between 2000 and 2999),
  number smallint not null check (number between 1 and 3),
  code text generated always as (start_year::text || '/' || (start_year + 1)::text || '-' || number::text) stored
    not null unique
);

-- One course in one semester. sections_on is copied from the course type when the offering is
-- created, so later edits to the type, or to the course's type, leave the offering as it was.
create table public.offerings (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid not null references public.semesters (id) on delete restrict,
  course_id uuid not null references public.courses (id) on delete restrict,
  coordinator_id uuid not null,
  sections_on smallint[] not null check (sections_on <@ '{10,11,12,13,14,15,16}'),
  unique (semester_id, course_id)
);

-- The lecturers of each offering, the coordinator included.
create table public.offering_lecturers (
  offering_id uuid not null references public.offerings (id) on delete cascade,
  lecturer_id uuid not null references public.profiles (id) on delete restrict,
  primary key (offering_id, lecturer_id)
);

-- The coordinator is one of the offering's lecturers, so the coordinator always counts as a
-- lecturer and an offering always has exactly one. The check waits for the end of the
-- transaction, so that an offering and its lecturers can be added together.
alter table public.offerings
  add constraint offerings_coordinator_is_a_lecturer foreign key (id, coordinator_id)
  references public.offering_lecturers (offering_id, lecturer_id) deferrable initially deferred;

create function public.copy_course_type_sections()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select t.sections_on into new.sections_on
  from public.courses c
  join public.course_types t on t.id = c.course_type_id
  where c.id = new.course_id;
  return new;
end;
$$;

create trigger copy_course_type_sections_before_offering_insert
  before insert on public.offerings
  for each row execute function public.copy_course_type_sections();

-- Whether the caller may read this offering and its course file. It reads offering_lecturers
-- past RLS, so the policies on that table can use it without recursing into themselves.
create function public.can_read_offering(offering_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.jwt_roles() && '{admin,auditor,hod,dean,deputy_dean}'
    or exists (
      select 1
      from public.offering_lecturers l
      where l.offering_id = can_read_offering.offering_id and l.lecturer_id = (select auth.uid())
    )
$$;

-- Sets the offering's coordinator and lecturers in one step. The coordinator is added as a
-- lecturer when lecturer_ids leaves them out. It runs as the caller, so RLS lets only admins
-- change anything.
create function public.set_offering_lecturers(offering_id uuid, coordinator_id uuid, lecturer_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  staff uuid[] := array(select distinct unnest(lecturer_ids || coordinator_id));
begin
  delete from public.offering_lecturers l
  where l.offering_id = set_offering_lecturers.offering_id and l.lecturer_id <> all (staff);

  insert into public.offering_lecturers (offering_id, lecturer_id)
  select set_offering_lecturers.offering_id, unnest(staff)
  on conflict do nothing;

  update public.offerings o
  set coordinator_id = set_offering_lecturers.coordinator_id
  where o.id = set_offering_lecturers.offering_id;
end;
$$;

-- Offers a course in a semester with its coordinator and lecturers, and returns the offering's id.
create function public.create_offering(semester_id uuid, course_id uuid, coordinator_id uuid, lecturer_ids uuid[])
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.offerings (semester_id, course_id, coordinator_id)
  values (create_offering.semester_id, create_offering.course_id, create_offering.coordinator_id)
  returning id into new_id;
  perform public.set_offering_lecturers(new_id, create_offering.coordinator_id, create_offering.lecturer_ids);
  return new_id;
end;
$$;

create type public.section_status as enum ('missing', 'empty', 'off');

-- The status of each of the 19 sections of the offering's course file, in section order: off for
-- a switchable section (10 to 16) that the offering has off, empty for sections 7 to 9, which
-- may stay empty and are never missing, and missing for every other section. A caller who may
-- not read the offering gets no rows.
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
      when s.section between 7 and 9 then 'empty'
      else 'missing'
    end::public.section_status
  from public.offerings o
  cross join generate_series(1, 19) as s (section)
  where o.id = section_statuses.offering_id
  order by s.section
$$;

revoke execute on function public.can_read_offering, public.set_offering_lecturers, public.create_offering,
  public.section_statuses from anon, public;

alter table public.semesters enable row level security;
alter table public.offerings enable row level security;
alter table public.offering_lecturers enable row level security;

-- Clients set an offering's semester, course and coordinator. The trigger sets sections_on.
revoke insert, update on public.offerings from authenticated, anon;
grant insert (semester_id, course_id, coordinator_id) on public.offerings to authenticated;
grant update (coordinator_id) on public.offerings to authenticated;

-- With no update or delete policies on semesters and offerings, nobody changes or removes them.
create policy "Everyone but root reads semesters" on public.semesters
  for select to authenticated using (not (select public.jwt_roles()) @> '{root}');

create policy "Admins add semesters" on public.semesters
  for insert to authenticated with check ((select public.jwt_roles()) @> '{admin}');

create policy "Readers of an offering read it" on public.offerings
  for select to authenticated using (public.can_read_offering(id));

create policy "Admins add offerings" on public.offerings
  for insert to authenticated with check ((select public.jwt_roles()) @> '{admin}');

create policy "Admins change coordinators" on public.offerings
  for update to authenticated
  using ((select public.jwt_roles()) @> '{admin}')
  with check ((select public.jwt_roles()) @> '{admin}');

create policy "Readers of an offering read its lecturers" on public.offering_lecturers
  for select to authenticated using (public.can_read_offering(offering_id));

-- Only users with the lecturer role teach, so root and staff without it never get an offering.
create policy "Admins assign lecturers" on public.offering_lecturers
  for insert to authenticated
  with check (
    (select public.jwt_roles()) @> '{admin}'
    and exists (
      select 1 from public.user_roles r where r.user_id = offering_lecturers.lecturer_id and r.role = 'lecturer'
    )
  );

create policy "Admins unassign lecturers" on public.offering_lecturers
  for delete to authenticated using ((select public.jwt_roles()) @> '{admin}');
