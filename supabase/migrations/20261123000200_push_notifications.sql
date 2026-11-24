-- Audit requests notify by push through Firebase Cloud Messaging instead of by email. Each browser
-- where a user turned notifications on holds one FCM registration token, and push_tokens maps it to
-- the user. The audit-requests function sends each step's notification to every token of its
-- recipients, and removes a token that FCM no longer knows.

create table public.push_tokens (
  token text primary key check (length(token) between 1 and 4096),
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy "Users read their own push tokens" on public.push_tokens
  for select to authenticated using (user_id = (select auth.uid()));

revoke insert, update, delete, truncate on public.push_tokens from anon, authenticated;

-- Registers the browser's token for the caller. A browser that another user signed in on before
-- passes its token to the caller, so the earlier user's notifications stop coming to it.
create function public.register_push_token(token text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.push_tokens (token, user_id)
  values (register_push_token.token, (select auth.uid()))
  on conflict on constraint push_tokens_pkey do update set user_id = excluded.user_id, created_at = now()
$$;

-- Removes the browser's token, when the user turns notifications off or signs out. A token of
-- another user stays.
create function public.unregister_push_token(token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens t where t.token = unregister_push_token.token and t.user_id = (select auth.uid())
$$;

revoke execute on function public.register_push_token, public.unregister_push_token from anon, public;

-- The deliveries were of emails. They are now of push notifications, with the same claim rules.
alter table public.audit_request_emails rename to audit_request_notifications;
alter table public.audit_request_notifications rename constraint audit_request_emails_pkey to audit_request_notifications_pkey;

drop function public.email_pending(public.audit_requests);
drop function public.claim_audit_email(uuid, public.audit_request_state);

-- Whether the notification of the request's latest step has not been delivered yet. Readers of the
-- request may know, though they cannot read the deliveries.
create function public.notification_pending(public.audit_requests)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select $1.state <> 'draft' and not exists (
    select 1
    from public.audit_request_notifications n
    where n.request_id = $1.id and n.state = $1.state and n.delivered_at is not null
  )
$$;

-- Claims the delivery of the notification that the request owes for its state, for the
-- audit-requests function, which calls it with the service role. True when the caller may send the
-- notification now: the request is in that state, the notification is not delivered, and no other
-- call holds a claim younger than five minutes.
create function public.claim_audit_notification(request_id uuid, state public.audit_request_state)
returns boolean
language sql
set search_path = ''
as $$
  insert into public.audit_request_notifications (request_id, state, claimed_at)
  select r.id, r.state, now()
  from public.audit_requests r
  where r.id = claim_audit_notification.request_id and r.state = claim_audit_notification.state and r.state <> 'draft'
  on conflict on constraint audit_request_notifications_pkey do update set claimed_at = excluded.claimed_at
  where public.audit_request_notifications.delivered_at is null
    and (public.audit_request_notifications.claimed_at is null or public.audit_request_notifications.claimed_at < now() - interval '5 minutes')
  returning true
$$;

revoke execute on function public.notification_pending from anon, public;
revoke execute on function public.claim_audit_notification from anon, authenticated, public;

-- The fake push service. With PUSH_ADAPTER set to fake, as on the local stack, the audit-requests
-- function records each notification here instead of sending it through FCM. Seam 1 tests read the
-- outbox with the secret key. A token in undeliverable fails the send, as an FCM outage would, and
-- a token in unregistered is refused as FCM refuses a token it no longer knows. Only the service
-- role has access.
create schema fake_push;

create table fake_push.outbox (
  id uuid primary key default gen_random_uuid(),
  token text not null,
  title text not null,
  body text not null,
  link text not null,
  sent_at timestamptz not null default now()
);

create table fake_push.undeliverable (token text primary key);
create table fake_push.unregistered (token text primary key);

grant usage on schema fake_push to service_role;
grant all on all tables in schema fake_push to service_role;
