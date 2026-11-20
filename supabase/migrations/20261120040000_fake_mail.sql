-- The fake mailbox. With MAIL_ADAPTER set to fake, as on the local stack, the Edge Functions record
-- each email here instead of sending it through Microsoft Graph. Seam 1 tests read the outbox with
-- the secret key. Only the service role has access, so clients can neither read nor write it. The
-- schema exists everywhere because supabase/config.toml exposes it to PostgREST, which does not
-- start when an exposed schema is missing.

create schema fake_mail;

-- One email as the mail adapter was asked to send it.
create table fake_mail.outbox (
  id uuid primary key default gen_random_uuid(),
  recipients text[] not null,
  subject text not null,
  html text not null,
  sent_at timestamptz not null default now()
);

grant usage on schema fake_mail to service_role;
grant all on fake_mail.outbox to service_role;
