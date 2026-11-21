-- A profile's title is an honorific, such as Dr., Prof. Madya or Ts. display_name is how the app
-- names the person to everyone: the title and the full name, or the full name alone. Lists still
-- sort by full_name, so that people with a title do not group together.
alter table public.profiles
  add column title text check (title is null or (title = btrim(title) and title <> '' and char_length(title) <= 40)),
  add column display_name text generated always as (case when title is null then full_name else title || ' ' || full_name end) stored;

-- Admins set a user's title as they set the rest of the profile, through "Admins edit the profiles
-- they manage".
grant update (title) on public.profiles to authenticated;

-- A user changes their own name and title here, and nothing else of their profile. A policy that let
-- users update their own row would let them change their department and active flag too, which the
-- column grant allows for admins. Both values are trimmed, and a blank title is none. A blank name
-- fails with Postgres error 23514, and a name over 200 characters or a title over 40 with 22001.
create function public.update_my_profile(full_name text, title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_full_name text := btrim(update_my_profile.full_name);
  new_title text := nullif(btrim(update_my_profile.title), '');
begin
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

revoke execute on function public.update_my_profile from anon, public;
grant execute on function public.update_my_profile to authenticated;

-- Every name that the database shows to others becomes the display name. Each function is as its
-- migration made it, except that it reads display_name where it read full_name. report_lecturers
-- still sorts by full_name.

create or replace function public.uploader_name(public.files)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name from public.profiles p where p.id = $1.uploaded_by
$$;

create or replace function public.lecturer_name(public.offering_lecturers)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name from public.profiles p where p.id = $1.lecturer_id
$$;

create or replace function public.auditor_name(public.section_verdicts)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name from public.profiles p where p.id = $1.auditor_id
$$;

create or replace function public.auditor_name(public.audit_requests)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name from public.profiles p where p.id = $1.auditor_id
$$;

create or replace function public.replier_name(public.audit_requests)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name from public.profiles p where p.id = $1.replied_by
$$;

create or replace function public.commenter_name(public.audit_request_items)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name from public.profiles p where p.id = $1.commented_by
$$;

create or replace function public.course_file_activity(
  offering_id uuid,
  before_created_at timestamptz default null,
  before_id bigint default null,
  page_size integer default 50
)
returns table (
  id bigint,
  created_at timestamptz,
  action public.activity_action,
  section smallint,
  actor_name text,
  file_name text,
  program_code text,
  source_course_code text,
  source_semester_code text,
  reason text,
  comment text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  target public.offerings;
  -- The first page starts after every entry.
  cursor_created_at timestamptz := coalesce(course_file_activity.before_created_at, 'infinity');
  cursor_id bigint := coalesce(course_file_activity.before_id, 9223372036854775807);
begin
  select * into target from public.offerings o where o.id = course_file_activity.offering_id;
  if not found or not public.can_read_offering(target.id) then
    raise exception 'You may not read the activity of this course file.' using errcode = '42501';
  end if;

  return query
  select a.id, a.created_at, a.action, a.section, p.display_name, a.file_name, c.code, sc.code, ss.code, a.reason, a.comment
  from (
    (
      select *
      from public.activity_log a
      where a.offering_id = target.id and (a.created_at, a.id) < (cursor_created_at, cursor_id)
      order by a.created_at desc, a.id desc
      limit course_file_activity.page_size
    )
    union all
    (
      select *
      from public.activity_log a
      where a.semester_id = target.semester_id
        and (a.created_at, a.id) < (cursor_created_at, cursor_id)
        and exists (
          select 1
          from public.linked_shared_keys(target) k
          where (k.lecturer_id, k.program_code_id) is not distinct from (a.lecturer_id, a.program_code_id)
        )
      order by a.created_at desc, a.id desc
      limit course_file_activity.page_size
    )
  ) as a
  join public.profiles p on p.id = a.actor_id
  left join public.program_codes c on c.id = a.program_code_id
  left join public.offerings so on so.id = a.source_offering_id
  left join public.courses sc on sc.id = so.course_id
  left join public.semesters ss on ss.id = so.semester_id
  order by a.created_at desc, a.id desc
  limit course_file_activity.page_size;
end;
$$;

create or replace function public.report_offerings(semester_id uuid)
returns table (
  offering_id uuid,
  course_code text,
  course_title text,
  department_id uuid,
  department_code text,
  department_name text,
  coordinator_id uuid,
  coordinator_name text,
  status public.offering_status,
  counted_sections integer,
  uploaded_sections integer,
  verified_sections integer,
  needs_fix_sections integer,
  percent_complete numeric,
  missing_sections smallint[],
  section_statuses public.section_status[],
  last_upload_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select s.*, s.counts_toward_completeness and s.status <> 'empty' as counts
    from public.section_statuses_of(public.report_offering_ids(report_offerings.semester_id)) s
  ),
  totals as (
    select
      s.offering_id,
      count(*) filter (where s.counts) as counted,
      count(*) filter (where s.counts and s.status <> 'missing') as uploaded,
      count(*) filter (where s.counts and s.status = 'verified') as verified,
      count(*) filter (where s.counts and s.status = 'needs_fix') as needs_fix,
      count(*) filter (where s.counts and s.status = 'pending_review') as pending_review,
      coalesce(array_agg(s.section order by s.section) filter (where s.status = 'missing'), '{}') as missing_sections,
      array_agg(s.status order by s.section) as statuses
    from s
    group by s.offering_id
  )
  select
    o.id,
    c.code,
    c.title,
    d.id,
    d.code,
    d.name,
    o.coordinator_id,
    p.display_name,
    case
      when t.uploaded < t.counted then 'incomplete'
      when t.needs_fix > 0 then 'needs_fix'
      when t.pending_review > 0 then 'pending_review'
      else 'verified'
    end::public.offering_status,
    t.counted::integer,
    t.uploaded::integer,
    t.verified::integer,
    t.needs_fix::integer,
    public.report_percent(t.uploaded, t.counted),
    t.missing_sections,
    t.statuses,
    (select max(f.uploaded_at) from public.files f where f.offering_id = o.id)
  from totals t
  join public.offerings o on o.id = t.offering_id
  join public.courses c on c.id = o.course_id
  join public.departments d on d.id = c.department_id
  join public.profiles p on p.id = o.coordinator_id
  order by c.code
$$;

create or replace function public.report_lecturers(semester_id uuid)
returns table (
  lecturer_id uuid,
  lecturer_name text,
  department_id uuid,
  department_code text,
  department_name text,
  timetable_missing boolean,
  offerings jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with taught as (
    select
      l.lecturer_id,
      o.*,
      not exists (
        select 1
        from public.files f
        where f.semester_id = report_lecturers.semester_id and f.section = 4 and f.lecturer_id = l.lecturer_id
      ) as timetable_missing
    from public.report_offerings(report_lecturers.semester_id) o
    join public.offering_lecturers l on l.offering_id = o.offering_id
  )
  select
    t.lecturer_id,
    p.display_name,
    d.id,
    d.code,
    d.name,
    t.timetable_missing,
    jsonb_agg(
      jsonb_build_object(
        'offering_id', t.offering_id,
        'course_code', t.course_code,
        'course_title', t.course_title,
        'coordinator', t.coordinator_id = t.lecturer_id,
        'missing_sections', array(
          select m
          from unnest(t.missing_sections) as m
          where m not in (1, 3, 4) or (m = 4 and t.timetable_missing)
        )
      )
      order by t.course_code
    )
  from taught t
  join public.profiles p on p.id = t.lecturer_id
  left join public.departments d on d.id = p.department_id
  group by t.lecturer_id, p.full_name, p.display_name, d.id, d.code, d.name, t.timetable_missing
  order by p.full_name, t.lecturer_id
$$;
