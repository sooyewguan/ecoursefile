-- put_chunk takes the chunk as the raw request body. The fake-storage Edge Function sent each 5 MiB
-- chunk as hex text inside a JSON body, and building that text took about 100 ms of the worker's
-- CPU per chunk. A worker that reaches 1 s of CPU retires, and a chunk sent to it as it retires
-- fails with HTTP 503 or 546. PostgREST passes a body of type application/octet-stream to a
-- function with one unnamed bytea argument, so the session, start and total come as headers.

drop function fake_storage.put_chunk(uuid, bigint, bigint, bytea);

-- Takes the chunk of an upload session that starts at byte start, the way a Graph upload URL does,
-- and returns the HTTP status and JSON body that Graph would send. The chunk is the request body,
-- and the X-Upload-Session, X-Upload-Start and X-Upload-Total request headers give the session's
-- id, the chunk's first byte and the item's size.
create function fake_storage.put_chunk(bytea)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  chunk bytea := $1;
  headers jsonb := current_setting('request.headers', true)::jsonb;
  session_id uuid := headers ->> 'x-upload-session';
  start bigint := headers ->> 'x-upload-start';
  total bigint := headers ->> 'x-upload-total';
  upload fake_storage.upload_sessions;
  item fake_storage.items;
begin
  select * into upload
  from fake_storage.upload_sessions s
  where s.id = session_id and s.expires_at > now()
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
grant execute on function fake_storage.put_chunk to service_role;
