-- How many browsers each audit request notification reached. A notification that went to no
-- browser, because push is off or no recipient turned notifications on, still counts as delivered,
-- since sending it again would reach nobody either. Until now that looked the same as one that
-- reached everyone, so the app told nobody to pass the step on. The audit-requests function now
-- records the count with the delivery, and the request shows it, so the auditor and the staff know
-- when to tell people directly.

-- reached is the number of browsers the notification went to. Deliveries recorded before this
-- migration have none, since nobody counted.
alter table public.audit_request_notifications
  add column reached integer check (reached >= 0),
  add constraint audit_request_notifications_reached_delivered_check check (reached is null or delivered_at is not null);

-- The number of browsers that the notification of the request's latest step reached, for every
-- reader of the request, who cannot read the deliveries. Null for a draft, while the notification
-- has not gone, and for a delivery recorded before the count was kept.
create function public.notified_browsers(public.audit_requests)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select n.reached
  from public.audit_request_notifications n
  where n.request_id = $1.id and n.state = $1.state and n.delivered_at is not null
$$;

-- The auditor's email, for every reader of the request, so staff can tell the auditor directly
-- when the reply's notification reached nobody. Lecturers cannot read other profiles.
create function public.auditor_email(public.audit_requests)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.email from public.profiles p where p.id = $1.auditor_id
$$;

revoke execute on function public.notified_browsers, public.auditor_email from anon, public;
