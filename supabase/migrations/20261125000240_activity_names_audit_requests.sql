-- The activity of a course file named a send, a staff comment, a reply or a close only as "an audit
-- request", so with several auditors and rounds nobody could tell which request an entry was about.
-- Each such entry now comes with its request's auditor, round and flagged sections.
--
-- course_file_activity is as profile_titles made it, with three more columns. A new return type
-- makes a new function, so the old one goes first.

drop function public.course_file_activity(uuid, timestamptz, bigint, integer);

create function public.course_file_activity(
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
  comment text,
  request_auditor_name text,
  request_round integer,
  request_sections smallint[]
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
  select
    a.id, a.created_at, a.action, a.section, p.display_name, a.file_name, c.code, sc.code, ss.code, a.reason, a.comment,
    ap.display_name,
    case when r.id is not null then public.round_number(r) end,
    (select array_agg(i.section order by i.section) from public.audit_request_items i where i.request_id = r.id)
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
  left join public.audit_requests r on r.id = a.audit_request_id
  left join public.profiles ap on ap.id = r.auditor_id
  order by a.created_at desc, a.id desc
  limit course_file_activity.page_size;
end;
$$;

revoke execute on function public.course_file_activity from anon, public;
