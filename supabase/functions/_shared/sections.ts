// The 19 sections are code constants, shared by the app and the Edge Functions.

/**
 * Whether a section is on: always, always but allowed to stay empty (7 to 9), or switchable
 * per course type and offering (10 to 16).
 */
type SectionKind = 'always' | 'may-be-empty' | 'switchable'

/** The 19 sections of every course file, in the fixed order. */
export const SECTIONS = [
  { number: 1, title: 'Academic Calendar', kind: 'always' },
  { number: 2, title: 'Teaching Plan', kind: 'always' },
  { number: 3, title: 'Appointment Letter', kind: 'always' },
  { number: 4, title: 'Lecturer Timetable', kind: 'always' },
  { number: 5, title: 'Student Timetable', kind: 'always' },
  { number: 6, title: 'Attendance Record', kind: 'always' },
  { number: 7, title: 'Replacement Notices', kind: 'may-be-empty' },
  { number: 8, title: 'Proof of Absence', kind: 'may-be-empty' },
  { number: 9, title: 'Warning Letters', kind: 'may-be-empty' },
  { number: 10, title: 'Lecture Notes', kind: 'switchable' },
  { number: 11, title: 'Lab Exercises', kind: 'switchable' },
  { number: 12, title: 'Tutorial', kind: 'switchable' },
  { number: 13, title: 'Quiz', kind: 'switchable' },
  { number: 14, title: 'Assignment', kind: 'switchable' },
  { number: 15, title: 'Mid-Term Test', kind: 'switchable' },
  { number: 16, title: 'Final Exam', kind: 'switchable' },
  { number: 17, title: 'Week 12 Marks', kind: 'always' },
  { number: 18, title: 'Grade List', kind: 'always' },
  { number: 19, title: 'LO/PO Analysis', kind: 'always' },
] as const satisfies readonly { number: number; title: string; kind: SectionKind }[]

/** A named place for files in a section. name is how the database stores it. */
export type SectionSlot = { name: string; title: string }

/**
 * The slots of each section whose files go into named slots. The files of other sections go
 * straight into the section. The files table's check constraint lists the same names.
 */
export const SECTION_SLOTS: Readonly<Partial<Record<number, readonly SectionSlot[]>>> = {
  19: [
    { name: 'po_achievement', title: 'PO Achievement' },
    { name: 'lo_achievement', title: 'LO Achievement' },
    { name: 'lo_po_evaluation', title: 'LO/PO Evaluation' },
    { name: 'cqi', title: 'CQI' },
  ],
}
