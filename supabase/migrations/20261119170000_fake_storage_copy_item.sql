-- Copies a stored item to a new item at path, the way a Graph copy does, and returns the copy, or no
-- row when there is no item with item_id. Like an upload, a copy never replaces an item, and its type
-- comes from its name. The copy holds its own bytes, so deleting either item leaves the other. The
-- files Edge Function copies a past offering's file this way when staff reuse it.
create function fake_storage.copy_item(item_id uuid, path text)
returns setof fake_storage.items
language sql
set search_path = ''
as $$
  insert into fake_storage.items (path, mime_type, content)
  select
    copy_item.path,
    case when lower(copy_item.path) like '%.pdf' then 'application/pdf' else 'application/octet-stream' end,
    i.content
  from fake_storage.items i
  where i.id = copy_item.item_id
  returning *
$$;

revoke all on function fake_storage.copy_item from public;
grant execute on function fake_storage.copy_item to service_role;
