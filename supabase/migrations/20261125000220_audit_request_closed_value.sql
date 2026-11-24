-- An audit request gains a last state, closed, for a reply its auditor has reviewed, and the
-- activity log records each close as its own action. A new enum value cannot be used in the
-- transaction that adds it, so the values come before the migration that uses them.
alter type public.audit_request_state add value 'closed';
alter type public.activity_action add value 'close';
