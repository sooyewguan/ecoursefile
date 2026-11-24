-- The admin sets up a semester by copying the offerings of another one. Each course of the source
-- semester that the target does not offer yet is offered in the target with the same coordinator
-- and lecturers, as create_offering offers it, so it takes its course type's sections as they are
-- now and none of the source's switches. Staff who are deactivated, or no longer hold the lecturer
-- role, cannot teach, so they are left off, and an offering whose coordinator is one of them is
-- skipped. The copy is one statement, so it adds every offering or none.

create function public.copy_offerings(source_semester_id uuid, target_semester_id uuid)
returns table (
  course_id uuid,
  course_code text,
  course_title text,
  -- The new offering, or null when the offering was skipped.
  offering_id uuid,
  -- Why the offering was skipped: already_offered, or coordinator_unavailable when its coordinator
  -- is deactivated or no longer a lecturer. Null when it was copied.
  skipped text,
  coordinator_name text,
  -- The names of the source offering's staff who were not copied, because they are deactivated or
  -- no longer lecturers.
  left_off text[]
)
language plpgsql
set search_path = ''
as $$
declare
  source record;
begin
  if not (select public.jwt_roles()) @> '{admin}' then
    raise exception 'Only admins copy offerings.' using errcode = '42501';
  end if;

  for source in
    select
      o.course_id,
      o.coordinator_id,
      c.code,
      c.title,
      coordinator.display_name as coordinator_name,
      exists (select 1 from public.offerings t where t.semester_id = copy_offerings.target_semester_id and t.course_id = o.course_id) as offered,
      o.coordinator_id = any (staff.available) as coordinator_available,
      staff.available,
      staff.left_off
    from public.offerings o
    join public.courses c on c.id = o.course_id
    join public.profiles coordinator on coordinator.id = o.coordinator_id
    cross join lateral (
      select
        coalesce(array_agg(member.id) filter (where member.can_teach), '{}') as available,
        coalesce(array_agg(member.display_name order by member.full_name) filter (where not member.can_teach), '{}') as left_off
      from (
        select p.id, p.display_name, p.full_name,
          p.active and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'lecturer') as can_teach
        from public.offering_lecturers l
        join public.profiles p on p.id = l.lecturer_id
        where l.offering_id = o.id
      ) member
    ) staff
    where o.semester_id = copy_offerings.source_semester_id
    order by c.code
  loop
    course_id := source.course_id;
    course_code := source.code;
    course_title := source.title;
    coordinator_name := source.coordinator_name;
    offering_id := null;
    skipped := null;
    left_off := case when source.offered then '{}' else source.left_off end;
    if source.offered then
      skipped := 'already_offered';
    elsif not source.coordinator_available then
      skipped := 'coordinator_unavailable';
    else
      offering_id := public.create_offering(copy_offerings.target_semester_id, source.course_id, source.coordinator_id, source.available);
    end if;
    return next;
  end loop;
end;
$$;

revoke execute on function public.copy_offerings from anon, public;
