import { OFFERING_STATUS_LABELS, type DepartmentRow, type FacultySummary, type LecturerRow, type OfferingRow, type OfferingStatus } from './reports.ts'
import { SECTION_STATUS_LABELS, sectionName, SECTIONS } from './sections.ts'

// The columns of each report view, which the Reports and My completeness pages show and export.
// The pages read each header and value from here, so a file holds what the screen shows. A value
// is null where the screen shows a placeholder, such as Never or a dash, and the file leaves the
// cell empty.

/**
 * One column of a report view. text is shown and exported as it is. A number is a count. A
 * percent is shown as 82.5% and exported as the number 82.5, under the header with (%) added, so a
 * spreadsheet can sort and sum it. A date is a timestamp, which the screen and the file show as the
 * day it falls on where the user is.
 */
export type ReportColumn<Row> =
  | { header: string; kind: 'text'; value: (row: Row) => string | null }
  | { header: string; kind: 'number' | 'percent'; value: (row: Row) => number | null }
  | { header: string; kind: 'date'; value: (row: Row) => string | null }

type Columns<Row> = Record<string, ReportColumn<Row>>

/** A report view as a table: its name, which names the exported file, and its columns in order. */
export type ReportTable<Row> = { view: string; columns: Columns<Row> }

/** Sections by number and title in order, such as 4 Lecturer Timetable, 10 Lecture Notes, or null for none. */
function sectionList(sections: number[]) {
  return sections.length > 0 ? sections.map(sectionName).join(', ') : null
}

/** The counts and percentages of the faculty or a department, as one value each. */
const POOLED_COLUMNS = {
  offerings: { header: 'Offerings', kind: 'number', value: (row) => row.offerings },
  sections: { header: 'Sections', kind: 'number', value: (row) => row.counted_sections },
  uploaded: { header: 'Sections uploaded', kind: 'number', value: (row) => row.uploaded_sections },
  uploadedPercent: { header: 'Uploaded', kind: 'percent', value: (row) => row.percent_uploaded },
  verified: { header: 'Sections verified', kind: 'number', value: (row) => row.verified_sections },
  verifiedPercent: { header: 'Verified', kind: 'percent', value: (row) => row.percent_verified },
  needsFix: { header: 'Sections needing fix', kind: 'number', value: (row) => row.needs_fix_sections },
  needsFixPercent: { header: 'Needs fix', kind: 'percent', value: (row) => row.percent_needs_fix },
} satisfies Columns<FacultySummary>

export const FACULTY_SUMMARY_TABLE = { view: 'Faculty summary', columns: POOLED_COLUMNS } satisfies ReportTable<FacultySummary>

export const DEPARTMENTS_TABLE = {
  view: 'Departments',
  columns: {
    departmentCode: { header: 'Department code', kind: 'text', value: (row) => row.department_code },
    departmentName: { header: 'Department', kind: 'text', value: (row) => row.department_name },
    ...POOLED_COLUMNS,
  },
} satisfies ReportTable<DepartmentRow>

/** The columns of the offering list, which My completeness shows too. */
export const OFFERING_COLUMNS = {
  courseCode: { header: 'Course code', kind: 'text', value: (row) => row.course_code },
  courseTitle: { header: 'Course', kind: 'text', value: (row) => row.course_title },
  departmentCode: { header: 'Department code', kind: 'text', value: (row) => row.department_code },
  departmentName: { header: 'Department', kind: 'text', value: (row) => row.department_name },
  coordinator: { header: 'Coordinator', kind: 'text', value: (row) => row.coordinator_name },
  status: { header: 'Status', kind: 'text', value: (row) => OFFERING_STATUS_LABELS[row.status] },
  complete: { header: 'Complete', kind: 'percent', value: (row) => row.percent_complete },
  missingSections: { header: 'Missing sections', kind: 'text', value: (row) => sectionList(row.missing_sections) },
  lastUpload: { header: 'Last upload', kind: 'date', value: (row) => row.last_upload_at },
} satisfies Columns<OfferingRow>

export const OFFERINGS_TABLE = { view: 'Offerings', columns: OFFERING_COLUMNS } satisfies ReportTable<OfferingRow>

export const MY_COMPLETENESS_TABLE = { view: 'My completeness', columns: OFFERING_COLUMNS } satisfies ReportTable<OfferingRow>

/** The offerings that the offering list shows: those of the department and with the status, where one is chosen. */
export function filterOfferings(rows: OfferingRow[], filters: { departmentId: string | null; status: OfferingStatus | null }) {
  return rows.filter((row) => (!filters.departmentId || row.department_id === filters.departmentId) && (!filters.status || row.status === filters.status))
}

/** The heatmap's columns: the course, then each section's status, such as Missing, in section order. */
export const HEATMAP_TABLE = {
  view: 'Heatmap',
  columns: {
    courseCode: OFFERING_COLUMNS.courseCode,
    courseTitle: OFFERING_COLUMNS.courseTitle,
    ...Object.fromEntries(
      SECTIONS.map((section, index): [string, ReportColumn<OfferingRow>] => [
        `section${section.number}`,
        { header: sectionName(section.number), kind: 'text', value: (row) => SECTION_STATUS_LABELS[row.section_statuses[index]] },
      ]),
    ),
  },
} satisfies ReportTable<OfferingRow>

/** One offering of one lecturer: a row of the lecturer view, which the screen groups by lecturer. */
export type LecturerOffering = { lecturer: LecturerRow; offering: LecturerRow['offerings'][number] }

/** The lecturer's rows of the lecturer view, one for each of their offerings, in the report's order. */
export function lecturerOfferings(lecturer: LecturerRow): LecturerOffering[] {
  return lecturer.offerings.map((offering) => ({ lecturer, offering }))
}

export const LECTURERS_TABLE = {
  view: 'Lecturers',
  columns: {
    lecturer: { header: 'Lecturer', kind: 'text', value: (row) => row.lecturer.lecturer_name },
    departmentCode: { header: 'Department code', kind: 'text', value: (row) => row.lecturer.department_code },
    departmentName: { header: 'Department', kind: 'text', value: (row) => row.lecturer.department_name },
    timetable: { header: 'Timetable', kind: 'text', value: (row) => (row.lecturer.timetable_missing ? 'Missing' : 'Uploaded') },
    courseCode: { header: 'Course code', kind: 'text', value: (row) => row.offering.course_code },
    courseTitle: { header: 'Course', kind: 'text', value: (row) => row.offering.course_title },
    role: { header: 'Role', kind: 'text', value: (row) => (row.offering.coordinator ? 'Coordinator' : 'Lecturer') },
    missingSections: { header: 'Missing sections', kind: 'text', value: (row) => sectionList(row.offering.missing_sections) },
  },
} satisfies ReportTable<LecturerOffering>
