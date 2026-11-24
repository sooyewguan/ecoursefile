import { parse } from 'csv-parse/sync'
import { strFromU8, unzipSync } from 'fflate'
import readXlsxFile from 'read-excel-file/universal'
import { describe, expect, test } from 'vitest'
import { exportReport, type ExportFormat } from './report-export.ts'
import { REPORT_FIXTURE } from './report-fixture.ts'
import {
  filterLecturers,
  filterOfferings,
  HEATMAP_TABLE,
  LECTURERS_TABLE,
  lecturerOfferings,
  MY_COMPLETENESS_TABLE,
  OFFERINGS_TABLE,
  SUMMARY_TABLE,
  summaryRows,
} from './report-tables.ts'
import { OFFERING_STATUS_LABELS, type DepartmentRow, type FacultySummary, type LecturerRow, type OfferingRow } from './reports.ts'
import { SECTION_STATUS_LABELS, SECTIONS } from './sections.ts'

// The rows come from the report RPCs, as scripts/capture-report-fixture.ts captured them for a
// seeded semester. Each test exports rows the way the page does, then reads the file back: an
// .xlsx with read-excel-file, the reader of the write-excel-file author, and a .csv with csv-parse.

const FORMATS: ExportFormat[] = ['xlsx', 'csv']

/** A cell as the screen shows it: text, a count or percentage, the day of a timestamp, or nothing. */
type Expected = string | number | { day: string } | null

/** The day a timestamp falls on in the time zone the tests run in, such as 2026-11-20. */
function day(timestamp: string | null) {
  return timestamp === null ? null : { day: new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(new Date(timestamp)) }
}

/** Missing sections by number and title, such as 4 Lecturer Timetable, 5 Student Timetable. */
function sections(numbers: number[]) {
  return numbers.length > 0 ? numbers.map((number) => `${number} ${SECTIONS.find((section) => section.number === number)!.title}`).join(', ') : null
}

const POOLED_HEADERS = [
  'Offerings',
  'Offerings complete',
  'Offerings verified',
  'Sections',
  'Sections uploaded',
  'Uploaded (%)',
  'Sections verified',
  'Verified (%)',
  'Sections needing fix',
  'Needs fix (%)',
]

function pooled(row: FacultySummary): Expected[] {
  return [
    row.offerings,
    row.complete_offerings,
    row.verified_offerings,
    row.counted_sections,
    row.uploaded_sections,
    row.percent_uploaded,
    row.verified_sections,
    row.percent_verified,
    row.needs_fix_sections,
    row.percent_needs_fix,
  ]
}

const OFFERING_HEADERS = [
  'Course code',
  'Course',
  'Department code',
  'Department',
  'Coordinator',
  'Coordinator email',
  'Status',
  'Complete (%)',
  'Missing sections',
  'Sections needing fix',
  'Last upload',
]

function offering(row: OfferingRow): Expected[] {
  return [
    row.course_code,
    row.course_title,
    row.department_code,
    row.department_name,
    row.coordinator_name,
    row.coordinator_email,
    OFFERING_STATUS_LABELS[row.status],
    row.percent_complete,
    sections(row.missing_sections),
    sections(row.section_statuses.flatMap((status, index) => (status === 'needs_fix' ? [index + 1] : []))),
    day(row.last_upload_at),
  ]
}

const MY_COMPLETENESS_HEADERS = ['Course code', 'Course', 'Coordinator', 'Status', 'Complete (%)', 'Missing sections', 'Sections needing fix', 'Last upload']

/** An offering as My completeness exports it: the offering list without the department and the coordinator's email. */
function ownOffering(row: OfferingRow): Expected[] {
  const [code, title, , , coordinator, , status, complete, missing, needsFix, lastUpload] = offering(row)
  return [code, title, coordinator, status, complete, missing, needsFix, lastUpload]
}

const LECTURER_HEADERS = ['Lecturer', 'Email', 'Department code', 'Department', 'Timetable', 'Course code', 'Course', 'Role', 'Missing sections', 'Sections needing fix']

function lecturer(row: LecturerRow): Expected[][] {
  return row.offerings.map((taught) => [
    row.lecturer_name,
    row.lecturer_email,
    row.department_code,
    row.department_name,
    row.timetable_missing ? 'Missing' : 'Uploaded',
    taught.course_code,
    taught.course_title,
    taught.coordinator ? 'Coordinator' : 'Lecturer',
    sections(taught.missing_sections),
    sections(taught.needs_fix_sections),
  ])
}

/** Each view with the rows the page shows unfiltered, and the table a file of it must hold. */
const VIEWS: { name: string; export: (format: ExportFormat) => Promise<File>; headers: string[]; rows: Expected[][] }[] = [
  {
    name: 'Summary',
    export: (format) =>
      exportReport(SUMMARY_TABLE, summaryRows(REPORT_FIXTURE.facultySummary[0], REPORT_FIXTURE.departments), REPORT_FIXTURE.semesterCode, format),
    headers: ['Department code', 'Department', ...POOLED_HEADERS],
    rows: [
      ...REPORT_FIXTURE.departments.map((row: DepartmentRow) => [row.department_code, row.department_name, ...pooled(row)]),
      [null, 'All departments', ...pooled(REPORT_FIXTURE.facultySummary[0])],
    ],
  },
  {
    name: 'Offerings',
    export: (format) => exportReport(OFFERINGS_TABLE, REPORT_FIXTURE.offerings, REPORT_FIXTURE.semesterCode, format),
    headers: OFFERING_HEADERS,
    rows: REPORT_FIXTURE.offerings.map(offering),
  },
  {
    name: 'Heatmap',
    export: (format) => exportReport(HEATMAP_TABLE, REPORT_FIXTURE.offerings, REPORT_FIXTURE.semesterCode, format),
    headers: ['Course code', 'Course', ...SECTIONS.map((section) => `${section.number} ${section.title}`)],
    rows: REPORT_FIXTURE.offerings.map((row) => [row.course_code, row.course_title, ...row.section_statuses.map((status) => SECTION_STATUS_LABELS[status])]),
  },
  {
    name: 'Lecturers',
    export: (format) => exportReport(LECTURERS_TABLE, REPORT_FIXTURE.lecturers.flatMap(lecturerOfferings), REPORT_FIXTURE.semesterCode, format),
    headers: LECTURER_HEADERS,
    rows: REPORT_FIXTURE.lecturers.flatMap(lecturer),
  },
  {
    name: 'My completeness',
    export: (format) => exportReport(MY_COMPLETENESS_TABLE, REPORT_FIXTURE.chloeOfferings, REPORT_FIXTURE.semesterCode, format),
    headers: MY_COMPLETENESS_HEADERS,
    rows: REPORT_FIXTURE.chloeOfferings.map(ownOffering),
  },
]

/** A text cell of a .csv that a spreadsheet would run as a formula starts with ' instead. */
function csvCell(cell: Expected) {
  if (cell === null) return ''
  if (typeof cell === 'number') return String(cell)
  if (typeof cell === 'object') return cell.day
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell
}

/** A day in an .xlsx is a date, which read-excel-file reads as midnight UTC. */
function xlsxCell(cell: Expected) {
  return cell !== null && typeof cell === 'object' ? new Date(`${cell.day}T00:00:00Z`) : cell
}

/** The file's cells, read back as a spreadsheet would read them, header row first. */
async function readBack(file: File): Promise<unknown[][]> {
  if (file.name.endsWith('.csv')) return parse(await file.text())
  const [sheet] = await readXlsxFile(file, { dateFormat: 'yyyy-mm-dd', trim: false })
  return sheet.data
}

function expectedFile(format: ExportFormat, headers: string[], rows: Expected[][]) {
  return [headers, ...rows.map((row) => row.map(format === 'csv' ? csvCell : xlsxCell))]
}

function semesterInFileName() {
  return REPORT_FIXTURE.semesterCode.replace('/', '-')
}

describe.each(VIEWS)('the $name view', (view) => {
  test.each(FORMATS)('exports to .%s, named after the view and the semester, with the rows and columns on screen', async (format) => {
    const file = await view.export(format)
    expect(file.name).toBe(`${view.name} ${semesterInFileName()}.${format}`)
    expect(await readBack(file)).toEqual(expectedFile(format, view.headers, view.rows))
  })
})

/** The course code of the seeded offering whose code starts with the catalog code, such as BITP1113. */
function courseCode(catalogCode: string) {
  return REPORT_FIXTURE.offerings.find((row) => row.course_code.startsWith(catalogCode))!.course_code
}

test.each(FORMATS)('the offering list exports only the offerings that its department and status filters show, to .%s', async (format) => {
  const ftmk = REPORT_FIXTURE.departments.find((row) => row.department_code.startsWith('FTMK'))!.department_id
  const exported = async (filters: Parameters<typeof filterOfferings>[1]) => {
    const file = await exportReport(OFFERINGS_TABLE, filterOfferings(REPORT_FIXTURE.offerings, filters), REPORT_FIXTURE.semesterCode, format)
    const [headers, ...rows] = await readBack(file)
    expect(headers).toEqual(OFFERING_HEADERS)
    return rows.map((row) => row[0])
  }

  // The seed puts BITP1113 and BITI2233 in FTMK, and leaves BITI2233 and BITU3973 incomplete.
  expect(await exported({ departmentId: null, status: null })).toEqual(['BITI2233', 'BITM3423', 'BITP1113', 'BITS3343', 'BITU3973'].map(courseCode))
  expect(await exported({ departmentId: ftmk, status: null })).toEqual(['BITI2233', 'BITP1113'].map(courseCode))
  expect(await exported({ departmentId: null, status: 'incomplete' })).toEqual(['BITI2233', 'BITU3973'].map(courseCode))
  expect(await exported({ departmentId: ftmk, status: 'incomplete' })).toEqual(['BITI2233'].map(courseCode))
  expect(await exported({ departmentId: ftmk, status: 'needs_fix' })).toEqual([])
})

test('My completeness exports the offerings that the lecturer teaches or coordinates', async () => {
  const [, ...rows] = await readBack(await exportReport(MY_COMPLETENESS_TABLE, REPORT_FIXTURE.chloeOfferings, REPORT_FIXTURE.semesterCode, 'csv'))
  expect(rows.map((row) => [row[0], row[2], row[6]])).toEqual([
    [courseCode('BITP1113'), 'Aisyah Rahman', ''],
    [courseCode('BITS3343'), 'Chloé Lefèvre', '6 Attendance Record'],
  ])
})

test('the lecturer view exports one row for each offering of each lecturer', async () => {
  const [, ...rows] = await readBack(await exportReport(LECTURERS_TABLE, REPORT_FIXTURE.lecturers.flatMap(lecturerOfferings), REPORT_FIXTURE.semesterCode, 'xlsx'))
  expect(rows.filter((row) => row[0] === 'Chloé Lefèvre').map((row) => [row[5], row[7]])).toEqual([
    [courseCode('BITP1113'), 'Lecturer'],
    [courseCode('BITS3343'), 'Coordinator'],
  ])
  // Chen has no department and no timetable, and the Teaching Plan of the course he teaches needs a fix.
  const chen = rows.find((row) => row[0] === '陈伟明')!
  expect(chen[1]).toMatch(/@seam1\.test$/)
  expect(chen.slice(2, 5)).toEqual([null, null, 'Missing'])
  expect(chen.slice(8)).toEqual([
    '4 Lecturer Timetable, 5 Student Timetable, 6 Attendance Record, 10 Lecture Notes, 17 Week 12 Marks, 18 Grade List, 19 LO/PO Analysis',
    '2 Teaching Plan',
  ])
})

test('the lecturer search keeps the lecturers whose name holds it, in any case and with or without accents', () => {
  const names = (search: string) => filterLecturers(REPORT_FIXTURE.lecturers, { search, departmentId: null }).map((row) => row.lecturer_name)
  expect(names('')).toEqual(REPORT_FIXTURE.lecturers.map((row) => row.lecturer_name))
  expect(names('chloe')).toEqual(['Chloé Lefèvre'])
  expect(names('  LEFÈVRE ')).toEqual(['Chloé Lefèvre'])
  expect(names('陈')).toEqual(['陈伟明'])
  expect(names('name')).toEqual(['\tTabbed Name', '\rReturned Name'])
  expect(names('nobody')).toEqual([])
})

test('a .csv starts with a UTF-8 byte order mark, quotes by RFC 4180, and shows a text that starts like a formula as text', async () => {
  const file = await exportReport(LECTURERS_TABLE, REPORT_FIXTURE.lecturers.flatMap(lecturerOfferings), REPORT_FIXTURE.semesterCode, 'csv')
  const bytes = new Uint8Array(await file.arrayBuffer())
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const text = new TextDecoder().decode(bytes.slice(3))
  expect(text.endsWith('\r\n')).toBe(true)
  expect(text.split('\r\n')[0]).toBe(LECTURER_HEADERS.join(','))

  // Quotes double inside a quoted field, and a comma or line break is quoted.
  expect(text).toContain('"\'=HYPERLINK(""https://example.com"",""Open"")"')
  expect(text).toContain('"Pengaturcaraan ""Java"", Lanjutan"')
  expect(text).toContain('"Sains Data\nGunaan"')
  expect(text).toContain('"\'\rReturned Name"')
  expect(text).toContain('"Jabatan Kejuruteraan Perisian, ""Pusat"" Ünïcode"')
  const names = (parse(text) as string[][]).map((row) => row[0])
  expect(names).toEqual(expect.arrayContaining(["'\tTabbed Name", "'\rReturned Name", "'-2+3 Dash", "'@SUM(1+1)", '陈伟明', 'Chloé Lefèvre']))
  const titles = (parse(text) as string[][]).map((row) => row[6])
  expect(titles).toContain("'+Statistik Asas")
})

test('an .xlsx holds a text that starts like a formula as the text itself, in the Text format, and no formula', async () => {
  const file = await exportReport(OFFERINGS_TABLE, REPORT_FIXTURE.offerings, REPORT_FIXTURE.semesterCode, 'xlsx')
  const [, ...rows] = await readBack(file)
  // read-excel-file reads a formula as the value a spreadsheet computed for it, so these are text.
  expect(rows.map((row) => row[4])).toEqual(expect.arrayContaining(['=HYPERLINK("https://example.com","Open")', '@SUM(1+1)', '-2+3 Dash']))
  expect(rows.map((row) => row[1])).toContain('+Statistik Asas')

  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const sheet = strFromU8(zip['xl/worksheets/sheet1.xml'])
  const styles = strFromU8(zip['xl/styles.xml'])
  expect(sheet).not.toMatch(/<f[\s>]/)
  // Excel's built-in Text format is 49, and a workbook can define its own with the code @.
  const textFormats = ['49', ...[...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="@"\/>/g)].map((match) => match[1])]
  const cellFormats = [...styles.match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/s)![1].matchAll(/<xf\b([^>]*)>/g)].map((match) => /numFmtId="(\d+)"/.exec(match[1])?.[1] ?? '0')
  const textCells = [...sheet.matchAll(/<c ([^>]*t="s"[^>]*)>/g)].map((match) => cellFormats[Number(/\bs="(\d+)"/.exec(match[1])?.[1] ?? 0)])
  expect(textCells.length).toBeGreaterThan(0)
  expect(textCells.every((format) => textFormats.includes(format))).toBe(true)
})
