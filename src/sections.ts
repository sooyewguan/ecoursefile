import { SECTIONS } from '../supabase/functions/_shared/sections.ts'

export { SECTIONS }

/** The sections that a course type switches on or off by default, in section order. */
export const SWITCHABLE_SECTIONS = SECTIONS.filter((section) => section.kind === 'switchable')

/** A section's status, as the section_statuses RPC returns it. */
export type SectionStatus = 'missing' | 'pending_review' | 'empty' | 'off'

export const SECTION_STATUS_LABELS: Record<SectionStatus, string> = {
  missing: 'Missing',
  pending_review: 'Pending review',
  empty: 'Empty',
  off: 'Off',
}
