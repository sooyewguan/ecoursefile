-- Only the offering's coordinator switches sections 10 to 16 on or off. The other lecturers still
-- upload to every section that is on, but no longer change which ones are.
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
    or target.coordinator_id is distinct from (select auth.uid())
    or not public.is_active((select auth.uid()))
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
