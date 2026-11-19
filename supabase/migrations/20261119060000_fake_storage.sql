-- The fake storage library. With STORAGE_ADAPTER set to fake, as on the local stack, the files
-- Edge Function keeps items here instead of in SharePoint, and the fake-storage Edge Function
-- takes the uploads. Seam 1 tests read the items with the secret key. Only the service role has
-- access. The schema exists everywhere because supabase/config.toml exposes it to PostgREST,
-- which does not start when an exposed schema is missing.

create schema fake_storage;

-- An upload in progress: the bytes received so far for an item at path.
create table fake_storage.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  received bytea not null default '',
  expires_at timestamptz not null default now() + interval '1 hour'
);

-- A stored item. Like SharePoint, the fake takes the type from the name's extension.
create table fake_storage.items (
  id uuid primary key default gen_random_uuid(),
  path text not null unique,
  mime_type text not null,
  content bytea not null,
  size bigint generated always as (octet_length(content)) stored,
  created_at timestamptz not null default now()
);

-- Takes the chunk of an upload session that starts at byte start, the way a Graph upload URL
-- does, and returns the HTTP status and JSON body that Graph would send.
create function fake_storage.put_chunk(session_id uuid, start bigint, total bigint, chunk bytea)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  upload fake_storage.upload_sessions;
  item fake_storage.items;
begin
  select * into upload
  from fake_storage.upload_sessions s
  where s.id = put_chunk.session_id and s.expires_at > now()
  for update;
  if not found then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('error', jsonb_build_object('code', 'itemNotFound')));
  end if;

  if start <> octet_length(upload.received) then
    return jsonb_build_object('status', 416, 'body', jsonb_build_object(
      'error', jsonb_build_object('code', 'invalidRange'),
      'nextExpectedRanges', jsonb_build_array(octet_length(upload.received) || '-')
    ));
  end if;

  if start + octet_length(chunk) < total then
    update fake_storage.upload_sessions s set received = s.received || chunk where s.id = upload.id;
    return jsonb_build_object('status', 202, 'body', jsonb_build_object(
      'expirationDateTime', upload.expires_at,
      'nextExpectedRanges', jsonb_build_array((start + octet_length(chunk)) || '-')
    ));
  end if;

  delete from fake_storage.upload_sessions s where s.id = upload.id;
  insert into fake_storage.items (path, mime_type, content)
  values (
    upload.path,
    case when lower(upload.path) like '%.pdf' then 'application/pdf' else 'application/octet-stream' end,
    upload.received || chunk
  )
  returning * into item;
  return jsonb_build_object('status', 201, 'body', jsonb_build_object(
    'id', item.id,
    'name', regexp_replace(item.path, '^.*/', ''),
    'size', item.size,
    'file', jsonb_build_object('mimeType', item.mime_type)
  ));
exception
  when unique_violation then
    return jsonb_build_object('status', 409, 'body', jsonb_build_object('error', jsonb_build_object('code', 'nameAlreadyExists')));
end;
$$;

revoke all on function fake_storage.put_chunk from public;
grant usage on schema fake_storage to service_role;
grant all on all tables in schema fake_storage to service_role;
grant execute on function fake_storage.put_chunk to service_role;
