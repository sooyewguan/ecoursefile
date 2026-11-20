-- Audit requests. An auditor's Needs fix marks on a course file collect into their draft request for
-- it, and nobody is emailed until the auditor sends the draft. Sending emails the offering's
-- coordinator and lecturers once, with every flagged section and its comment, and turns the sections
-- into their checklist. An item ticks itself once its section holds a file that it did not hold at
-- the send. Staff comment on any item they cannot fix, and once every item is ticked or commented,
-- any of them replies to the auditor, which emails the auditor. A Needs fix after the send, or after
-- the reply, goes into the auditor's next draft. Several auditors keep their own requests on one
-- course file.
--
-- A request's state is draft, then sent, then replied. A trigger allows only those two steps, so no
-- writer can skip one, go back, or change a request in any other way. An auditor has at most one
-- draft per course file, by a unique index, so marks made at the same time share one draft.
--
-- Only the audit-requests Edge Function makes the two steps, since the RPCs that make them are the
-- service role's alone, so no step happens without the function trying its email. It sends each
-- step's email after the step has committed, and records the delivery in audit_request_emails. A
-- step whose email failed keeps its state, and the email stays owed until a retry of the step
-- delivers it.

create type public.audit_request_state as enum ('draft', 'sent', 'replied');

-- sent_at is set exactly once the request is sent, and the reply's columns exactly once it is
-- replied. A reply message is optional, and has no outer blanks.
create table public.audit_requests (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.offerings (id) on delete restrict,
  auditor_id uuid not null references public.profiles (id) on delete restrict,
  state public.audit_request_state not null default 'draft',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  replied_at timestamptz,
  replied_by uuid references public.profiles (id) on delete restrict,
  reply_message text check (reply_message ~ '^\S(.*\S)?$'),
  constraint audit_requests_state_check check (
    (sent_at is not null) = (state <> 'draft')
    and (replied_at is not null) = (state = 'replied')
    and (replied_by is not null) = (state = 'replied')
    and (reply_message is null or state = 'replied')
  )
);

create unique index audit_requests_one_draft_idx on public.audit_requests (offering_id, auditor_id) where state = 'draft';
create index audit_requests_offering_id_idx on public.audit_requests (offering_id);

-- The only changes a request takes are its two steps, each made by one update.
create function public.check_audit_request_step()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (
    (old.state, new.state) in (('draft'::public.audit_request_state, 'sent'::public.audit_request_state), ('sent', 'replied'))
    and (new.id, new.offering_id, new.auditor_id, new.created_at) = (old.id, old.offering_id, old.auditor_id, old.created_at)
    and new.sent_at is not distinct from coalesce(old.sent_at, new.sent_at)
  ) then
    raise exception 'An audit request goes from draft to sent to replied, one step at a time.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger check_audit_request_step_before_update
  before update on public.audit_requests
  for each row execute function public.check_audit_request_step();

-- One flagged section of a request. verdict_id is the Needs fix verdict that flagged it, whose
-- comment says what to fix. sent_file_ids and replied_file_ids are the ids that section_contents
-- returned for the section at the send and at the reply. comment is a staff comment, for an item
-- they cannot fix, without outer blanks.
create table public.audit_request_items (
  request_id uuid not null references public.audit_requests (id) on delete cascade,
  section smallint not null check (section between 1 and 19),
  verdict_id bigint not null references public.section_verdicts (id) on delete restrict,
  sent_file_ids uuid[],
  replied_file_ids uuid[],
  comment text check (comment ~ '^\S(.*\S)?$'),
  commented_by uuid references public.profiles (id) on delete restrict,
  commented_at timestamptz,
  primary key (request_id, section),
  constraint audit_request_items_commenter_check check ((comment is null) = (commented_by is null) and (comment is null) = (commented_at is null))
);

-- The delivery of the email that a request owes for reaching a state: the send's email to staff,
-- and the reply's email to the auditor. The audit-requests function claims the delivery before it
-- sends, so two calls never send the email at once. A claim that a crashed call left lapses after
-- five minutes, longer than an Edge Function may run.
create table public.audit_request_emails (
  request_id uuid not null references public.audit_requests (id) on delete restrict,
  state public.audit_request_state not null check (state <> 'draft'),
  claimed_at timestamptz,
  delivered_at timestamptz,
  primary key (request_id, state)
);

-- A send and a reply are logged with their request, and a staff comment with its request, section
-- and comment. A reply carries its message, if it has one. Sends and replies name no section.
alter table public.activity_log
  add column audit_request_id uuid references public.audit_requests (id) on delete restrict,
  alter column section drop not null,
  add constraint activity_log_audit_request_check check ((audit_request_id is not null) = (action in ('send', 'comment', 'reply'))),
  add constraint activity_log_section_null_check check ((section is null) = (action in ('send', 'reply'))),
  drop constraint activity_log_program_code_check,
  add constraint activity_log_program_code_check check (
    (program_code_id is not null) = coalesce(section = 5 and action not in ('verified', 'needs_fix', 'comment'), false)
  ),
  drop constraint activity_log_comment_check,
  add constraint activity_log_comment_check check (
    case action
      when 'needs_fix' then comment is not null
      when 'comment' then comment is not null
      when 'verified' then true
      when 'reply' then true
      else comment is null
    end
  );

-- Whether the item's section holds a file that it did not hold at the send: an upload, a reuse, a
-- shared file uploaded or linked, such as a ticked program code's timetable. Once the request is
-- replied, the section as it was at the reply decides, so the checklist stays as staff replied.
-- A draft's items are never ticked.
create function public.ticked(public.audit_request_items)
returns boolean
language sql
stable
set search_path = ''
as $$
  select $1.sent_file_ids is not null and exists (
    select 1
    from unnest(coalesce($1.replied_file_ids, (
      select c.file_ids
      from public.audit_requests r
      join public.offerings o on o.id = r.offering_id
      cross join lateral public.section_contents(o) c
      where r.id = $1.request_id and c.section = $1.section
    ))) as f (id)
    where f.id <> all ($1.sent_file_ids)
  )
$$;

-- Whether staff may reply: every item of the request is ticked or commented.
create function public.checklist_complete(public.audit_requests)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1
    from public.audit_request_items i
    where i.request_id = $1.id and i.comment is null and not public.ticked(i)
  )
$$;

-- Whether the email of the request's latest step has not been delivered yet. Readers of the request
-- may know, though they cannot read the deliveries.
create function public.email_pending(public.audit_requests)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select $1.state <> 'draft' and not exists (
    select 1
    from public.audit_request_emails e
    where e.request_id = $1.id and e.state = $1.state and e.delivered_at is not null
  )
$$;

-- The names of the request's auditor, of the staff member who replied, and of the staff member who
-- commented on an item, for every reader. Lecturers cannot read other profiles.
create function public.auditor_name(public.audit_requests)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.full_name from public.profiles p where p.id = $1.auditor_id
$$;

create function public.replier_name(public.audit_requests)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.full_name from public.profiles p where p.id = $1.replied_by
$$;

create function public.commenter_name(public.audit_request_items)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.full_name from public.profiles p where p.id = $1.commented_by
$$;

-- Whether the user is the coordinator or a lecturer of the offering.
create function public.teaches(user_id uuid, offering_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.offering_lecturers l where l.offering_id = teaches.offering_id and l.lecturer_id = teaches.user_id
  )
$$;

-- Records the caller's verdict on a section as before. A Needs fix also puts the section in the
-- caller's draft request for the course file, with this verdict's comment, and makes the draft if
-- they have none. A Verified takes the section out of their draft, and a draft left with no sections
-- goes. The draft is locked first, so a send of it waits for the mark, and the mark for the send.
create or replace function public.record_verdict(offering_id uuid, section smallint, verdict public.verdict, comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
-- The draft's conflict target names its columns, such as offering_id, which a parameter shares.
#variable_conflict use_column
declare
  target public.offerings;
  stored_comment text := nullif(regexp_replace(record_verdict.comment, '^\s+|\s+$', '', 'g'), '');
  recorded_id bigint;
  draft_id uuid;
begin
  select * into target from public.offerings o where o.id = record_verdict.offering_id;
  if not found
    or not (select public.jwt_roles()) @> '{auditor}'
    or record_verdict.section not between 1 and 19
  then
    raise exception 'Only auditors may record verdicts on course file sections.' using errcode = '42501';
  end if;
  if record_verdict.verdict is null then
    raise exception 'Say whether the section is verified or needs fixing.' using errcode = '22004';
  end if;
  if record_verdict.verdict = 'needs_fix' and stored_comment is null then
    raise exception 'Say what needs fixing.' using errcode = '23514';
  end if;

  insert into public.section_verdicts (offering_id, section, verdict, comment, auditor_id, file_ids, section_on)
  select target.id, c.section, record_verdict.verdict, stored_comment, (select auth.uid()), c.file_ids, c.is_on
  from public.section_contents(target) c
  where c.section = record_verdict.section
  returning id into recorded_id;

  insert into public.activity_log (offering_id, section, action, actor_id, comment)
  values (
    target.id,
    record_verdict.section,
    record_verdict.verdict::text::public.activity_action,
    (select auth.uid()),
    stored_comment
  );

  select r.id into draft_id
  from public.audit_requests r
  where r.offering_id = target.id and r.auditor_id = (select auth.uid()) and r.state = 'draft'
  for update;

  if record_verdict.verdict = 'needs_fix' then
    if draft_id is null then
      insert into public.audit_requests (offering_id, auditor_id)
      values (target.id, (select auth.uid()))
      on conflict (offering_id, auditor_id) where state = 'draft' do nothing
      returning id into draft_id;
    end if;
    -- Another mark by the same auditor made the draft since this one looked.
    if draft_id is null then
      select r.id into strict draft_id
      from public.audit_requests r
      where r.offering_id = target.id and r.auditor_id = (select auth.uid()) and r.state = 'draft'
      for update;
    end if;
    insert into public.audit_request_items (request_id, section, verdict_id)
    values (draft_id, record_verdict.section, recorded_id)
    on conflict (request_id, section) do update set verdict_id = excluded.verdict_id;
  elsif draft_id is not null then
    delete from public.audit_request_items i where i.request_id = draft_id and i.section = record_verdict.section;
    delete from public.audit_requests r
    where r.id = draft_id and not exists (select 1 from public.audit_request_items i where i.request_id = r.id);
  end if;
end;
$$;

-- Sends a draft request for the actor: each item keeps the section's files as they are now, which
-- later uploads tick against, and the send is logged. Only the auditor who drafted the request may
-- send it, while they have the auditor role and an active profile. A request that is already sent
-- stays as it is, so a retry or a second click changes nothing. The audit-requests function calls
-- this with the service role and the caller's id, then emails staff.
create function public.send_audit_request(request_id uuid, actor_id uuid)
returns public.audit_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.audit_requests;
begin
  select * into target from public.audit_requests r where r.id = send_audit_request.request_id for update;
  if not found
    or target.auditor_id <> send_audit_request.actor_id
    or not exists (
      select 1
      from public.profiles p
      join public.user_roles u on u.user_id = p.id and u.role = 'auditor'
      where p.id = send_audit_request.actor_id and p.active
    )
  then
    raise exception 'Only the auditor who drafted this request may send it.' using errcode = '42501';
  end if;
  if target.state <> 'draft' then
    return target;
  end if;

  update public.audit_request_items i
  set sent_file_ids = c.file_ids
  from public.offerings o
  cross join lateral public.section_contents(o) c
  where o.id = target.offering_id and i.request_id = target.id and c.section = i.section;

  update public.audit_requests r set state = 'sent', sent_at = now() where r.id = target.id returning * into target;

  insert into public.activity_log (offering_id, action, actor_id, audit_request_id)
  values (target.offering_id, 'send', target.auditor_id, target.id);
  return target;
end;
$$;

-- Sets the caller's comment on an item of a sent request, for an item they cannot fix, and logs it.
-- The caller must be the coordinator or a lecturer of the offering, and the request must be sent
-- and not yet replied. The comment needs text, and is kept without its outer blanks. A new comment
-- replaces the item's earlier one. The same comment again changes and logs nothing.
create function public.comment_on_audit_item(request_id uuid, section smallint, comment text)
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
  if target.state = 'replied' then
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

-- Replies to a sent request for the actor, one of the offering's staff: each item keeps the
-- section's files as they are now, so its tick stays as staff replied, and the reply is logged with
-- its message, which is optional and kept without its outer blanks. The actor must be the
-- coordinator or a lecturer of the offering, with an active profile. A request that is already
-- replied stays as it is, so a retry or a second click changes nothing, and so does one with an item
-- neither ticked nor commented. The audit-requests function calls this with the service role and
-- the caller's id, and tells the two apart by the state that comes back: it emails the auditor for
-- a replied request, and refuses a sent one as not ready.
create function public.reply_to_audit_request(request_id uuid, actor_id uuid, message text default null)
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
  if target.state = 'replied' or not public.checklist_complete(target) then
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

-- Claims the delivery of the email that the request owes for its state, for the audit-requests
-- function, which calls it with the service role. True when the caller may send the email now: the
-- request is in that state, the email is not delivered, and no other call holds a live claim.
create function public.claim_audit_email(request_id uuid, state public.audit_request_state)
returns boolean
language sql
set search_path = ''
as $$
  insert into public.audit_request_emails (request_id, state, claimed_at)
  select r.id, r.state, now()
  from public.audit_requests r
  where r.id = claim_audit_email.request_id and r.state = claim_audit_email.state and r.state <> 'draft'
  on conflict on constraint audit_request_emails_pkey do update set claimed_at = excluded.claimed_at
  where public.audit_request_emails.delivered_at is null
    and (public.audit_request_emails.claimed_at is null or public.audit_request_emails.claimed_at < now() - interval '5 minutes')
  returning true
$$;

revoke execute on function public.ticked, public.checklist_complete, public.email_pending, public.auditor_name(public.audit_requests),
  public.replier_name, public.commenter_name, public.comment_on_audit_item from anon, public;
revoke execute on function public.teaches, public.send_audit_request, public.reply_to_audit_request, public.claim_audit_email
  from anon, authenticated, public;

alter table public.audit_requests enable row level security;
alter table public.audit_request_items enable row level security;
alter table public.audit_request_emails enable row level security;

-- A draft is its auditor's alone. Once sent, a request and its items are read by every reader of the
-- course file. With no write policies, clients change requests only through record_verdict and
-- comment_on_audit_item, and the audit-requests function sends and replies.
create policy "Auditors read their drafts, and readers of an offering its sent requests" on public.audit_requests
  for select to authenticated using (
    case when state = 'draft' then auditor_id = (select auth.uid()) else public.can_read_offering(offering_id) end
  );

create policy "Readers of a request read its items" on public.audit_request_items
  for select to authenticated using (exists (select 1 from public.audit_requests r where r.id = request_id));

-- Only the RPCs above, which run as the owner, write requests and items. Only the service role, for
-- the audit-requests function, reads and writes the email deliveries.
revoke insert, update, delete, truncate on public.audit_requests, public.audit_request_items from anon, authenticated, service_role;
revoke all on public.audit_request_emails from anon, authenticated;
