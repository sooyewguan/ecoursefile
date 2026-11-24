import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { sizedPdf } from '../src/pdf/fixtures.ts'
import { deleteFile, uploadFile } from '../src/uploads.ts'
import { adminClient, createDepartment, createUser, pickSemester, signIn, signInAs, userIdOf } from './harness.ts'

const RLS_VIOLATION = '42501'
const UNIQUE_VIOLATION = '23505'
const CHECK_VIOLATION = '23514'
const NOT_NULL_VIOLATION = '23502'
const FOREIGN_KEY_VIOLATION = '23503'

/** The roles that read every offering. */
const READ_EVERY_OFFERING = ['admin', 'auditor', 'hod', 'dean', 'deputy_dean'] as const

/** Every role except admin. None of them may set up semesters or offerings. */
const NOT_ADMIN = ['lecturer', 'auditor', 'hod', 'dean', 'deputy_dean', 'root'] as const

let admin: SupabaseClient
let departmentId: string

beforeAll(async () => {
  admin = await signInAs('admin')
  departmentId = await createDepartment()
})

function unique(label: string) {
  return `${label}-${crypto.randomUUID()}`
}

async function createCourseType(sectionsOn: number[]) {
  const { data, error } = await adminClient()
    .from('course_types')
    .insert({ name: unique('Type'), sections_on: sectionsOn })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

async function createCourse(courseTypeId: string) {
  const { data, error } = await adminClient()
    .from('courses')
    .insert({ code: unique('BITP'), title: 'Seam1 Course', department_id: departmentId, course_type_id: courseTypeId })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

async function createLecturer() {
  return createUser({ roles: ['lecturer'] })
}

/** Offers a course in a semester as the admin, the way the semester page does. */
async function offer(options: {
  semesterId?: string
  courseId?: string
  coordinatorId: string
  lecturerIds?: string[]
}) {
  const { data, error } = await admin.rpc('create_offering', {
    semester_id: options.semesterId ?? (await pickSemester()).id,
    course_id: options.courseId ?? (await createCourse(await createCourseType([10, 12]))),
    coordinator_id: options.coordinatorId,
    lecturer_ids: options.lecturerIds ?? [],
  })
  if (error) throw error
  return data as string
}

/** The offering's coordinator and its lecturers, sorted, as the service role reads them. */
async function staffOf(offeringId: string) {
  const service = adminClient()
  const [offering, lecturers] = await Promise.all([
    service.from('offerings').select('coordinator_id').eq('id', offeringId).single(),
    service.from('offering_lecturers').select('lecturer_id').eq('offering_id', offeringId),
  ])
  if (offering.error) throw offering.error
  if (lecturers.error) throw lecturers.error
  return {
    coordinator: offering.data.coordinator_id as string,
    lecturers: lecturers.data.map((row: { lecturer_id: string }) => row.lecturer_id).toSorted(),
  }
}

test.each([1, 2, 3])('the code of semester %i is the start year, the next year and the number', async (number) => {
  const semester = await pickSemester(admin, number)

  expect(semester.code).toBe(`${semester.start_year}/${semester.start_year + 1}-${number}`)
})

test('semester codes are unique', async () => {
  const semester = await pickSemester()

  const { error } = await admin.from('semesters').insert({ start_year: semester.start_year, number: semester.number })

  expect(error?.code).toBe(UNIQUE_VIOLATION)
})

test.each([0, 4])('there is no semester %i', async (number) => {
  const { error } = await admin.from('semesters').insert({ start_year: 2026, number })

  expect(error?.code).toBe(CHECK_VIOLATION)
})

test.each(NOT_ADMIN)('the %s user cannot add a semester', async (role) => {
  const client = await signInAs(role)

  const { error } = await client.from('semesters').insert({ start_year: 2026, number: 1 })

  expect(error?.code).toBe(RLS_VIOLATION)
})

test.each(['admin', 'lecturer', 'auditor', 'hod', 'dean', 'deputy_dean'] as const)('the %s user reads semesters', async (role) => {
  const client = await signInAs(role)
  const semester = await pickSemester()

  const { data } = await client.from('semesters').select('id, code').eq('id', semester.id)

  expect(data).toEqual([{ id: semester.id, code: semester.code }])
})

test('root reads no semesters', async () => {
  const root = await signInAs('root')
  await pickSemester()

  const { data, error } = await root.from('semesters').select('id')

  expect(error).toBeNull()
  expect(data).toEqual([])
})

test('the coordinator counts as a lecturer of the offering', async () => {
  const [coordinator, lecturer] = [await createLecturer(), await createLecturer()]

  const offeringId = await offer({ coordinatorId: coordinator.id, lecturerIds: [lecturer.id] })

  expect(await staffOf(offeringId)).toEqual({
    coordinator: coordinator.id,
    lecturers: [coordinator.id, lecturer.id].toSorted(),
  })
})

test('the admin changes the coordinator and the lecturers, and the coordinator stays a lecturer', async () => {
  const [first, second, third] = [await createLecturer(), await createLecturer(), await createLecturer()]
  const offeringId = await offer({ coordinatorId: first.id, lecturerIds: [second.id] })

  const swapped = await admin.rpc('set_offering_lecturers', {
    offering_id: offeringId,
    coordinator_id: second.id,
    lecturer_ids: [first.id, third.id],
  })
  expect(swapped.error).toBeNull()
  expect(await staffOf(offeringId)).toEqual({
    coordinator: second.id,
    lecturers: [first.id, second.id, third.id].toSorted(),
  })

  const trimmed = await admin.rpc('set_offering_lecturers', { offering_id: offeringId, coordinator_id: third.id, lecturer_ids: [] })
  expect(trimmed.error).toBeNull()
  expect(await staffOf(offeringId)).toEqual({ coordinator: third.id, lecturers: [third.id] })
})

test('an offering cannot be without a coordinator, or have a coordinator who is not its lecturer', async () => {
  const [coordinator, lecturer] = [await createLecturer(), await createLecturer()]
  const semester = await pickSemester()
  const courseId = await createCourse(await createCourseType([]))

  const withoutCoordinator = await admin.from('offerings').insert({ semester_id: semester.id, course_id: courseId })
  expect(withoutCoordinator.error?.code).toBe(NOT_NULL_VIOLATION)
  const withoutLecturerRow = await admin
    .from('offerings')
    .insert({ semester_id: semester.id, course_id: courseId, coordinator_id: coordinator.id })
  expect(withoutLecturerRow.error?.code).toBe(FOREIGN_KEY_VIOLATION)
  expect((await adminClient().from('offerings').select('id').eq('course_id', courseId)).data).toEqual([])

  const offeringId = await offer({ semesterId: semester.id, courseId, coordinatorId: coordinator.id, lecturerIds: [lecturer.id] })

  const removed = await admin.from('offering_lecturers').delete().eq('offering_id', offeringId).eq('lecturer_id', coordinator.id)
  expect(removed.error?.code).toBe(FOREIGN_KEY_VIOLATION)
  const outsider = await admin.from('offerings').update({ coordinator_id: (await createLecturer()).id }).eq('id', offeringId)
  expect(outsider.error?.code).toBe(FOREIGN_KEY_VIOLATION)
  expect(await staffOf(offeringId)).toEqual({
    coordinator: coordinator.id,
    lecturers: [coordinator.id, lecturer.id].toSorted(),
  })
})

test('a course is offered at most once per semester', async () => {
  const lecturer = await createLecturer()
  const semester = await pickSemester()
  const courseId = await createCourse(await createCourseType([10]))
  await offer({ semesterId: semester.id, courseId, coordinatorId: lecturer.id })

  const { error } = await admin.rpc('create_offering', {
    semester_id: semester.id,
    course_id: courseId,
    coordinator_id: lecturer.id,
    lecturer_ids: [],
  })

  expect(error?.code).toBe(UNIQUE_VIOLATION)
})

test.each(['auditor', 'root'] as const)('the %s user, who has no lecturer role, cannot teach an offering', async (role) => {
  const nonLecturer = { id: await userIdOf(await signInAs(role)) }
  const lecturer = await createLecturer()
  const semester = await pickSemester()
  const courseId = await createCourse(await createCourseType([10]))

  const asCoordinator = await admin.rpc('create_offering', {
    semester_id: semester.id,
    course_id: courseId,
    coordinator_id: nonLecturer.id,
    lecturer_ids: [],
  })
  expect(asCoordinator.error?.code).toBe(RLS_VIOLATION)
  expect((await adminClient().from('offerings').select('id').eq('course_id', courseId)).data).toEqual([])

  const offeringId = await offer({ semesterId: semester.id, courseId, coordinatorId: lecturer.id })
  const asLecturer = await admin.rpc('set_offering_lecturers', {
    offering_id: offeringId,
    coordinator_id: lecturer.id,
    lecturer_ids: [nonLecturer.id],
  })
  expect(asLecturer.error?.code).toBe(RLS_VIOLATION)
  expect(await staffOf(offeringId)).toEqual({ coordinator: lecturer.id, lecturers: [lecturer.id] })
})

test.each(NOT_ADMIN)('the %s user cannot offer a course or assign its lecturers', async (role) => {
  const client = await signInAs(role)
  const [coordinator, lecturer] = [await createLecturer(), await createLecturer()]
  const semester = await pickSemester()
  const courseId = await createCourse(await createCourseType([10]))

  const created = await client.rpc('create_offering', {
    semester_id: semester.id,
    course_id: courseId,
    coordinator_id: coordinator.id,
    lecturer_ids: [],
  })
  expect(created.error?.code).toBe(RLS_VIOLATION)
  expect((await adminClient().from('offerings').select('id').eq('course_id', courseId)).data).toEqual([])

  const offeringId = await offer({ semesterId: semester.id, courseId, coordinatorId: coordinator.id })
  const assigned = await client.rpc('set_offering_lecturers', {
    offering_id: offeringId,
    coordinator_id: lecturer.id,
    lecturer_ids: [coordinator.id],
  })
  expect(assigned.error?.code).toBe(RLS_VIOLATION)
  await client.from('offering_lecturers').delete().eq('offering_id', offeringId)
  expect(await staffOf(offeringId)).toEqual({ coordinator: coordinator.id, lecturers: [coordinator.id] })
})

test('an offering copies its toggles from the course type when it is created, and keeps them', async () => {
  const lecturer = await createLecturer()
  const courseTypeId = await createCourseType([10, 12])
  const courseId = await createCourse(courseTypeId)
  const offeringId = await offer({ courseId, coordinatorId: lecturer.id })

  const sectionsOn = async (id: string) =>
    (await admin.from('offerings').select('sections_on').eq('id', id).single()).data?.sections_on

  expect(await sectionsOn(offeringId)).toEqual([10, 12])

  expect((await admin.from('course_types').update({ sections_on: [11, 13] }).eq('id', courseTypeId)).error).toBeNull()
  expect(await sectionsOn(offeringId)).toEqual([10, 12])

  const otherTypeId = await createCourseType([14, 15, 16])
  expect((await admin.from('courses').update({ course_type_id: otherTypeId }).eq('id', courseId)).error).toBeNull()
  expect(await sectionsOn(offeringId)).toEqual([10, 12])

  const laterOfferingId = await offer({ courseId, coordinatorId: lecturer.id })
  expect(await sectionsOn(laterOfferingId)).toEqual([14, 15, 16])
})

/** The 19 sections of a new course file whose course type has sections 10 and 12 on. Switched-off sections do not count toward completeness. */
const NEW_COURSE_FILE = [
  { section: 1, status: 'missing', counts_toward_completeness: true },
  { section: 2, status: 'missing', counts_toward_completeness: true },
  { section: 3, status: 'missing', counts_toward_completeness: true },
  { section: 4, status: 'missing', counts_toward_completeness: true },
  { section: 5, status: 'missing', counts_toward_completeness: true },
  { section: 6, status: 'missing', counts_toward_completeness: true },
  { section: 7, status: 'empty', counts_toward_completeness: true },
  { section: 8, status: 'empty', counts_toward_completeness: true },
  { section: 9, status: 'empty', counts_toward_completeness: true },
  { section: 10, status: 'missing', counts_toward_completeness: true },
  { section: 11, status: 'off', counts_toward_completeness: false },
  { section: 12, status: 'missing', counts_toward_completeness: true },
  { section: 13, status: 'off', counts_toward_completeness: false },
  { section: 14, status: 'off', counts_toward_completeness: false },
  { section: 15, status: 'off', counts_toward_completeness: false },
  { section: 16, status: 'off', counts_toward_completeness: false },
  { section: 17, status: 'missing', counts_toward_completeness: true },
  { section: 18, status: 'missing', counts_toward_completeness: true },
  { section: 19, status: 'missing', counts_toward_completeness: true },
]

test('a new course file lists the 19 sections in order, missing except sections 7 to 9 and switched-off sections, which do not count', async () => {
  const lecturer = await createLecturer()
  const courseTypeId = await createCourseType([10, 12])
  const offeringId = await offer({ courseId: await createCourse(courseTypeId), coordinatorId: lecturer.id })

  expect((await admin.rpc('section_statuses', { offering_id: offeringId })).data).toEqual(NEW_COURSE_FILE)

  await admin.from('course_types').update({ sections_on: [11, 13, 14, 15, 16] }).eq('id', courseTypeId)
  expect((await admin.rpc('section_statuses', { offering_id: offeringId })).data).toEqual(NEW_COURSE_FILE)
})

test('a lecturer or coordinator reads only the offerings they teach, in current and past semesters', async () => {
  const [coordinator, lecturer, outsider] = [await createLecturer(), await createLecturer(), await createLecturer()]
  const past = await pickSemester()
  let current = await pickSemester()
  while (current.id === past.id) current = await pickSemester()
  const courseId = await createCourse(await createCourseType([10, 12]))
  const pastOffering = await offer({
    semesterId: past.id,
    courseId,
    coordinatorId: coordinator.id,
    lecturerIds: [lecturer.id],
  })
  const currentOffering = await offer({
    semesterId: current.id,
    courseId,
    coordinatorId: lecturer.id,
    lecturerIds: [coordinator.id],
  })
  const coordinatorOnly = await offer({ coordinatorId: coordinator.id })
  const otherOffering = await offer({ coordinatorId: outsider.id })

  const expected = new Map([
    [coordinator, [pastOffering, currentOffering, coordinatorOnly]],
    [lecturer, [pastOffering, currentOffering]],
    [outsider, [otherOffering]],
  ])
  for (const [user, offeringIds] of expected) {
    const client = await signIn(user.email, user.password)

    const offerings = await client.from('offerings').select('id')
    expect(offerings.error).toBeNull()
    expect(offerings.data!.map((row) => row.id).toSorted()).toEqual(offeringIds.toSorted())

    const lecturerRows = await client.from('offering_lecturers').select('offering_id')
    expect(new Set(lecturerRows.data!.map((row) => row.offering_id))).toEqual(new Set(offeringIds))

    for (const offeringId of [pastOffering, currentOffering, coordinatorOnly, otherOffering]) {
      const { data } = await client.rpc('section_statuses', { offering_id: offeringId })
      expect(data).toEqual(offeringIds.includes(offeringId) ? NEW_COURSE_FILE : [])
    }
  }
})

test.each(READ_EVERY_OFFERING)('the %s user reads every offering, its lecturers and its course file', async (role) => {
  const client = await signInAs(role)
  const [coordinator, lecturer] = [await createLecturer(), await createLecturer()]
  const offeringId = await offer({ coordinatorId: coordinator.id, lecturerIds: [lecturer.id] })

  expect((await client.from('offerings').select('id, coordinator_id').eq('id', offeringId)).data).toEqual([
    { id: offeringId, coordinator_id: coordinator.id },
  ])
  const lecturers = await client.from('offering_lecturers').select('lecturer_id').eq('offering_id', offeringId)
  expect(lecturers.data!.map((row) => row.lecturer_id).toSorted()).toEqual([coordinator.id, lecturer.id].toSorted())
  expect((await client.rpc('section_statuses', { offering_id: offeringId })).data).toEqual(NEW_COURSE_FILE)
})

test('root reads no offerings, lecturers or course files', async () => {
  const root = await signInAs('root')
  const offeringId = await offer({ coordinatorId: (await createLecturer()).id })

  for (const table of ['offerings', 'offering_lecturers']) {
    const { data, error } = await root.from(table).select('*')
    expect(error).toBeNull()
    expect(data).toEqual([])
  }
  expect((await root.rpc('section_statuses', { offering_id: offeringId })).data).toEqual([])
})

const TEACHING_PLAN = 2

function pdf(name: string) {
  return new File([sizedPdf(1024)], name, { type: 'application/pdf' })
}

/** The offering's course, its sections, whether its course file is in use, and its staff, as the service role reads them, or null once it is deleted. */
async function offeringOf(offeringId: string) {
  const { data, error } = await adminClient().from('offerings').select('course_id, sections_on, in_use').eq('id', offeringId).maybeSingle()
  if (error) throw error
  return data && { ...data, ...(await staffOf(offeringId)) }
}

/** Ways the coordinator or an auditor puts an offering's course file in use. */
const USES: Record<string, (offeringId: string, coordinator: SupabaseClient) => Promise<unknown>> = {
  'a file': (offeringId, coordinator) => uploadFile(coordinator, { offeringId, section: TEACHING_PLAN }, pdf('plan.pdf')),
  'a file deleted since': async (offeringId, coordinator) => {
    const file = await uploadFile(coordinator, { offeringId, section: TEACHING_PLAN }, pdf('plan.pdf'))
    await deleteFile(coordinator, file.id)
  },
  'an item': async (offeringId, coordinator) => {
    const { error } = await coordinator.rpc('add_item', { offering_id: offeringId, section: 12 })
    if (error) throw error
  },
  'a switched section': async (offeringId, coordinator) => {
    const { error } = await coordinator.rpc('switch_section', { offering_id: offeringId, section: 12, is_on: false, reason: 'No tutorials' })
    if (error) throw error
  },
  'a verdict and its audit request': async (offeringId) => {
    const auditor = await signInAs('auditor')
    const { error } = await auditor.rpc('record_verdict', { offering_id: offeringId, section: TEACHING_PLAN, verdict: 'needs_fix', comment: 'Upload the plan.' })
    if (error) throw error
  },
}

test('the admin deletes an offering whose course file is not in use, and its lecturers with it', async () => {
  const [coordinator, lecturer] = [await createLecturer(), await createLecturer()]
  const offeringId = await offer({ coordinatorId: coordinator.id, lecturerIds: [lecturer.id] })
  expect(await offeringOf(offeringId)).toMatchObject({ in_use: false })

  const { error } = await admin.from('offerings').delete().eq('id', offeringId)

  expect(error).toBeNull()
  expect(await offeringOf(offeringId)).toBeNull()
  expect((await adminClient().from('offering_lecturers').select('lecturer_id').eq('offering_id', offeringId)).data).toEqual([])
})

test("the admin changes the course of an offering whose course file is not in use, and it takes the new course type's sections", async () => {
  const [coordinator, lecturer] = [await createLecturer(), await createLecturer()]
  const offeringId = await offer({ courseId: await createCourse(await createCourseType([10, 12])), coordinatorId: coordinator.id, lecturerIds: [lecturer.id] })
  const courseTypeId = await createCourseType([11, 13])
  const courseId = await createCourse(courseTypeId)

  const { error } = await admin.from('offerings').update({ course_id: courseId }).eq('id', offeringId)

  expect(error).toBeNull()
  const changed = { course_id: courseId, sections_on: [11, 13], in_use: false, coordinator: coordinator.id, lecturers: [coordinator.id, lecturer.id].toSorted() }
  expect(await offeringOf(offeringId)).toEqual(changed)

  // Like any offering, it keeps its sections when its course type changes later, even when its course is saved again.
  expect((await admin.from('course_types').update({ sections_on: [14] }).eq('id', courseTypeId)).error).toBeNull()
  expect((await admin.from('offerings').update({ course_id: courseId }).eq('id', offeringId)).error).toBeNull()
  expect(await offeringOf(offeringId)).toEqual(changed)
})

test('an offering cannot take a course that its semester already offers', async () => {
  const lecturer = await createLecturer()
  const semester = await pickSemester()
  const offered = await createCourse(await createCourseType([10]))
  await offer({ semesterId: semester.id, courseId: offered, coordinatorId: lecturer.id })
  const offeringId = await offer({ semesterId: semester.id, coordinatorId: lecturer.id })
  const before = await offeringOf(offeringId)

  const { error } = await admin.from('offerings').update({ course_id: offered }).eq('id', offeringId)

  expect(error?.code).toBe(UNIQUE_VIOLATION)
  expect(await offeringOf(offeringId)).toEqual(before)
})

test.each(Object.keys(USES))('an offering whose course file has %s keeps its course and cannot be deleted, but its lecturers can change', async (use) => {
  const coordinator = await createLecturer()
  const offeringId = await offer({ coordinatorId: coordinator.id })
  await USES[use](offeringId, await signIn(coordinator.email, coordinator.password))
  const before = await offeringOf(offeringId)
  expect(before).toMatchObject({ in_use: true })

  const changed = await admin.from('offerings').update({ course_id: await createCourse(await createCourseType([10])) }).eq('id', offeringId)
  expect(changed.error?.code).toBe(FOREIGN_KEY_VIOLATION)
  const deleted = await admin.from('offerings').delete().eq('id', offeringId)
  expect(deleted.error?.code).toBe(FOREIGN_KEY_VIOLATION)
  expect(await offeringOf(offeringId)).toEqual(before)

  const other = await createLecturer()
  expect((await admin.rpc('set_offering_lecturers', { offering_id: offeringId, coordinator_id: other.id, lecturer_ids: [] })).error).toBeNull()
  expect(await staffOf(offeringId)).toEqual({ coordinator: other.id, lecturers: [other.id] })
})

test.each([...NOT_ADMIN, 'coordinator'] as const)('the %s user cannot change the course of an offering or delete it', async (role) => {
  const coordinator = await createLecturer()
  const offeringId = await offer({ coordinatorId: coordinator.id })
  const client = role === 'coordinator' ? await signIn(coordinator.email, coordinator.password) : await signInAs(role)
  const before = await offeringOf(offeringId)

  await client.from('offerings').update({ course_id: await createCourse(await createCourseType([10])) }).eq('id', offeringId)
  await client.from('offerings').delete().eq('id', offeringId)

  expect(await offeringOf(offeringId)).toEqual(before)
})
