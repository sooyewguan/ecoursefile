-- A deactivated user reads and changes nothing, even with an access token issued before the
-- deactivation, which stays valid for up to an hour. The token hook stops new tokens, and every
-- rule that grants access now asks whether the profile is active: the roles RLS reads from the
-- token, the membership rules for offerings and shared files, the upload rules the files function
-- asks for the caller and add_file and reuse_file ask for the uploader, and the read-all policies
-- that hold for any signed-in user. A user still reads their own profile and roles, which say they
-- are deactivated. Reactivation restores access to the same token.

create function public.is_active(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = is_active.user_id and p.active)
$$;

revoke execute on function public.is_active from anon, public;

-- The caller's roles, from the token's app_roles claim, or none while their profile is inactive.
create or replace function public.jwt_roles()
returns public.global_role[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(r::public.global_role), '{}')
  from jsonb_array_elements_text(coalesce(auth.jwt() -> 'app_roles', '[]')) as r
  where public.is_active((select auth.uid()))
$$;

create or replace function public.can_read_offering(offering_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.jwt_roles() && '{admin,auditor,hod,dean,deputy_dean}'
    or public.teaches((select auth.uid()), can_read_offering.offering_id)
$$;

create or replace function public.can_read_shared_file(semester_id uuid, lecturer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.jwt_roles() && '{admin,auditor,hod,dean,deputy_dean}'
    or public.is_active((select auth.uid())) and (
      can_read_shared_file.lecturer_id = (select auth.uid())
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
    )
$$;

-- Whether the user, while active, is the coordinator or a lecturer of the offering.
create or replace function public.teaches(user_id uuid, offering_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_active(teaches.user_id)
    and exists (
      select 1 from public.offering_lecturers l where l.offering_id = teaches.offering_id and l.lecturer_id = teaches.user_id
    )
$$;

create or replace function public.user_can_upload(user_id uuid, offering_id uuid, section smallint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select user_can_upload.section in (2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)
    and public.is_active(user_can_upload.user_id)
    and exists (
      select 1
      from public.offerings o
      join public.offering_lecturers l on l.offering_id = o.id and l.lecturer_id = user_can_upload.user_id
      where o.id = user_can_upload.offering_id
        and (user_can_upload.section not between 10 and 16 or user_can_upload.section = any (o.sections_on))
    )
$$;

create or replace function public.user_can_upload_shared_file(user_id uuid, semester_id uuid, section smallint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_active(user_can_upload_shared_file.user_id) and case
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

-- The read-all policies hold for any signed-in user but root, so they ask for an active profile too.
alter policy "Signed-in users read departments" on public.departments
  using ((select public.is_active((select auth.uid()))));
alter policy "Everyone but root reads course types" on public.course_types
  using ((select public.is_active((select auth.uid()))) and not (select public.jwt_roles()) @> '{root}');
alter policy "Everyone but root reads courses" on public.courses
  using ((select public.is_active((select auth.uid()))) and not (select public.jwt_roles()) @> '{root}');
alter policy "Everyone but root reads program codes" on public.program_codes
  using ((select public.is_active((select auth.uid()))) and not (select public.jwt_roles()) @> '{root}');
alter policy "Everyone but root reads semesters" on public.semesters
  using ((select public.is_active((select auth.uid()))) and not (select public.jwt_roles()) @> '{root}');
alter policy "Auditors read their drafts, and readers of an offering its sent requests" on public.audit_requests
  using (
    case
      when state = 'draft' then auditor_id = (select auth.uid()) and (select public.is_active((select auth.uid())))
      else public.can_read_offering(offering_id)
    end
  );

-- switch_section and tick_program_code ask teaches, so an inactive lecturer switches and ticks nothing.
create or replace function public.switch_section(offering_id uuid, section smallint, is_on boolean, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.offerings;
  away_from_default boolean;
  stored_reason text;
begin
  -- Switches and item adds on one offering wait for each other, so each reads what the last left.
  select * into target from public.offerings o where o.id = switch_section.offering_id for no key update;
  if not found
    or switch_section.section not between 10 and 16
    or not public.teaches((select auth.uid()), target.id)
  then
    raise exception 'You may not switch this section.' using errcode = '42501';
  end if;
  if is_on is null then
    raise exception 'Say whether the section is on.' using errcode = '22004';
  end if;

  if (switch_section.section = any (target.sections_on)) = is_on then
    return;
  end if;

  away_from_default := (switch_section.section = any (target.default_sections_on)) <> is_on;
  stored_reason := case when away_from_default then nullif(regexp_replace(switch_section.reason, '^\s+|\s+$', '', 'g'), '') end;
  if away_from_default and stored_reason is null then
    raise exception 'Give a reason for setting this section differently from the course type.' using errcode = '23514';
  end if;

  update public.offerings o
  set section_reasons = case
    when away_from_default then o.section_reasons || jsonb_build_object(switch_section.section::text, stored_reason)
    else o.section_reasons - switch_section.section::text
  end
  where o.id = target.id;

  insert into public.activity_log (offering_id, section, action, actor_id, reason)
  values (
    target.id,
    switch_section.section,
    case when is_on then 'switch_on' else 'switch_off' end::public.activity_action,
    (select auth.uid()),
    stored_reason
  );
end;
$$;

create or replace function public.tick_program_code(offering_id uuid, program_code_id uuid, ticked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.offerings;
begin
  select * into target from public.offerings o where o.id = tick_program_code.offering_id;
  if not found or not public.teaches((select auth.uid()), target.id) then
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

create or replace function public.update_my_profile(full_name text, title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_full_name text := btrim(update_my_profile.full_name);
  new_title text := nullif(btrim(update_my_profile.title), '');
begin
  if not public.is_active((select auth.uid())) then
    raise exception 'This account is deactivated.' using errcode = '42501';
  end if;
  if coalesce(new_full_name, '') = '' then
    raise exception 'Give your full name.' using errcode = '23514';
  end if;
  if char_length(new_full_name) > 200 then
    raise exception 'Your full name can have at most 200 characters.' using errcode = '22001';
  end if;
  if char_length(new_title) > 40 then
    raise exception 'Your title can have at most 40 characters.' using errcode = '22001';
  end if;
  update public.profiles p set full_name = new_full_name, title = new_title where p.id = (select auth.uid());
end;
$$;
