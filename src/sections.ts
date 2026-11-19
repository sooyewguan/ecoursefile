import { itemName, SECTION_SLOTS, SECTIONS, type Section, type SectionSlot } from '../supabase/functions/_shared/sections.ts'
import type { PagesPerSheet } from './pdf/n-up.ts'

export { itemName, SECTION_SLOTS, SECTIONS, type Section, type SectionSlot }

/** The sections that a course type switches on or off by default, in section order. */
export const SWITCHABLE_SECTIONS = SECTIONS.filter((section) => section.kind === 'switchable')

/**
 * The sections whose files staff upload and arrange on the section page. can_upload in SQL allows
 * the same ones, and Lecture Notes (10) only while the offering has it on.
 */
export const FILE_SECTIONS: ReadonlySet<number> = new Set([2, 6, 7, 8, 9, 10, 17, 18, 19])

/**
 * How many pages the browser puts on each page of a PDF before it uploads it to the slot: the
 * slot's perSheet, such as 4 for answer scripts, else the section's, such as 8 for Lecture Notes.
 * Undefined when the PDF goes up as it is.
 */
export function pagesPerSheet({ section, slot }: { section: number; slot?: string | null }): PagesPerSheet | undefined {
  return SECTION_SLOTS[section]?.find((s) => s.name === slot)?.perSheet ?? SECTIONS.find((s) => s.number === section)?.perSheet
}

/** A section's status, as the section_statuses RPC returns it. */
export type SectionStatus = 'missing' | 'pending_review' | 'empty' | 'off'

export const SECTION_STATUS_LABELS: Record<SectionStatus, string> = {
  missing: 'Missing',
  pending_review: 'Pending review',
  empty: 'Empty',
  off: 'Off',
}
