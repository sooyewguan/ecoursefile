-- The catalog: course types, courses and program codes. Only admins write to it. Every
-- signed-in user except root reads it.

-- A course type sets which switchable sections (10 to 16) are on by default. A switchable
-- section not in sections_on is off.
create table public.course_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sections_on smallint[] not null check (sections_on <@ '{10,11,12,13,14,15,16}')
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  department_id uuid not null references public.departments (id) on delete restrict,
  course_type_id uuid not null references public.course_types (id) on delete restrict
);

-- Labels such as `1 BITS S1G1`.
create table public.program_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique
);

alter table public.course_types enable row level security;
alter table public.courses enable row level security;
alter table public.program_codes enable row level security;

-- With no delete policies, nobody deletes catalog entries.
create policy "Everyone but root reads course types" on public.course_types
  for select to authenticated using (not (select public.jwt_roles()) @> '{root}');

create policy "Admins add course types" on public.course_types
  for insert to authenticated with check ((select public.jwt_roles()) @> '{admin}');

create policy "Admins edit course types" on public.course_types
  for update to authenticated
  using ((select public.jwt_roles()) @> '{admin}')
  with check ((select public.jwt_roles()) @> '{admin}');

create policy "Everyone but root reads courses" on public.courses
  for select to authenticated using (not (select public.jwt_roles()) @> '{root}');

create policy "Admins add courses" on public.courses
  for insert to authenticated with check ((select public.jwt_roles()) @> '{admin}');

create policy "Admins edit courses" on public.courses
  for update to authenticated
  using ((select public.jwt_roles()) @> '{admin}')
  with check ((select public.jwt_roles()) @> '{admin}');

create policy "Everyone but root reads program codes" on public.program_codes
  for select to authenticated using (not (select public.jwt_roles()) @> '{root}');

create policy "Admins add program codes" on public.program_codes
  for insert to authenticated with check ((select public.jwt_roles()) @> '{admin}');

create policy "Admins edit program codes" on public.program_codes
  for update to authenticated
  using ((select public.jwt_roles()) @> '{admin}')
  with check ((select public.jwt_roles()) @> '{admin}');
