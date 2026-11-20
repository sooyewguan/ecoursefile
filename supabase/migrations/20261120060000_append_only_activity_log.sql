-- The activity log is append-only. Clients and the service role have no update, delete or truncate
-- grant on it, but grants do not bind the table's owner. The RPCs that log a change, such as
-- record_verdict and switch_section, run as the owner, and so does anyone working as the owner, such
-- as a migration or the SQL editor. These triggers refuse every change or removal of an entry, by
-- whoever makes it, so the log stays as each change wrote it.

create function public.refuse_activity_log_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The activity log is append-only. Its entries are never changed or removed.' using errcode = '42501';
end;
$$;

create trigger refuse_activity_log_update_or_delete
  before update or delete on public.activity_log
  for each row execute function public.refuse_activity_log_change();

create trigger refuse_activity_log_truncate
  before truncate on public.activity_log
  for each statement execute function public.refuse_activity_log_change();
