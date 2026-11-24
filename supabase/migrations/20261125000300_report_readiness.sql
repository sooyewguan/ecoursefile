-- The reports answer which course files are not ready and whom to ask. Each function is as
-- 20261121010000_profile_titles.sql made it, with these changes:
--
-- - report_offerings gives the coordinator's email, and report_lecturers each lecturer's, to the
--   roles that open the Reports page. Lecturers cannot read other profiles, so they get null.
-- - A switched-off section that counts, because its latest verdict is Needs fix, and holds no file
--   is missing in the reports, as an on section without files is, and so is not uploaded. A
--   verdict never hides missing.
-- - report_departments and report_faculty_summary count the complete and the verified offerings.
-- - Each offering of report_lecturers names its department and lists the Needs fix sections linked
--   to the lecturer.
--
-- The return types change, so the functions are dropped and made again.

drop function public.report_lecturers(uuid);
drop function public.report_faculty_summary(uuid);
drop function public.report_departments(uuid);
drop function public.report_offerings(uuid);

-- The offering list and the heatmap: one row for each offering of the semester that the caller
-- reads, by course code. section_statuses holds the statuses that section_statuses_of gives, except
-- that a switched-off section that counts and has no file of its own is missing. Sections 10 to 16,
-- which are the ones that switch, hold no shared files.
create function public.report_offerings(semester_id uuid)
returns table (
  offering_id uuid,
  course_code text,
  course_title text,
  department_id uuid,
  department_code text,
  department_name text,
  coordinator_id uuid,
  coordinator_name text,
  coordinator_email text,
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
    select
      s.offering_id,
      s.section,
      s.counts_toward_completeness and s.status <> 'empty' as counts,
      case
        when s.counts_toward_completeness
          and s.section between 10 and 16
          and not s.section = any (o.sections_on)
          and not exists (select 1 from public.files f where f.offering_id = s.offering_id and f.section = s.section)
          then 'missing'
        else s.status
      end::public.section_status as status
    from public.section_statuses_of(public.report_offering_ids(report_offerings.semester_id)) s
    join public.offerings o on o.id = s.offering_id
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
    case when (select public.jwt_roles()) && '{admin,auditor,hod,dean,deputy_dean}' then p.email end,
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

-- The department breakdown: report_offerings summed for each department with offerings in the
-- semester, by department code. An offering is complete when no section that counts is missing,
-- and verified when every section that counts is Verified.
create function public.report_departments(semester_id uuid)
returns table (
  department_id uuid,
  department_code text,
  department_name text,
  offerings integer,
  complete_offerings integer,
  verified_offerings integer,
  counted_sections integer,
  uploaded_sections integer,
  verified_sections integer,
  needs_fix_sections integer,
  percent_uploaded numeric,
  percent_verified numeric,
  percent_needs_fix numeric
)
language sql
stable
set search_path = ''
as $$
  select
    o.department_id,
    o.department_code,
    o.department_name,
    count(*)::integer,
    count(*) filter (where o.status <> 'incomplete')::integer,
    count(*) filter (where o.status = 'verified')::integer,
    sum(o.counted_sections)::integer,
    sum(o.uploaded_sections)::integer,
    sum(o.verified_sections)::integer,
    sum(o.needs_fix_sections)::integer,
    public.report_percent(sum(o.uploaded_sections), sum(o.counted_sections)),
    public.report_percent(sum(o.verified_sections), sum(o.counted_sections)),
    public.report_percent(sum(o.needs_fix_sections), sum(o.counted_sections))
  from public.report_offerings(report_departments.semester_id) o
  group by o.department_id, o.department_code, o.department_name
  order by o.department_code
$$;

-- The faculty summary: report_offerings summed over the semester, as one row.
create function public.report_faculty_summary(semester_id uuid)
returns table (
  offerings integer,
  complete_offerings integer,
  verified_offerings integer,
  counted_sections integer,
  uploaded_sections integer,
  verified_sections integer,
  needs_fix_sections integer,
  percent_uploaded numeric,
  percent_verified numeric,
  percent_needs_fix numeric
)
language sql
stable
set search_path = ''
as $$
  select
    count(*)::integer,
    count(*) filter (where o.status <> 'incomplete')::integer,
    count(*) filter (where o.status = 'verified')::integer,
    coalesce(sum(o.counted_sections), 0)::integer,
    coalesce(sum(o.uploaded_sections), 0)::integer,
    coalesce(sum(o.verified_sections), 0)::integer,
    coalesce(sum(o.needs_fix_sections), 0)::integer,
    public.report_percent(sum(o.uploaded_sections), sum(o.counted_sections)),
    public.report_percent(sum(o.verified_sections), sum(o.counted_sections)),
    public.report_percent(sum(o.needs_fix_sections), sum(o.counted_sections))
  from public.report_offerings(report_faculty_summary.semester_id) o
$$;

-- The lecturer view: one row for each lecturer of the offerings in report_offerings, by full name.
-- Each offering names its department, and lists the missing and Needs fix sections linked to the
-- lecturer: the offering's, without sections 1 and 3, which the admin uploads, and without a
-- missing section 4 unless the lecturer's own timetable is missing.
create function public.report_lecturers(semester_id uuid)
returns table (
  lecturer_id uuid,
  lecturer_name text,
  lecturer_email text,
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
    case when (select public.jwt_roles()) && '{admin,auditor,hod,dean,deputy_dean}' then p.email end,
    d.id,
    d.code,
    d.name,
    t.timetable_missing,
    jsonb_agg(
      jsonb_build_object(
        'offering_id', t.offering_id,
        'course_code', t.course_code,
        'course_title', t.course_title,
        'department_id', t.department_id,
        'department_code', t.department_code,
        'department_name', t.department_name,
        'coordinator', t.coordinator_id = t.lecturer_id,
        'missing_sections', array(
          select m
          from unnest(t.missing_sections) as m
          where m not in (1, 3, 4) or (m = 4 and t.timetable_missing)
        ),
        'needs_fix_sections', array(
          select u.section
          from unnest(t.section_statuses) with ordinality as u (status, section)
          where u.status = 'needs_fix' and u.section not in (1, 3)
          order by u.section
        )
      )
      order by t.course_code
    )
  from taught t
  join public.profiles p on p.id = t.lecturer_id
  left join public.departments d on d.id = p.department_id
  group by t.lecturer_id, p.full_name, p.display_name, p.email, d.id, d.code, d.name, t.timetable_missing
  order by p.full_name, t.lecturer_id
$$;

revoke execute on function public.report_faculty_summary, public.report_departments, public.report_offerings,
  public.report_lecturers from anon, public;
