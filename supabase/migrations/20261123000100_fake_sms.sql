-- The fake phone verifier. With PHONE_VERIFIER set to fake, as on the local stack, the fake-sms Edge
-- Function stands in for Firebase Phone Auth: it records each TAC here instead of texting it, and
-- swaps a right TAC for a token that the password function accepts as Firebase's ID token. Seam 1
-- tests, and a developer on the local stack, read the TAC from fake_sms.codes with the secret key.
-- Only the service role has access. The schema exists everywhere because supabase/config.toml
-- exposes it to PostgREST, which does not start when an exposed schema is missing.

create schema fake_sms;

-- One TAC as Firebase would text it. It works once, within five minutes.
create table fake_sms.codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code text not null,
  sent_at timestamptz not null default now(),
  used_at timestamptz
);

-- A token for a phone whose TAC was right, as Firebase's ID token proves one. It works for ten minutes.
create table fake_sms.tokens (
  token text primary key,
  phone text not null,
  issued_at timestamptz not null default now()
);

-- The phones that have an account, as Firebase Auth keeps a user for each phone that signed in. A
-- right TAC adds the phone, and the password function removes it when no profile has it any more.
create table fake_sms.accounts (phone text primary key);

grant usage on schema fake_sms to service_role;
grant all on all tables in schema fake_sms to service_role;
