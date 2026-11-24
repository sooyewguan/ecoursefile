-- A replied audit request waits for its auditor to review the reply. Until now nothing marked a
-- reply as reviewed, so an auditor could not tell the replies they had dealt with from those still
-- waiting for them. The auditor now closes a replied request once they have checked its sections
-- again: its state goes from replied to closed, and the close is logged. A closed request changes no
-- further. Any section still wrong goes into a new request, as before.

-- closed_at is set exactly once the request is closed. A closed request keeps its reply.
alter table public.audit_requests
  add column closed_at timestamptz,
  drop constraint audit_requests_state_check,
  add constraint audit_requests_state_check check (
    (sent_at is not null) = (state <> 'draft')
    and (replied_at is not null) = (state in ('replied', 'closed'))
    and (replied_by is not null) = (state in ('replied', 'closed'))
    and (reply_message is null or state in ('replied', 'closed'))
    and (closed_at is not null) = (state = 'closed')
  );

-- The only changes a request takes are its three steps, each made by one update. A close keeps the
-- reply as it was.
create or replace function public.check_audit_request_step()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (
    (old.state, new.state) in (
      ('draft'::public.audit_request_state, 'sent'::public.audit_request_state),
      ('sent', 'replied'),
      ('replied', 'closed')
    )
    and (new.id, new.offering_id, new.auditor_id, new.created_at) = (old.id, old.offering_id, old.auditor_id, old.created_at)
    and new.sent_at is not distinct from coalesce(old.sent_at, new.sent_at)
    and (
      old.state <> 'replied'
      or (new.replied_at, new.replied_by, new.reply_message) is not distinct from (old.replied_at, old.replied_by, old.reply_message)
    )
  ) then
    raise exception 'An audit request goes from draft to sent to replied to closed, one step at a time.' using errcode = '55000';
  end if;
  return new;
end;
$$;

-- A close is logged with its request, and names no section and has no comment.
alter table public.activity_log
  drop constraint activity_log_audit_request_check,
  add constraint activity_log_audit_request_check check ((audit_request_id is not null) = (action in ('send', 'comment', 'reply', 'close'))),
  drop constraint activity_log_section_null_check,
  add constraint activity_log_section_null_check check ((section is null) = (action in ('send', 'reply', 'close')));

-- Closes a replied request for the caller, its auditor, once they have reviewed the reply, and logs
-- the close. The caller must be the request's auditor, with the auditor role and an active profile.
-- A closed request stays as it is, so a retry or a second click changes nothing. A draft or a sent
-- request has no reply to review, so it does not close.
create function public.close_audit_request(request_id uuid)
returns public.audit_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.audit_requests;
begin
  select * into target from public.audit_requests r where r.id = close_audit_request.request_id for update;
  if not found
    or target.auditor_id <> (select auth.uid())
    or not (select public.jwt_roles()) @> '{auditor}'
    or not exists (select 1 from public.profiles p where p.id = target.auditor_id and p.active)
  then
    raise exception 'Only the auditor who sent this request may close it.' using errcode = '42501';
  end if;
  if target.state = 'closed' then
    return target;
  end if;
  if target.state <> 'replied' then
    raise exception 'Close an audit request once staff have replied to it.' using errcode = '42501';
  end if;

  update public.audit_requests r set state = 'closed', closed_at = now() where r.id = target.id returning * into target;

  insert into public.activity_log (offering_id, action, actor_id, audit_request_id)
  values (target.offering_id, 'close', target.auditor_id, target.id);
  return target;
end;
$$;

-- Staff comment only on a sent request. Otherwise as before.
create or replace function public.comment_on_audit_item(request_id uuid, section smallint, comment text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.audit_requests;
  stored_comment text := nullif(regexp_replace(comment_on_audit_item.comment, '^\s+|\s+$', '', 'g'), '');
begin
  select * into target from public.audit_requests r where r.id = comment_on_audit_item.request_id for update;
  if not found
    or target.state = 'draft'
    or not public.teaches((select auth.uid()), target.offering_id)
    or not exists (
      select 1 from public.audit_request_items i where i.request_id = target.id and i.section = comment_on_audit_item.section
    )
  then
    raise exception 'Only the coordinator and lecturers of the offering may comment on the items of a sent audit request.' using errcode = '42501';
  end if;
  if target.state <> 'sent' then
    raise exception 'This audit request has been replied to, so its checklist no longer changes.' using errcode = '42501';
  end if;
  if stored_comment is null then
    raise exception 'Say why the section cannot be fixed.' using errcode = '23514';
  end if;

  update public.audit_request_items i
  set comment = stored_comment, commented_by = (select auth.uid()), commented_at = now()
  where i.request_id = target.id and i.section = comment_on_audit_item.section and i.comment is distinct from stored_comment;
  if found then
    insert into public.activity_log (offering_id, section, action, actor_id, audit_request_id, comment)
    values (target.offering_id, comment_on_audit_item.section, 'comment', (select auth.uid()), target.id, stored_comment);
  end if;
end;
$$;

-- Staff reply only to a sent request. A replied or closed request stays as it is. Otherwise as
-- before.
create or replace function public.reply_to_audit_request(request_id uuid, actor_id uuid, message text default null)
returns public.audit_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.audit_requests;
  stored_message text := nullif(regexp_replace(reply_to_audit_request.message, '^\s+|\s+$', '', 'g'), '');
begin
  select * into target from public.audit_requests r where r.id = reply_to_audit_request.request_id for update;
  if not found
    or target.state = 'draft'
    or not public.teaches(reply_to_audit_request.actor_id, target.offering_id)
    or not exists (select 1 from public.profiles p where p.id = reply_to_audit_request.actor_id and p.active)
  then
    raise exception 'Only the coordinator and lecturers of the offering may reply to a sent audit request.' using errcode = '42501';
  end if;
  if target.state <> 'sent' or not public.checklist_complete(target) then
    return target;
  end if;

  update public.audit_request_items i
  set replied_file_ids = c.file_ids
  from public.offerings o
  cross join lateral public.section_contents(o) c
  where o.id = target.offering_id and i.request_id = target.id and c.section = i.section;

  update public.audit_requests r
  set state = 'replied', replied_at = now(), replied_by = reply_to_audit_request.actor_id, reply_message = stored_message
  where r.id = target.id
  returning * into target;

  insert into public.activity_log (offering_id, action, actor_id, audit_request_id, comment)
  values (target.offering_id, 'reply', target.replied_by, target.id, stored_message);
  return target;
end;
$$;

-- Only a send and a reply owe a notification. A closed request owes none.
create or replace function public.notification_pending(public.audit_requests)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select $1.state in ('sent', 'replied') and not exists (
    select 1
    from public.audit_request_notifications n
    where n.request_id = $1.id and n.state = $1.state and n.delivered_at is not null
  )
$$;

create or replace function public.claim_audit_notification(request_id uuid, state public.audit_request_state)
returns boolean
language sql
set search_path = ''
as $$
  insert into public.audit_request_notifications (request_id, state, claimed_at)
  select r.id, r.state, now()
  from public.audit_requests r
  where r.id = claim_audit_notification.request_id and r.state = claim_audit_notification.state and r.state in ('sent', 'replied')
  on conflict on constraint audit_request_notifications_pkey do update set claimed_at = excluded.claimed_at
  where public.audit_request_notifications.delivered_at is null
    and (public.audit_request_notifications.claimed_at is null or public.audit_request_notifications.claimed_at < now() - interval '5 minutes')
  returning true
$$;

revoke execute on function public.close_audit_request from anon, public;
