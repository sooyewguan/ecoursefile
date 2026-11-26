-- A file's bytes never change under its id. The browser keeps the bytes of each file it opened, by
-- the file's id, for 30 days, so a file whose storage item changed in place would show its old
-- bytes. Replacing a file deletes it and uploads a new one with a new id. This trigger refuses any
-- change to a file's id or storage item, by whoever makes it, the table's owner and the service
-- role included.

create function public.refuse_file_bytes_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A file keeps its id and its storage item. Upload a new file instead.' using errcode = '42501';
end;
$$;

create trigger refuse_file_bytes_change
  before update of id, storage_item_id on public.files
  for each row when (old.id is distinct from new.id or old.storage_item_id is distinct from new.storage_item_id)
  execute function public.refuse_file_bytes_change();
