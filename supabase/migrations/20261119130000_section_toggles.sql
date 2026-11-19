-- The coordinator and lecturers of an offering switch sections 10 to 16 on or off for it with
-- switch_section. A setting that differs from the course type's default carries a reason, and each
-- switch is logged. A switched-off section does not count toward the course file's completeness.

-- The switchable sections that are on: those on by default, with each section that has a reason
-- switched the other way.
create function public.apply_section_reasons(default_sections_on smallint[], section_reasons jsonb)
returns smallint[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(s.section::smallint order by s.section), '{}')
  from generate_series(10, 16) as s (section)
  where (s.section = any (default_sections_on)) <> (section_reasons ? s.section::text)
$$;

-- default_sections_on is the course type's sections_on, copied when the offering is created.
-- section_reasons holds a reason, keyed by section number, for each switchable section whose
-- setting differs from it. sections_on follows from the two, so a section differs from its
-- default exactly when it has a reason. No offering has been switched yet, so the defaults are the
-- sections that are on now.
alter table public.offerings
  add column default_sections_on smallint[],
  add column section_reasons jsonb not null default '{}';

update public.offerings set default_sections_on = sections_on;

alter table public.offerings
  alter column default_sections_on set not null,
  add constraint offerings_default_sections_on_check check (default_sections_on <@ '{10,11,12,13,14,15,16}'),
  drop column sections_on;

alter table public.offerings
  add column sections_on smallint[] not null
    generated always as (public.apply_section_reasons(default_sections_on, section_reasons)) stored;

create or replace function public.copy_course_type_sections()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select t.sections_on into new.default_sections_on
  from public.courses c
  join public.course_types t on t.id = c.course_type_id
  where c.id = new.course_id;
  return new;
end;
$$;

-- A switch is logged with the reason it was given, or with no reason when it returned the section
-- to its default. Only uploads and deletes name a file.
alter type public.activity_action add value 'switch_on';
alter type public.activity_action add value 'switch_off';

alter table public.activity_log
  alter column file_name drop not null,
  add column reason text,
  add constraint activity_log_file_name_check check ((file_name is not null) = (action in ('upload', 'delete')));

-- Switches a section from 10 to 16 on or off for the offering and logs it. The caller must be the
-- offering's coordinator or one of its lecturers. A setting that differs from the course type's
-- default needs a reason that is not blank. Returning to the default clears the reason, whatever
-- reason is given. Switching a section to the setting it has changes nothing.
create function public.switch_section(offering_id uuid, section smallint, is_on boolean, reason text default null)
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
    or not exists (
      select 1
      from public.offering_lecturers l
      where l.offering_id = target.id and l.lecturer_id = (select auth.uid())
    )
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

-- section_statuses gains counts_toward_completeness. A new column makes a new function, so the old
-- one goes first.
drop function public.section_statuses;

-- The status of each of the 19 sections of the offering's course file, in section order, and
-- whether the section counts toward the course file's completeness. The status is off for a
-- switchable section (10 to 16) that the offering has off, pending_review for a section with files,
-- empty for sections 7 to 9, which may stay empty and are never missing, and missing for every
-- other section. Every section counts except a switched-off one. The spec makes a switched-off
-- section with an open Needs fix verdict count too; that rule belongs here once verdicts exist. A
-- caller who may not read the offering gets no rows.
create function public.section_statuses(offering_id uuid)
returns table (section smallint, status public.section_status, counts_toward_completeness boolean)
language sql
stable
set search_path = ''
as $$
  select
    s.section::smallint,
    case
      when s.off then 'off'
      when exists (select 1 from public.files f where f.offering_id = o.id and f.section = s.section) then 'pending_review'
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

revoke execute on function public.apply_section_reasons, public.switch_section, public.section_statuses from anon, public;
