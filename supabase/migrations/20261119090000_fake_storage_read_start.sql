-- The first bytes of a stored item, the way a Graph download with a Range header returns them.
-- The files Edge Function reads them at finalize to check that the item is really a PDF.
create function fake_storage.read_start(item_id uuid, length integer)
returns bytea
language sql
stable
set search_path = ''
as $$
  select substring(i.content from 1 for read_start.length) from fake_storage.items i where i.id = read_start.item_id
$$;

revoke all on function fake_storage.read_start from public;
grant execute on function fake_storage.read_start to service_role;
