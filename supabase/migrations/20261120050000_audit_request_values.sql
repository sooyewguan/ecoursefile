-- Audit requests. The activity log records each send of a request, each staff comment on one of
-- its items and each reply as its own action. A new enum value cannot be used in the transaction
-- that adds it, so the values come before the migration that uses them.
alter type public.activity_action add value 'send';
alter type public.activity_action add value 'comment';
alter type public.activity_action add value 'reply';
