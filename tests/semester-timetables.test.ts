import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { sizedPdf } from '../src/pdf/fixtures.ts'
import { uploadFile } from '../src/uploads.ts'
import { adminClient, createOffering, createUser, pickSemester, signIn, signInAs } from './harness.ts'

// The semester page lists what each semester still lacks: every program code with its student
// timetable or Missing, and every lecturer who teaches in the semester with their timetable or
// Missing. Each test reads only the codes and lecturers it made, so other tests' rows don't matter.

const LECTURER_TIMETABLE = 4
const STUDENT_TIMETABLE = 5

type Semester = { id: string; code: string }
type Staff = { id: string; fullName: string; client: SupabaseClient }

/** A shared file as the lists give it. */
type ListedFile = {
  id: string
  section: number
  name: string
  uploaded_at: string
  uploader_name: string
  deletable: boolean
  linked_offerings: { id: string; course: { code: string; title: string } }[]
}

let admin: SupabaseClient

beforeAll(async () => {
  admin = await signInAs('admin')
})

async function createStaff(): Promise<Staff> {
  const fullName = `Lecturer ${randomUUID()}`
  const user = await createUser({ roles: ['lecturer'], fullName })
  return { id: user.id, fullName, client: await signIn(user.email, user.password) }
}

async function createProgramCode() {
  const { data, error } = await adminClient().from('program_codes').insert({ code: `1 BITS S1G1 ${randomUUID()}` }).select('id, code').single()
  if (error) throw error
  return data as { id: string; code: string }
}

async function twoSemesters(): Promise<[Semester, Semester]> {
  const first = await pickSemester()
  let second = await pickSemester()
  while (second.id === first.id) second = await pickSemester()
  return [first, second]
}

function pdf(name: string) {
  return new File([sizedPdf(1024)], name, { type: 'application/pdf' })
}

async function studentTimetables(client: SupabaseClient, semester: Semester, programCodeIds: string[]) {
  const { data, error } = await client
    .rpc('semester_student_timetables', { semester_id: semester.id })
    .in('program_code_id', programCodeIds)
    .order('missing', { ascending: false })
    .order('code')
  if (error) throw error
  return data as { program_code_id: string; code: string; missing: boolean; file: ListedFile | null }[]
}

async function lecturerTimetables(client: SupabaseClient, semester: Semester, lecturerIds: string[]) {
  const { data, error } = await client
    .rpc('semester_lecturer_timetables', { semester_id: semester.id })
    .in('lecturer_id', lecturerIds)
    .order('missing', { ascending: false })
    .order('full_name')
  if (error) throw error
  return data as {
    lecturer_id: string
    display_name: string
    email: string
    active: boolean
    courses: string[]
    missing: boolean
    file: ListedFile | null
  }[]
}

test('the student timetable list holds every program code, with its timetable for the semester and the course files that link it, or Missing', async () => {
  const [semester, otherSemester] = await twoSemesters()
  const [withTimetable, withoutTimetable] = [await createProgramCode(), await createProgramCode()]
  const timetable = await uploadFile(admin, { semesterId: semester.id, section: STUDENT_TIMETABLE, programCodeId: withTimetable.id }, pdf('s1g1.pdf'))
  // A timetable for another semester leaves the code Missing in this one.
  await uploadFile(admin, { semesterId: otherSemester.id, section: STUDENT_TIMETABLE, programCodeId: withoutTimetable.id }, pdf('other.pdf'))
  const coordinator = await createStaff()
  const offering = await createOffering({ coordinatorId: coordinator.id, semester })
  const ticked = await coordinator.client.rpc('tick_program_code', { offering_id: offering.id, program_code_id: withTimetable.id, ticked: true })
  expect(ticked.error).toBeNull()

  const rows = await studentTimetables(admin, semester, [withTimetable.id, withoutTimetable.id])

  expect(rows).toEqual([
    { program_code_id: withoutTimetable.id, code: withoutTimetable.code, missing: true, file: null },
    {
      program_code_id: withTimetable.id,
      code: withTimetable.code,
      missing: false,
      file: {
        id: timetable.id,
        section: STUDENT_TIMETABLE,
        name: 's1g1.pdf',
        uploaded_at: expect.any(String),
        uploader_name: 'Seam1 admin',
        deletable: true,
        linked_offerings: [{ id: offering.id, course: { code: offering.course.code, title: offering.course.title } }],
      },
    },
  ])
  expect(new Date(rows[1].file!.uploaded_at).toISOString()).toBe(new Date(timetable.uploaded_at).toISOString())
})

test('the lecturer timetable list holds every lecturer who teaches in the semester, with their timetable or Missing, and each timetable whose lecturer no longer teaches there', async () => {
  const semester = await pickSemester()
  const [ready, notReady, gone] = [await createStaff(), await createStaff(), await createStaff()]
  const offering = await createOffering({ coordinatorId: ready.id, lecturerIds: [notReady.id, gone.id], semester })
  const otherOffering = await createOffering({ coordinatorId: ready.id, semester })
  const timetable = await uploadFile(ready.client, { semesterId: semester.id, section: LECTURER_TIMETABLE }, pdf('ready.pdf'))
  const goneTimetable = await uploadFile(gone.client, { semesterId: semester.id, section: LECTURER_TIMETABLE }, pdf('gone.pdf'))
  const unassigned = await admin.rpc('set_offering_lecturers', { offering_id: offering.id, coordinator_id: ready.id, lecturer_ids: [notReady.id] })
  expect(unassigned.error).toBeNull()
  const deactivated = await adminClient().from('profiles').update({ active: false }).eq('id', notReady.id)
  expect(deactivated.error).toBeNull()

  const rows = await lecturerTimetables(admin, semester, [ready.id, notReady.id, gone.id])

  expect(rows.map(({ lecturer_id, display_name, active, courses, missing }) => ({ lecturer_id, display_name, active, courses, missing }))).toEqual([
    { lecturer_id: notReady.id, display_name: notReady.fullName, active: false, courses: [offering.course.code], missing: true },
    ...[
      { lecturer_id: gone.id, display_name: gone.fullName, active: true, courses: [], missing: false },
      { lecturer_id: ready.id, display_name: ready.fullName, active: true, courses: [offering.course.code, otherOffering.course.code].toSorted(), missing: false },
    ].toSorted((a, b) => a.display_name.localeCompare(b.display_name)),
  ])
  const byLecturer = new Map(rows.map((row) => [row.lecturer_id, row]))
  expect(byLecturer.get(notReady.id)!.file).toBeNull()
  expect(byLecturer.get(ready.id)!.file).toMatchObject({ id: timetable.id, name: 'ready.pdf', deletable: false })
  expect(byLecturer.get(gone.id)!.file).toMatchObject({ id: goneTimetable.id, name: 'gone.pdf', deletable: true, linked_offerings: [] })
})

test.each(['lecturer', 'auditor', 'hod', 'dean', 'deputy_dean'] as const)('the lists are the admin\'s, so the %s user reads no rows', async (role) => {
  const client = await signInAs(role)
  const semester = await pickSemester()
  const programCode = await createProgramCode()
  const lecturer = await createStaff()
  await createOffering({ coordinatorId: lecturer.id, semester })

  expect(await studentTimetables(client, semester, [programCode.id])).toEqual([])
  expect(await lecturerTimetables(client, semester, [lecturer.id])).toEqual([])
})
