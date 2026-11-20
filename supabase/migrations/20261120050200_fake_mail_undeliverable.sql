-- Addresses that the fake mailbox refuses, so seam 1 tests can make an email fail as Graph would.
-- The fake mailer's insert into the outbox fails when any recipient is listed here, so the email is
-- not recorded and the Edge Function that sent it sees the failure. Only the service role has access.
create table fake_mail.undeliverable (address text primary key);

create function fake_mail.refuse_undeliverable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from fake_mail.undeliverable u where u.address = any (new.recipients)) then
    raise exception 'The fake mailbox refuses email to an undeliverable address.';
  end if;
  return new;
end;
$$;

create trigger refuse_undeliverable_before_insert
  before insert on fake_mail.outbox
  for each row execute function fake_mail.refuse_undeliverable();

grant all on fake_mail.undeliverable to service_role;
