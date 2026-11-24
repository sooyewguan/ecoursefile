-- Each auditor's requests on a course file are numbered as rounds, 1, 2 and on, in the order they
-- were sent. An auditor sends a new request for whatever is still wrong after a reply, so one
-- course file collects several requests from one auditor, and staff, the auditor and the activity
-- log tell them apart by round.

-- The request's round: its number among its auditor's requests on the course file, in the order
-- they were sent. A draft takes the number after the last one sent. It counts as the owner, since
-- only the auditor reads their draft, and any reader of the request may know its round.
create function public.round_number(public.audit_requests)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (count(*) + case when $1.state = 'draft' then 1 else 0 end)::integer
  from public.audit_requests r
  where r.offering_id = $1.offering_id
    and r.auditor_id = $1.auditor_id
    and r.state <> 'draft'
    and ($1.state = 'draft' or (r.sent_at, r.id) <= ($1.sent_at, $1.id))
$$;

revoke execute on function public.round_number from anon, public;
