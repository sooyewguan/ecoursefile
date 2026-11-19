import { SECTION_SLOTS, SECTIONS } from '../supabase/functions/_shared/sections.ts'
import type { PagesPerSheet } from './pdf/n-up.ts'

export { SECTION_SLOTS, SECTIONS }

/** The sections that a course type switches on or off by default, in section order. */
export const SWITCHABLE_SECTIONS = SECTIONS.filter((section) => section.kind === 'switchable')

/**
 * The sections whose files staff upload and arrange on the section page. can_upload in SQL allows
 * the same ones, and Lecture Notes (10) only while the offering has it on.
 */
export const FILE_SECTIONS: ReadonlySet<number> = new Set([2, 6, 7, 8, 9, 10, 17, 18, 19])

/** The sections whose PDFs the browser merges before upload, with how many pages it puts on each page. */
export const MERGED_SECTIONS: Readonly<Partial<Record<number, PagesPerSheet>>> = { 10: 8 }

/** A section's status, as the section_statuses RPC returns it. */
export type SectionStatus = 'missing' | 'pending_review' | 'empty' | 'off'

export const SECTION_STATUS_LABELS: Record<SectionStatus, string> = {
  missing: 'Missing',
  pending_review: 'Pending review',
  empty: 'Empty',
  off: 'Off',
}
