// Seam 1: the file-url action of the files function, which gives a reader a short-lived URL that
// opens one file. Readers of a course file open its files and the shared files it links. Staff open
// a past offering's file from the place they would reuse it into. Everyone else is refused.
import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { numberedPdf } from '../src/pdf/fixtures.ts'
import { deleteFile, FileActionError, fileUrl, uploadFile, type FileRecord, type SharedSlot, type Slot } from '../src/uploads.ts'
import { adminClient, createOffering, createUser, pickSemester, signIn, signInAs } from './harness.ts'

const TEACHING_PLAN = 2
const LECTURER_TIMETABLE = 4
const STUDENT_TIMETABLE = 5
const LAB_EXERCISES = 11

type Staff = { id: string; client: SupabaseClient }

async function createStaff(): Promise<Staff> {
  const user = await createUser({ roles: ['lecturer'] })
  return { id: user.id, client: await signIn(user.email, user.password) }
}

/** count different semesters from pickSemester, earliest first. */
async function semestersInOrder(count: number) {
  const picked = new Map<string, { id: string; code: string; start_year: number; number: number }>()
  while (picked.size < count) {
    const semester = await pickSemester()
    picked.set(semester.id, semester)
  }
  return [...picked.values()].toSorted((a, b) => a.start_year - b.start_year || a.number - b.number)
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Uploads a one-page PDF to the place as this client, and returns the record and the hash of its bytes. */
async function upload(client: SupabaseClient, slot: Slot | SharedSlot, name: string): Promise<FileRecord & { sha: string }> {
  const bytes = await numberedPdf(1, { label: name })
  const file = await uploadFile(client, slot, new File([bytes], name, { type: 'application/pdf' }))
  return { ...file, sha: sha256(bytes) }
}

/** What opening the file gives this client: its name and the hash of the bytes its URL gets, or the refusal. */
async function open(client: SupabaseClient, fileId: string, reuseInto?: Slot) {
  try {
    const { name, url } = await fileUrl(client, fileId, reuseInto)
    const response = await fetch(url)
    return { name, status: response.status, sha: sha256(new Uint8Array(await response.arrayBuffer())) }
  } catch (error) {
    if (error instanceof FileActionError) return { refused: error.status, code: error.code }
    throw error
  }
}

/**
 * An offering coordinated by one lecturer and taught by another, its semester's student timetable
 * for a new program code that it ticks, each lecturer's timetable, a lecturer who teaches only
 * another offering in the same semester, and a teaching plan the coordinator uploaded.
 */
let course: Awaited<ReturnType<typeof createCourse>>

async function createCourse() {
  const [coordinator, lecturer, neighbour] = await Promise.all([createStaff(), createStaff(), createStaff()])
  const semester = await pickSemester()
  const offering = await createOffering({ coordinatorId: coordinator.id, lecturerIds: [lecturer.id], sectionsOn: [LAB_EXERCISES], semester })
  await createOffering({ coordinatorId: neighbour.id, semester })
  const { data: programCode, error } = await adminClient().from('program_codes').insert({ code: `FU-${randomUUID()}` }).select('id').single()
  if (error) throw error
  const studentTimetable = await upload(await signInAs('admin'), { semesterId: semester.id, section: STUDENT_TIMETABLE, programCodeId: programCode.id }, 'students.pdf')
  const ticked = await coordinator.client.rpc('tick_program_code', { offering_id: offering.id, program_code_id: programCode.id, ticked: true })
  if (ticked.error) throw ticked.error
  const shared = { semesterId: semester.id, section: LECTURER_TIMETABLE }
  return {
    offering,
    semester,
    coordinator,
    lecturer,
    neighbour,
    plan: await upload(coordinator.client, { offeringId: offering.id, section: TEACHING_PLAN }, 'plan.pdf'),
    coordinatorTimetable: await upload(coordinator.client, shared, 'coordinator timetable.pdf'),
    neighbourTimetable: await upload(neighbour.client, shared, 'neighbour timetable.pdf'),
    studentTimetable,
  }
}

beforeAll(async () => {
  course = await createCourse()
})

test('everyone who reads a course file opens its files and gets their bytes, and other lecturers and root are refused', async () => {
  const { plan, coordinator, lecturer, neighbour } = course
  const managers = await Promise.all((['admin', 'auditor', 'hod', 'dean', 'deputy_dean'] as const).map(signInAs))

  for (const reader of [coordinator.client, lecturer.client, ...managers]) {
    expect(await open(reader, plan.id)).toEqual({ name: 'plan.pdf', status: 200, sha: plan.sha })
  }
  for (const other of [neighbour.client, await signInAs('root')]) {
    expect(await open(other, plan.id)).toEqual({ refused: 404, code: 'not_found' })
  }
})

test('a lecturer timetable opens for the lecturers who teach with its lecturer, and a student timetable for those who teach in its semester', async () => {
  const { coordinatorTimetable, neighbourTimetable, studentTimetable, lecturer, neighbour } = course

  expect(await open(lecturer.client, coordinatorTimetable.id)).toMatchObject({ status: 200, sha: coordinatorTimetable.sha })
  expect(await open(neighbour.client, coordinatorTimetable.id)).toEqual({ refused: 404, code: 'not_found' })
  expect(await open(lecturer.client, neighbourTimetable.id)).toEqual({ refused: 404, code: 'not_found' })
  for (const reader of [lecturer.client, neighbour.client]) {
    expect(await open(reader, studentTimetable.id)).toMatchObject({ name: 'students.pdf', status: 200, sha: studentTimetable.sha })
  }
  const outsider = await createStaff()
  expect(await open(outsider.client, studentTimetable.id)).toEqual({ refused: 404, code: 'not_found' })
})

test('staff open a past offering\'s file from the place they would reuse it into, and no one opens other files that way', async () => {
  const [earlier, later] = await semestersInOrder(2)
  const [past, current] = await Promise.all([createStaff(), createStaff()])
  const offering = await createOffering({ coordinatorId: current.id, sectionsOn: [LAB_EXERCISES], semester: later })
  const { data: pastId, error } = await adminClient().rpc('create_offering', {
    semester_id: earlier.id,
    course_id: offering.course.id,
    coordinator_id: past.id,
    lecturer_ids: [],
  })
  if (error) throw error
  const otherCourse = await createOffering({ coordinatorId: past.id, sectionsOn: [LAB_EXERCISES], semester: earlier })
  for (const [staff, id] of [[past, pastId], [past, otherCourse.id], [current, offering.id]] as const) {
    const added = await staff.client.rpc('add_item', { offering_id: id, section: LAB_EXERCISES })
    if (added.error) throw added.error
  }
  const labSheet = { section: LAB_EXERCISES, item: 1, slot: 'lab_sheet' }
  const pastSheet = await upload(past.client, { offeringId: pastId, ...labSheet }, 'past sheet.pdf')
  const otherSheet = await upload(past.client, { offeringId: otherCourse.id, ...labSheet }, 'other sheet.pdf')
  const place = { offeringId: offering.id, ...labSheet }

  expect(await open(current.client, pastSheet.id)).toEqual({ refused: 404, code: 'not_found' })
  expect(await open(current.client, pastSheet.id, place)).toEqual({ name: 'past sheet.pdf', status: 200, sha: pastSheet.sha })
  expect(await open(current.client, otherSheet.id, place)).toEqual({ refused: 404, code: 'not_found' })
  expect(await open(course.neighbour.client, pastSheet.id, place)).toEqual({ refused: 403, code: 'forbidden' })
})

test('a deleted file no longer opens, and its earlier URL gets nothing', async () => {
  const { offering, coordinator } = course
  const file = await upload(coordinator.client, { offeringId: offering.id, section: TEACHING_PLAN }, 'gone.pdf')
  const { url } = await fileUrl(coordinator.client, file.id)
  await deleteFile(coordinator.client, file.id)

  expect(await open(coordinator.client, file.id)).toEqual({ refused: 404, code: 'not_found' })
  const response = await fetch(url)
  expect(response.status).toBe(404)
  await response.body?.cancel()
})
