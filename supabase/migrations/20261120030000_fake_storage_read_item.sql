-- The whole of a stored item, for the download URLs of the fake storage adapter. PostgREST sends a
-- function's result as the raw response body when the function returns a domain named after the
-- requested media type, so the fake-storage Edge Function passes the bytes on without decoding them.

create domain fake_storage."application/octet-stream" as bytea;

-- The item's bytes. An item that does not exist answers HTTP 404.
create function fake_storage.read_item(item_id uuid)
returns fake_storage."application/octet-stream"
language plpgsql
stable
set search_path = ''
as $$
declare
  content bytea;
begin
  select i.content into content from fake_storage.items i where i.id = read_item.item_id;
  if not found then
    raise sqlstate 'PT404' using message = 'The item does not exist.';
  end if;
  return content;
end;
$$;

revoke all on function fake_storage.read_item from public;
grant execute on function fake_storage.read_item to service_role;
