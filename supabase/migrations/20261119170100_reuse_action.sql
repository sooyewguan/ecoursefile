-- The activity log records a reuse from a past offering as its own action. A new enum value cannot
-- be used in the transaction that adds it, so it comes before the migration that uses it.
alter type public.activity_action add value 'reuse';
