-- Auditors give each section a verdict, Verified or Needs fix. The activity log records each verdict
-- as its own action, and a section's status can be its verdict. A new enum value cannot be used in
-- the transaction that adds it, so the values come before the migration that uses them.
alter type public.activity_action add value 'verified';
alter type public.activity_action add value 'needs_fix';
alter type public.section_status add value 'verified' after 'pending_review';
alter type public.section_status add value 'needs_fix' after 'verified';
