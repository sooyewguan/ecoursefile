-- Two add_item calls on one section at the same time read the same highest number, so one of them
-- failed on the items primary key. add_item now locks the offering's row first, so adds to an
-- offering run one after another and each reads the number the one before it added.

-- Adds the next item to a section with items and returns its number. The caller must be allowed
-- to upload to the section.
create or replace function public.add_item(offering_id uuid, section smallint)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  added smallint;
begin
  -- The lock lasts until the end of the transaction. It leaves the offering's key alone, so
  -- uploads, whose foreign keys only share the key, do not wait for it.
  perform from public.offerings o where o.id = add_item.offering_id for no key update;

  if add_item.section not between 11 and 16 or not public.can_upload(add_item.offering_id, add_item.section) then
    raise exception 'You may not add items to this section.' using errcode = '42501';
  end if;

  insert into public.items (offering_id, section, number)
  select add_item.offering_id, add_item.section, coalesce(max(i.number), 0) + 1
  from public.items i
  where i.offering_id = add_item.offering_id and i.section = add_item.section
  returning number into added;
  return added;
end;
$$;
