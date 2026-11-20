import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { sizedPdf } from '../src/pdf/fixtures.ts'
import { fetchReport, type LecturerRow, type OfferingRow } from '../src/reports.ts'
import type { GlobalRole } from '../src/roles.ts'
import { uploadFile, type SharedSlot, type Slot } from '../src/uploads.ts'
import {
  adminClient,
  anonClient,
  createDepartment,
  createOffering,
  createUser,
  emptyReportSemester,
  pickSemester,
  signIn,
  signInAs,
} from './harness.ts'

// Each semester here comes from emptyReportSemester, so its reports count only the offerings that
// these tests seed. The tests upload the semester's calendar and letter, and timetables only for
// lecturers and program codes they create.

const PERMISSION_DENIED = '42501'

const CALENDAR = 1
const TEACHING_PLAN = 2
const LETTER = 3
const LECTURER_TIMETABLE = 4
const STUDENT_TIMETABLE = 5
const ATTENDANCE = 6
const REPLACEMENT_NOTICES = 7
const WARNING_LETTERS = 9
const LECTURE_NOTES = 10
const LAB_EXERCISES = 11
const TUTORIAL = 12
const WEEK_12_MARKS = 17
const GRADE_LIST = 18
const LO_PO_ANALYSIS = 19

const READERS = ['admin', 'auditor', 'hod', 'dean', 'deputy_dean'] as const satisfies readonly GlobalRole[]
const REPORTS = ['report_faculty_summary', 'report_departments', 'report_offerings', 'report_lecturers'] as const

type Semester = { id: string; code: string }
type Staff = { id: string; name: string; client: SupabaseClient }
type Offering = Awaited<ReturnType<typeof createOffering>>

async function createStaff(name: string, departmentId?: string): Promise<Staff> {
  const user = await createUser({ roles: ['lecturer'], fullName: name, departmentId })
  return { id: user.id, name, client: await signIn(user.email, user.password) }
}

function upload(client: SupabaseClient, slot: Slot | SharedSlot) {
  return uploadFile(client, slot, new File([sizedPdf(1024)], 'file.pdf', { type: 'application/pdf' }))
}

/** Uploads one file to each of sections 2, 6, 17, 18 and 19 of the offering, which every course file has on. */
function uploadPlainSections(client: SupabaseClient, offeringId: string) {
  return Promise.all([
    ...[TEACHING_PLAN, ATTENDANCE, WEEK_12_MARKS, GRADE_LIST].map((section) => upload(client, { offeringId, section })),
    upload(client, { offeringId, section: LO_PO_ANALYSIS, slot: 'po_achievement' }),
  ])
}

/** Adds a program code with the service role, and uploads its student timetable for the semester as the admin. */
async function programCodeWithTimetable(semester: Semester) {
  const { data, error } = await adminClient().from('program_codes').insert({ code: `1 BITS S1G1 ${randomUUID()}` }).select('id').single()
  if (error) throw error
  await upload(await signInAs('admin'), { semesterId: semester.id, section: STUDENT_TIMETABLE, programCodeId: data.id })
  return data.id as string
}

async function tick(client: SupabaseClient, offeringId: string, programCodeId: string) {
  const { error } = await client.rpc('tick_program_code', { offering_id: offeringId, program_code_id: programCodeId, ticked: true })
  if (error) throw error
}

async function switchSection(client: SupabaseClient, offeringId: string, section: number, isOn: boolean, reason?: string) {
  const { error } = await client.rpc('switch_section', { offering_id: offeringId, section, is_on: isOn, reason })
  if (error) throw error
}

async function mark(auditor: SupabaseClient, offeringId: string, sections: number[], verdict: 'verified' | 'needs_fix', comment?: string) {
  for (const section of sections) {
    const { error } = await auditor.rpc('record_verdict', { offering_id: offeringId, section, verdict, comment })
    if (error) throw error
  }
}

/** The report's rows as this client reads them, failing the test on an error. */
async function report(client: SupabaseClient, name: (typeof REPORTS)[number], semester: Semester) {
  const { data, error } = await client.rpc(name, { semester_id: semester.id })
  if (error) throw error
  return data as Record<string, unknown>[]
}

/** The latest upload time of the offering's own files, read back from the files table. */
async function lastOwnUpload(offeringId: string) {
  const { data, error } = await adminClient().from('files').select('uploaded_at').eq('offering_id', offeringId).order('uploaded_at', { ascending: false }).limit(1).single()
  if (error) throw error
  return data.uploaded_at as string
}

async function departmentCode(departmentId: string) {
  const { data, error } = await adminClient().from('departments').select('code').eq('id', departmentId).single()
  if (error) throw error
  return data.code as string
}

/**
 * The 19 statuses of a course file, in section order: the given statuses of some sections, off for
 * switchable sections not given, empty for sections 7 to 9 not given, and pending_review for the rest.
 */
function statuses(given: Record<number, string>) {
  return Array.from({ length: 19 }, (_, index) => {
    const section = index + 1
    return given[section] ?? (section >= 10 && section <= 16 ? 'off' : section >= 7 && section <= 9 ? 'empty' : 'pending_review')
  })
}

function byCourseCode<T extends { course_code: string }>(rows: T[]) {
  return rows.toSorted((a, b) => a.course_code.localeCompare(b.course_code))
}

/**
 * A semester of four offerings in two departments, in mixed states:
 *
 * - A (department 1): every section uploaded and Verified.
 * - B (department 1): sections 4, 5, 6, 10, 17, 18 and 19 missing, Teaching Plan Needs fix, a
 *   replacement notice uploaded, and switched-off Tutorial Verified.
 * - C (department 2): every section uploaded, Attendance Needs fix, and Lecture Notes switched off
 *   and marked Needs fix, which counts it again.
 * - D (department 2): every section uploaded, none judged but Warning Letters, Verified while empty.
 *
 * Aminah coordinates A, which Badrul also teaches. Badrul coordinates B, which Chong also teaches.
 * Chong has no timetable. Devi coordinates C and D.
 */
type Seeded = {
  semester: Semester
  departments: { id: string; code: string }[]
  staff: { aminah: Staff; badrul: Staff; chong: Staff; devi: Staff }
  offerings: { a: Offering; b: Offering; c: Offering; d: Offering }
}

let seeded: Seeded

beforeAll(async () => {
  const semester = await emptyReportSemester()
  const [admin, auditor, department1, department2] = await Promise.all([signInAs('admin'), signInAs('auditor'), createDepartment(), createDepartment()])
  const [aminah, badrul, chong, devi] = await Promise.all([
    createStaff('Aminah Report', department1),
    createStaff('Badrul Report', department1),
    createStaff('Chong Report'),
    createStaff('Devi Report', department2),
  ])
  const a = await createOffering({ coordinatorId: aminah.id, lecturerIds: [badrul.id], sectionsOn: [], semester, departmentId: department1 })
  const b = await createOffering({ coordinatorId: badrul.id, lecturerIds: [chong.id], sectionsOn: [LECTURE_NOTES], semester, departmentId: department1 })
  const c = await createOffering({ coordinatorId: devi.id, sectionsOn: [LECTURE_NOTES], semester, departmentId: department2 })
  const d = await createOffering({ coordinatorId: devi.id, sectionsOn: [], semester, departmentId: department2 })
  const programCodeId = await programCodeWithTimetable(semester)

  await Promise.all([
    uploadPlainSections(aminah.client, a.id),
    upload(badrul.client, { offeringId: b.id, section: TEACHING_PLAN }),
    upload(chong.client, { offeringId: b.id, section: REPLACEMENT_NOTICES }),
    uploadPlainSections(devi.client, c.id),
    upload(devi.client, { offeringId: c.id, section: LECTURE_NOTES }),
    uploadPlainSections(devi.client, d.id),
    ...[aminah, badrul, devi].map((staff) => upload(staff.client, { semesterId: semester.id, section: LECTURER_TIMETABLE })),
    tick(aminah.client, a.id, programCodeId),
    tick(devi.client, c.id, programCodeId),
    tick(devi.client, d.id, programCodeId),
  ])
  await switchSection(devi.client, c.id, LECTURE_NOTES, false, 'Notes are in the textbook')
  // The calendar and letter go last, so the course files link files newer than their own.
  await upload(admin, { semesterId: semester.id, section: CALENDAR })
  await upload(admin, { semesterId: semester.id, section: LETTER })

  await mark(auditor, a.id, [1, 2, 3, 4, 5, 6, 17, 18, 19], 'verified')
  await mark(auditor, b.id, [TEACHING_PLAN], 'needs_fix', 'Sign the plan.')
  await mark(auditor, b.id, [TUTORIAL], 'verified')
  await mark(auditor, c.id, [CALENDAR], 'verified')
  await mark(auditor, c.id, [ATTENDANCE], 'needs_fix', 'Weeks 10 to 14 are missing.')
  await mark(auditor, c.id, [LECTURE_NOTES], 'needs_fix', 'The course has lectures, so it needs notes.')
  await mark(auditor, d.id, [WARNING_LETTERS], 'verified')

  seeded = {
    semester,
    departments: await Promise.all([department1, department2].map(async (id) => ({ id, code: await departmentCode(id) }))),
    staff: { aminah, badrul, chong, devi },
    offerings: { a, b, c, d },
  }
}, 120_000)

/** The offering list and heatmap rows of the seeded semester, by course code. */
async function expectedOfferings() {
  const { departments, staff, offerings } = seeded
  const [department1, department2] = departments
  const row = (offering: Offering, department: { id: string; code: string }, coordinator: Staff) => ({
    offering_id: offering.id,
    course_code: offering.course.code,
    course_title: offering.course.title,
    department_id: department.id,
    department_code: department.code,
    department_name: 'Seam1 Department',
    coordinator_id: coordinator.id,
    coordinator_name: coordinator.name,
  })
  return byCourseCode([
    {
      ...row(offerings.a, department1, staff.aminah),
      status: 'verified',
      counted_sections: 9,
      uploaded_sections: 9,
      verified_sections: 9,
      needs_fix_sections: 0,
      percent_complete: 100,
      missing_sections: [],
      section_statuses: statuses({ 1: 'verified', 2: 'verified', 3: 'verified', 4: 'verified', 5: 'verified', 6: 'verified', 17: 'verified', 18: 'verified', 19: 'verified' }),
      last_upload_at: await lastOwnUpload(offerings.a.id),
    },
    {
      ...row(offerings.b, department1, staff.badrul),
      status: 'incomplete',
      counted_sections: 11,
      uploaded_sections: 4,
      verified_sections: 0,
      needs_fix_sections: 1,
      percent_complete: 36.4,
      missing_sections: [4, 5, 6, 10, 17, 18, 19],
      section_statuses: statuses({ 2: 'needs_fix', 4: 'missing', 5: 'missing', 6: 'missing', 7: 'pending_review', 10: 'missing', 12: 'verified', 17: 'missing', 18: 'missing', 19: 'missing' }),
      last_upload_at: await lastOwnUpload(offerings.b.id),
    },
    {
      ...row(offerings.c, department2, staff.devi),
      status: 'needs_fix',
      counted_sections: 10,
      uploaded_sections: 10,
      verified_sections: 1,
      needs_fix_sections: 2,
      percent_complete: 100,
      missing_sections: [],
      section_statuses: statuses({ 1: 'verified', 6: 'needs_fix', 10: 'needs_fix' }),
      last_upload_at: await lastOwnUpload(offerings.c.id),
    },
    {
      ...row(offerings.d, department2, staff.devi),
      status: 'pending_review',
      counted_sections: 10,
      uploaded_sections: 10,
      verified_sections: 1,
      needs_fix_sections: 0,
      percent_complete: 100,
      missing_sections: [],
      section_statuses: statuses({ 9: 'verified' }),
      last_upload_at: await lastOwnUpload(offerings.d.id),
    },
  ])
}

test('the offering list and heatmap give each offering its status, completeness, missing sections, section statuses and last upload', async () => {
  const auditor = await signInAs('auditor')
  const rows = await report(auditor, 'report_offerings', seeded.semester)
  expect(rows).toEqual(await expectedOfferings())

  // The heatmap shows the statuses that the course file page shows.
  for (const row of rows) {
    const { data, error } = await auditor.rpc('section_statuses', { offering_id: row.offering_id })
    if (error) throw error
    expect(row.section_statuses).toEqual(data.map((section: { status: string }) => section.status))
  }

  // The calendar and letter were uploaded after every course file's own files, and do not count.
  const { data: calendar, error } = await adminClient().from('files').select('uploaded_at').eq('semester_id', seeded.semester.id).eq('section', CALENDAR).single()
  if (error) throw error
  for (const row of rows) expect(Date.parse(row.last_upload_at as string)).toBeLessThan(Date.parse(calendar.uploaded_at))
})

test('the faculty summary pools the counted sections of every offering of the semester', async () => {
  expect(await report(await signInAs('auditor'), 'report_faculty_summary', seeded.semester)).toEqual([
    {
      offerings: 4,
      counted_sections: 40,
      uploaded_sections: 33,
      verified_sections: 11,
      needs_fix_sections: 3,
      percent_uploaded: 82.5,
      percent_verified: 27.5,
      percent_needs_fix: 7.5,
    },
  ])
})

test('the department breakdown gives the same numbers for each department, by department code', async () => {
  const [department1, department2] = seeded.departments
  const expected = [
    {
      department_id: department1.id,
      department_code: department1.code,
      department_name: 'Seam1 Department',
      offerings: 2,
      counted_sections: 20,
      uploaded_sections: 13,
      verified_sections: 9,
      needs_fix_sections: 1,
      percent_uploaded: 65,
      percent_verified: 45,
      percent_needs_fix: 5,
    },
    {
      department_id: department2.id,
      department_code: department2.code,
      department_name: 'Seam1 Department',
      offerings: 2,
      counted_sections: 20,
      uploaded_sections: 20,
      verified_sections: 2,
      needs_fix_sections: 2,
      percent_uploaded: 100,
      percent_verified: 10,
      percent_needs_fix: 10,
    },
  ].toSorted((a, b) => a.department_code.localeCompare(b.department_code))
  expect(await report(await signInAs('auditor'), 'report_departments', seeded.semester)).toEqual(expected)
})

/** The lecturer view rows of the seeded semester, by name, for the lecturers given. */
function expectedLecturers(names: (keyof Seeded['staff'])[] = ['aminah', 'badrul', 'chong', 'devi']) {
  const { departments, staff, offerings } = seeded
  const [department1, department2] = departments
  const taught = (offering: Offering, coordinator: boolean, missing: number[]) => ({
    offering_id: offering.id,
    course_code: offering.course.code,
    course_title: offering.course.title,
    coordinator,
    missing_sections: missing,
  })
  const department = (value: { id: string; code: string } | null) => ({
    department_id: value?.id ?? null,
    department_code: value?.code ?? null,
    department_name: value ? 'Seam1 Department' : null,
  })
  const rows = {
    aminah: { ...department(department1), timetable_missing: false, offerings: [taught(offerings.a, true, [])] },
    // Section 4 of B is missing for Chong's timetable, not Badrul's.
    badrul: {
      ...department(department1),
      timetable_missing: false,
      offerings: byCourseCode([taught(offerings.a, false, []), taught(offerings.b, true, [5, 6, 10, 17, 18, 19])]),
    },
    chong: { ...department(null), timetable_missing: true, offerings: [taught(offerings.b, false, [4, 5, 6, 10, 17, 18, 19])] },
    devi: {
      ...department(department2),
      timetable_missing: false,
      offerings: byCourseCode([taught(offerings.c, true, []), taught(offerings.d, true, [])]),
    },
  }
  return names.map((name) => ({ lecturer_id: staff[name].id, lecturer_name: staff[name].name, ...rows[name] }))
}

test('the lecturer view lists each lecturer with their offerings and the missing sections linked to them', async () => {
  expect(await report(await signInAs('auditor'), 'report_lecturers', seeded.semester)).toEqual(expectedLecturers())
})

test('management, auditors and the admin read every offering of the semester', async () => {
  const expected = await expectedOfferings()
  const expectedLecturerRows = expectedLecturers()
  for (const role of READERS) {
    const client = await signInAs(role)
    expect(await report(client, 'report_offerings', seeded.semester)).toEqual(expected)
    expect(await report(client, 'report_faculty_summary', seeded.semester)).toMatchObject([{ offerings: 4, counted_sections: 40 }])
    expect(await report(client, 'report_departments', seeded.semester)).toHaveLength(2)
    expect(await report(client, 'report_lecturers', seeded.semester)).toEqual(expectedLecturerRows)
  }
})

test('lecturers and coordinators read the reports of the offerings they teach only', async () => {
  const { semester, staff, offerings } = seeded
  const all = await expectedOfferings()
  const badrul = staff.badrul.client

  expect(await report(badrul, 'report_offerings', semester)).toEqual(all.filter((row) => [offerings.a.id, offerings.b.id].includes(row.offering_id)))
  expect(await report(badrul, 'report_faculty_summary', semester)).toEqual([
    {
      offerings: 2,
      counted_sections: 20,
      uploaded_sections: 13,
      verified_sections: 9,
      needs_fix_sections: 1,
      percent_uploaded: 65,
      percent_verified: 45,
      percent_needs_fix: 5,
    },
  ])
  expect((await report(badrul, 'report_departments', semester)).map((row) => row.department_id)).toEqual([seeded.departments[0].id])
  expect(await report(badrul, 'report_lecturers', semester)).toEqual(expectedLecturers(['aminah', 'badrul', 'chong']))

  expect(await report(staff.devi.client, 'report_offerings', semester)).toEqual(all.filter((row) => [offerings.c.id, offerings.d.id].includes(row.offering_id)))

  // A lecturer who teaches only in another semester reads nothing of this one.
  const outsider = await createStaff('Outsider Report')
  await createOffering({ coordinatorId: outsider.id, semester: await pickSemester() })
  for (const name of ['report_offerings', 'report_departments', 'report_lecturers'] as const) {
    expect(await report(outsider.client, name, semester)).toEqual([])
  }
  expect(await report(outsider.client, 'report_faculty_summary', semester)).toEqual([
    {
      offerings: 0,
      counted_sections: 0,
      uploaded_sections: 0,
      verified_sections: 0,
      needs_fix_sections: 0,
      percent_uploaded: null,
      percent_verified: null,
      percent_needs_fix: null,
    },
  ])
})

test('root, signed-out visitors and direct calls to the helpers get no reports', async () => {
  const root = await signInAs('root')
  for (const name of REPORTS) {
    const { data, error } = await root.rpc(name, { semester_id: seeded.semester.id })
    expect(error?.code).toBe(PERMISSION_DENIED)
    expect(data).toBeNull()
    expect((await anonClient().rpc(name, { semester_id: seeded.semester.id })).error?.code).toBe(PERMISSION_DENIED)
  }

  const auditor = await signInAs('auditor')
  expect((await auditor.rpc('report_offering_ids', { semester_id: seeded.semester.id })).error?.code).toBe(PERMISSION_DENIED)
  expect((await auditor.rpc('section_statuses_of', { offering_ids: [seeded.offerings.a.id] })).error?.code).toBe(PERMISSION_DENIED)
})

test('an offering is complete when every section that is on has a file, with sections 7 to 9 never missing, every lecturer timetable, and a ticked program code', async () => {
  const semester = await emptyReportSemester()
  const [admin, coordinator, lecturer] = await Promise.all([signInAs('admin'), createStaff('Coordinator Report'), createStaff('Lecturer Report')])
  const offering = await createOffering({ coordinatorId: coordinator.id, lecturerIds: [lecturer.id], sectionsOn: [LECTURE_NOTES], semester })
  const completeness = async () => {
    const [row] = await report(coordinator.client, 'report_offerings', semester)
    return {
      status: row.status,
      counted: row.counted_sections,
      uploaded: row.uploaded_sections,
      percent: row.percent_complete,
      missing: row.missing_sections,
    }
  }

  // Sections 7 to 9 are empty and neither count nor go missing. Lecture Notes is on, so it counts.
  expect(await completeness()).toEqual({ status: 'incomplete', counted: 10, uploaded: 0, percent: 0, missing: [1, 2, 3, 4, 5, 6, 10, 17, 18, 19] })

  await Promise.all([
    upload(admin, { semesterId: semester.id, section: CALENDAR }),
    upload(admin, { semesterId: semester.id, section: LETTER }),
    uploadPlainSections(coordinator.client, offering.id),
    upload(coordinator.client, { offeringId: offering.id, section: LECTURE_NOTES }),
    upload(coordinator.client, { semesterId: semester.id, section: LECTURER_TIMETABLE }),
  ])
  // Section 4 waits for the lecturer's timetable, and section 5 for a ticked program code.
  expect(await completeness()).toEqual({ status: 'incomplete', counted: 10, uploaded: 8, percent: 80, missing: [4, 5] })

  await upload(lecturer.client, { semesterId: semester.id, section: LECTURER_TIMETABLE })
  expect(await completeness()).toEqual({ status: 'incomplete', counted: 10, uploaded: 9, percent: 90, missing: [5] })

  await tick(lecturer.client, offering.id, await programCodeWithTimetable(semester))
  expect(await completeness()).toEqual({ status: 'pending_review', counted: 10, uploaded: 10, percent: 100, missing: [] })

  // A file in section 7 makes it count, as uploaded.
  await upload(lecturer.client, { offeringId: offering.id, section: REPLACEMENT_NOTICES })
  expect(await completeness()).toEqual({ status: 'pending_review', counted: 11, uploaded: 11, percent: 100, missing: [] })

  // A section switched on needs a file, and a switched-off one leaves the count.
  await switchSection(lecturer.client, offering.id, LAB_EXERCISES, true, 'Labs run this semester')
  expect(await completeness()).toEqual({ status: 'incomplete', counted: 12, uploaded: 11, percent: 91.7, missing: [LAB_EXERCISES] })
  await switchSection(lecturer.client, offering.id, LAB_EXERCISES, false)
  await switchSection(lecturer.client, offering.id, LECTURE_NOTES, false, 'Notes are in the textbook')
  expect(await completeness()).toEqual({ status: 'pending_review', counted: 10, uploaded: 10, percent: 100, missing: [] })
})

test('the app reads every offering of a semester with more than the 1,000 rows the API returns at once', async () => {
  const semester = await emptyReportSemester()
  const service = adminClient()
  const [coordinator, departmentId] = await Promise.all([createStaff('Coordinator Many'), createDepartment()])
  const courseType = await service.from('course_types').insert({ name: `Type-${randomUUID()}`, sections_on: [] }).select('id').single()
  if (courseType.error) throw courseType.error
  const total = 1_001
  const prefix = `MANY-${randomUUID()}`
  const courses = await service
    .from('courses')
    .insert(
      Array.from({ length: total }, (_, index) => ({
        code: `${prefix}-${String(index).padStart(4, '0')}`,
        title: 'Seam1 Course',
        department_id: departmentId,
        course_type_id: courseType.data.id,
      })),
    )
    .select('id, code')
  if (courses.error) throw courses.error
  // create_offering adds an offering and its coordinator in one transaction, so offer them in batches.
  for (let start = 0; start < total; start += 50) {
    await Promise.all(
      courses.data.slice(start, start + 50).map(async (course) => {
        const { error } = await service.rpc('create_offering', {
          semester_id: semester.id,
          course_id: course.id,
          coordinator_id: coordinator.id,
          lecturer_ids: [],
        })
        if (error) throw error
      }),
    )
  }
  const codes = courses.data.map((course) => course.code).toSorted()

  // The offering list, the heatmap and My completeness read report_offerings.
  for (const client of [await signInAs('dean'), coordinator.client]) {
    const rows = await fetchReport<OfferingRow>(client, 'report_offerings', semester.id)
    expect(rows.map((row) => row.course_code)).toEqual(codes)
  }
  const dean = await signInAs('dean')
  expect(await fetchReport(dean, 'report_faculty_summary', semester.id)).toMatchObject([{ offerings: total }])
  expect(await fetchReport(dean, 'report_departments', semester.id)).toMatchObject([{ department_id: departmentId, offerings: total }])
  const [lecturer] = await fetchReport<LecturerRow>(dean, 'report_lecturers', semester.id)
  expect(lecturer.offerings.map((offering) => offering.course_code)).toEqual(codes)
}, 120_000)
