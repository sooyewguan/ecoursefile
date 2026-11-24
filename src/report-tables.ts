import { OFFERING_STATUS_LABELS, type DepartmentRow, type FacultySummary, type LecturerRow, type OfferingRow, type OfferingStatus } from './reports.ts'
import { SECTION_STATUS_LABELS, sectionName, SECTIONS } from './sections.ts'

// The columns of each report view, which the Reports and My completeness pages show and export.
// The pages read each header and value from here, so a file holds what the screen shows. A value
// is null where the screen shows a placeholder, such as No uploads yet or a dash, and the file leaves the
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
  completeOfferings: { header: 'Offerings complete', kind: 'number', value: (row) => row.complete_offerings },
  verifiedOfferings: { header: 'Offerings verified', kind: 'number', value: (row) => row.verified_offerings },
  sections: { header: 'Sections', kind: 'number', value: (row) => row.counted_sections },
  uploaded: { header: 'Sections uploaded', kind: 'number', value: (row) => row.uploaded_sections },
  uploadedPercent: { header: 'Uploaded', kind: 'percent', value: (row) => row.percent_uploaded },
  verified: { header: 'Sections verified', kind: 'number', value: (row) => row.verified_sections },
  verifiedPercent: { header: 'Verified', kind: 'percent', value: (row) => row.percent_verified },
  needsFix: { header: 'Sections needing fix', kind: 'number', value: (row) => row.needs_fix_sections },
  needsFixPercent: { header: 'Needs fix', kind: 'percent', value: (row) => row.percent_needs_fix },
} satisfies Columns<FacultySummary>

/** A row of the summary: a department, or the faculty as a whole, whose department is null. */
export type SummaryRow = FacultySummary & { department_code: string | null; department_name: string | null }

/** The summary: the department breakdown, then the faculty as All departments, so one file holds both. */
export const SUMMARY_TABLE = {
  view: 'Summary',
  columns: {
    departmentCode: { header: 'Department code', kind: 'text', value: (row) => row.department_code },
    departmentName: { header: 'Department', kind: 'text', value: (row) => row.department_name ?? 'All departments' },
    ...POOLED_COLUMNS,
  },
} satisfies ReportTable<SummaryRow>

/** The summary's rows: each department, then the faculty. */
export function summaryRows(faculty: FacultySummary, departments: DepartmentRow[]): SummaryRow[] {
  return [...departments, { ...faculty, department_code: null, department_name: null }]
}

/** The sections of the offering whose status is Needs fix, in section order. */
export function needsFixSections(row: OfferingRow) {
  return row.section_statuses.flatMap((status, index) => (status === 'needs_fix' ? [index + 1] : []))
}

/** The columns of the offering list, which My completeness shows too. */
export const OFFERING_COLUMNS = {
  courseCode: { header: 'Course code', kind: 'text', value: (row) => row.course_code },
  courseTitle: { header: 'Course', kind: 'text', value: (row) => row.course_title },
  departmentCode: { header: 'Department code', kind: 'text', value: (row) => row.department_code },
  departmentName: { header: 'Department', kind: 'text', value: (row) => row.department_name },
  coordinator: { header: 'Coordinator', kind: 'text', value: (row) => row.coordinator_name },
  coordinatorEmail: { header: 'Coordinator email', kind: 'text', value: (row) => row.coordinator_email },
  status: { header: 'Status', kind: 'text', value: (row) => OFFERING_STATUS_LABELS[row.status] },
  complete: { header: 'Complete', kind: 'percent', value: (row) => row.percent_complete },
  missingSections: { header: 'Missing sections', kind: 'text', value: (row) => sectionList(row.missing_sections) },
  needsFixSections: { header: 'Sections needing fix', kind: 'text', value: (row) => sectionList(needsFixSections(row)) },
  lastUpload: { header: 'Last upload', kind: 'date', value: (row) => row.last_upload_at },
} satisfies Columns<OfferingRow>

export const OFFERINGS_TABLE = { view: 'Offerings', columns: OFFERING_COLUMNS } satisfies ReportTable<OfferingRow>

/**
 * My completeness: the offering list without the department, since a lecturer's own offerings need
 * no breakdown, and with the sections to fix next to those missing, since both are theirs to act on.
 */
export const MY_COMPLETENESS_TABLE = {
  view: 'My completeness',
  columns: {
    courseCode: OFFERING_COLUMNS.courseCode,
    courseTitle: OFFERING_COLUMNS.courseTitle,
    coordinator: OFFERING_COLUMNS.coordinator,
    status: OFFERING_COLUMNS.status,
    complete: OFFERING_COLUMNS.complete,
    missingSections: OFFERING_COLUMNS.missingSections,
    needsFixSections: OFFERING_COLUMNS.needsFixSections,
    lastUpload: OFFERING_COLUMNS.lastUpload,
  },
} satisfies ReportTable<OfferingRow>

/** What the offering list and the heatmap filter by: an offering's status, or Not ready, which is Incomplete or Needs fix. */
export type StatusFilter = OfferingStatus | 'not_ready'

/** The status filters in the order the filter offers them, Not ready first. */
export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = { not_ready: 'Not ready', ...OFFERING_STATUS_LABELS }

const NOT_READY: readonly OfferingStatus[] = ['incomplete', 'needs_fix']

/** The offerings that the offering list and the heatmap show: those of the department and with the status, where one is chosen. */
export function filterOfferings(rows: OfferingRow[], filters: { departmentId: string | null; status: StatusFilter | null }) {
  const { departmentId, status } = filters
  return rows.filter(
    (row) => (!departmentId || row.department_id === departmentId) && (!status || (status === 'not_ready' ? NOT_READY.includes(row.status) : row.status === status)),
  )
}

/**
 * How the offering list can be sorted, besides by course code: by completeness, or by the last
 * upload, where an offering with no upload is the oldest. Ties keep the course code order.
 */
export const OFFERING_SORTS = {
  complete: { label: 'Least complete first', compare: (a, b) => a.percent_complete - b.percent_complete },
  '-complete': { label: 'Most complete first', compare: (a, b) => b.percent_complete - a.percent_complete },
  last_upload: { label: 'Oldest upload first', compare: (a, b) => uploadTime(a) - uploadTime(b) },
  '-last_upload': { label: 'Newest upload first', compare: (a, b) => uploadTime(b) - uploadTime(a) },
} satisfies Record<string, { label: string; compare: (a: OfferingRow, b: OfferingRow) => number }>

export type OfferingSort = keyof typeof OFFERING_SORTS

function uploadTime(row: OfferingRow) {
  return row.last_upload_at === null ? -Infinity : Date.parse(row.last_upload_at)
}

/** The rows in the sort's order, or as given, by course code, for none. */
export function sortOfferings(rows: OfferingRow[], sort: OfferingSort | null) {
  return sort ? rows.toSorted(OFFERING_SORTS[sort].compare) : rows
}

/** A department as the report rows name it. */
export type Department = { department_id: string; department_code: string; department_name: string }

/** The departments of the rows, each once, by code: those that a department filter offers. */
export function departmentsOf(rows: readonly Department[]): Department[] {
  return [...new Map(rows.map((row) => [row.department_id, row])).values()]
    .map(({ department_id, department_code, department_name }) => ({ department_id, department_code, department_name }))
    .toSorted((a, b) => a.department_code.localeCompare(b.department_code))
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

/** Text as search compares it: lower case, with accents dropped, so that chloe finds Chloé. */
function searchable(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/**
 * The lecturers whose name holds the search, in the report's order, and with a department, only
 * their offerings in it, and only the lecturers who have one. An empty search keeps every lecturer.
 */
export function filterLecturers(rows: LecturerRow[], filters: { search: string; departmentId: string | null }) {
  const wanted = searchable(filters.search.trim())
  return rows.flatMap((row) => {
    if (!searchable(row.lecturer_name).includes(wanted)) return []
    if (!filters.departmentId) return [row]
    const offerings = row.offerings.filter((offering) => offering.department_id === filters.departmentId)
    return offerings.length > 0 ? [{ ...row, offerings }] : []
  })
}

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
    email: { header: 'Email', kind: 'text', value: (row) => row.lecturer.lecturer_email },
    departmentCode: { header: 'Department code', kind: 'text', value: (row) => row.lecturer.department_code },
    departmentName: { header: 'Department', kind: 'text', value: (row) => row.lecturer.department_name },
    timetable: { header: 'Timetable', kind: 'text', value: (row) => (row.lecturer.timetable_missing ? 'Missing' : 'Uploaded') },
    courseCode: { header: 'Course code', kind: 'text', value: (row) => row.offering.course_code },
    courseTitle: { header: 'Course', kind: 'text', value: (row) => row.offering.course_title },
    role: { header: 'Role', kind: 'text', value: (row) => (row.offering.coordinator ? 'Coordinator' : 'Lecturer') },
    missingSections: { header: 'Missing sections', kind: 'text', value: (row) => sectionList(row.offering.missing_sections) },
    needsFixSections: { header: 'Sections needing fix', kind: 'text', value: (row) => sectionList(row.offering.needs_fix_sections) },
  },
} satisfies ReportTable<LecturerOffering>
