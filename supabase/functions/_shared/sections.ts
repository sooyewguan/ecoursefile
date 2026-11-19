// The 19 sections are code constants, shared by the app and the Edge Functions.

/**
 * Whether a section is on: always, always but allowed to stay empty (7 to 9), or switchable
 * per course type and offering (10 to 16).
 */
type SectionKind = 'always' | 'may-be-empty' | 'switchable'

/** How many pages the browser puts on each page of a PDF before it uploads it. */
type PagesPerSheet = 4 | 8

/** One of the 19 sections of every course file. */
export type Section = {
  number: number
  title: string
  kind: SectionKind
  /** What each numbered item is called, in a section whose files go into items, such as Lab for Lab 1. */
  itemTitle?: string
  /** Set when the browser merges every PDF of the section before upload. */
  perSheet?: PagesPerSheet
}

/** The 19 sections of every course file, in the fixed order. */
export const SECTIONS: readonly Section[] = [
  { number: 1, title: 'Academic Calendar', kind: 'always' },
  { number: 2, title: 'Teaching Plan', kind: 'always' },
  { number: 3, title: 'Appointment Letter', kind: 'always' },
  { number: 4, title: 'Lecturer Timetable', kind: 'always' },
  { number: 5, title: 'Student Timetable', kind: 'always' },
  { number: 6, title: 'Attendance Record', kind: 'always' },
  { number: 7, title: 'Replacement Notices', kind: 'may-be-empty' },
  { number: 8, title: 'Proof of Absence', kind: 'may-be-empty' },
  { number: 9, title: 'Warning Letters', kind: 'may-be-empty' },
  { number: 10, title: 'Lecture Notes', kind: 'switchable', perSheet: 8 },
  { number: 11, title: 'Lab Exercises', kind: 'switchable', itemTitle: 'Lab' },
  { number: 12, title: 'Tutorial', kind: 'switchable', itemTitle: 'Tutorial' },
  { number: 13, title: 'Quiz', kind: 'switchable', itemTitle: 'Quiz' },
  { number: 14, title: 'Assignment', kind: 'switchable', itemTitle: 'Assignment' },
  { number: 15, title: 'Mid-Term Test', kind: 'switchable', itemTitle: 'Test' },
  { number: 16, title: 'Final Exam', kind: 'switchable', itemTitle: 'Exam' },
  { number: 17, title: 'Week 12 Marks', kind: 'always' },
  { number: 18, title: 'Grade List', kind: 'always' },
  { number: 19, title: 'LO/PO Analysis', kind: 'always' },
]

/** An item's name, such as Lab 2: what its section calls items, and its number. */
export function itemName(section: number, item: number) {
  return `${SECTIONS.find((s) => s.number === section)?.itemTitle} ${item}`
}

/** A named place for files in a section, or in each item of a section with items. name is how the database stores it. */
export type SectionSlot = {
  name: string
  title: string
  /** Set when the slot holds at most one file. */
  oneFile?: true
  /** Set when the browser merges every PDF of the slot before upload. */
  perSheet?: PagesPerSheet
}

const QUESTION: SectionSlot = { name: 'question', title: 'Question' }
const ANSWER_SCHEME: SectionSlot = { name: 'answer_scheme', title: 'Answer Scheme' }
const MODERATION_FORM: SectionSlot = { name: 'moderation_form', title: 'Moderation Form' }

/** One answer script each from a high, a medium and a low scorer. */
const GRADED_SCRIPTS: SectionSlot[] = [
  { name: 'script_high', title: 'Script High', oneFile: true, perSheet: 4 },
  { name: 'script_medium', title: 'Script Medium', oneFile: true, perSheet: 4 },
  { name: 'script_low', title: 'Script Low', oneFile: true, perSheet: 4 },
]

/**
 * The slots of each section whose files go into named slots, in the order they show and compile.
 * In sections 11 to 16 every item has the section's slots. The files of other sections go straight
 * into the section. The files table's check constraint lists the same names, and its unique index
 * lists the oneFile slots.
 */
export const SECTION_SLOTS: Readonly<Partial<Record<number, readonly SectionSlot[]>>> = {
  11: [{ name: 'lab_sheet', title: 'Lab Sheet' }, ANSWER_SCHEME, ...GRADED_SCRIPTS],
  12: [QUESTION, ANSWER_SCHEME],
  13: [QUESTION, ANSWER_SCHEME, { name: 'scripts', title: 'Scripts', perSheet: 4 }],
  14: [QUESTION, { name: 'rubric', title: 'Rubric' }, MODERATION_FORM, ...GRADED_SCRIPTS],
  15: [QUESTION, ANSWER_SCHEME, MODERATION_FORM, ...GRADED_SCRIPTS],
  16: [QUESTION, ANSWER_SCHEME, MODERATION_FORM, ...GRADED_SCRIPTS],
  19: [
    { name: 'po_achievement', title: 'PO Achievement' },
    { name: 'lo_achievement', title: 'LO Achievement' },
    { name: 'lo_po_evaluation', title: 'LO/PO Evaluation' },
    { name: 'cqi', title: 'CQI' },
  ],
}
