import { isReusable, itemName, SECTION_SLOTS, SECTIONS, type Section, type SectionSlot } from '../supabase/functions/_shared/sections.ts'
import type { PagesPerSheet } from './pdf/n-up.ts'

export { isReusable, itemName, SECTION_SLOTS, SECTIONS, type Section, type SectionSlot }

/** The sections that a course type switches on or off by default, in section order. */
export const SWITCHABLE_SECTIONS = SECTIONS.filter((section) => section.kind === 'switchable')

/**
 * The sections whose files staff upload and arrange on the section page. can_upload in SQL allows
 * the same ones, and the switchable sections 10 to 16 only while the offering has them on.
 */
export const FILE_SECTIONS: ReadonlySet<number> = new Set([2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])

/** The sections of a semester's shared files, which the admin uploads on the semester page and every course file of the semester links. */
export const SEMESTER_FILE_SECTIONS = SECTIONS.filter((section) => section.sharedFile === 'semester')

/** Lecturer Timetable: each lecturer uploads their own for each semester, on its own section page. */
export const LECTURER_FILE_SECTION = SECTIONS.find((section) => section.sharedFile === 'lecturer')!

/**
 * Student Timetable: the admin uploads one for each program code for each semester on the semester
 * page, and staff tick the codes of each offering on its own section page.
 */
export const PROGRAM_CODE_FILE_SECTION = SECTIONS.find((section) => section.sharedFile === 'program_code')!

/**
 * The sections whose files the admin uploads on the semester page: the semester's shared files and
 * the student timetables. When one is Missing, the admin has the file to upload, not the lecturers.
 */
export const ADMIN_FILE_SECTIONS: ReadonlySet<number> = new Set(
  SECTIONS.filter((section) => section.sharedFile === 'semester' || section.sharedFile === 'program_code').map((section) => section.number),
)

/** The sections that open a section page: those that staff upload to, and those that link shared files. */
export const SECTIONS_WITH_PAGES: ReadonlySet<number> = new Set([
  ...FILE_SECTIONS,
  ...SECTIONS.filter((section) => section.sharedFile).map((section) => section.number),
])

/** A section's number and title, such as 2 Teaching Plan. */
export function sectionName(section: number) {
  return `${section} ${SECTIONS.find((s) => s.number === section)!.title}`
}

/**
 * How many pages the browser puts on each page of a PDF before it uploads it to the slot: the
 * slot's perSheet, such as 4 for answer scripts, else the section's, such as 8 for Lecture Notes.
 * Undefined when the PDF goes up as it is.
 */
export function pagesPerSheet({ section, slot }: { section: number; slot?: string | null }): PagesPerSheet | undefined {
  return SECTION_SLOTS[section]?.find((s) => s.name === slot)?.perSheet ?? SECTIONS.find((s) => s.number === section)?.perSheet
}

/** An auditor's verdict on a section, as the record_verdict RPC takes it. */
export type Verdict = 'verified' | 'needs_fix'

/** A section's status, as the section_statuses RPC returns it. A verdict is the status while the section is as the auditor judged it. */
export type SectionStatus = 'missing' | 'pending_review' | Verdict | 'empty' | 'off'

export const SECTION_STATUS_LABELS: Record<SectionStatus, string> = {
  missing: 'Missing',
  pending_review: 'Pending review',
  verified: 'Verified',
  needs_fix: 'Needs fix',
  empty: 'Empty',
  off: 'Off',
}
