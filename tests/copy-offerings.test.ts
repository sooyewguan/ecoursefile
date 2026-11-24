import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { adminClient, createDepartment, createUser, emptyReportSemester, pickSemester, signIn, signInAs } from './harness.ts'

// Copying fills its target semester with every offering of its source, so each test copies between
// two semesters that hold no other test's offerings. emptyReportSemester gives such semesters.

const INSUFFICIENT_PRIVILEGE = '42501'

/** What copy_offerings says it did with one offering of the source semester. */
type Copied = {
  course_id: string
  course_code: string
  course_title: string
  offering_id: string | null
  skipped: 'already_offered' | 'coordinator_unavailable' | null
  coordinator_name: string
  left_off: string[]
}

type Semester = { id: string; code: string }

let admin: SupabaseClient
let departmentId: string

beforeAll(async () => {
  admin = await signInAs('admin')
  departmentId = await createDepartment()
})

async function createCourseType(sectionsOn: number[]) {
  const { data, error } = await adminClient().from('course_types').insert({ name: `Type-${randomUUID()}`, sections_on: sectionsOn }).select('id').single()
  if (error) throw error
  return data.id as string
}

async function createCourse(courseTypeId?: string) {
  const { data, error } = await adminClient()
    .from('courses')
    .insert({ code: `BITP-${randomUUID()}`, title: 'Seam1 Course', department_id: departmentId, course_type_id: courseTypeId ?? (await createCourseType([10, 12])) })
    .select('id, code')
    .single()
  if (error) throw error
  return data as { id: string; code: string }
}

/** A new lecturer with a name of their own, and the means to sign in. */
async function createLecturer(fullName = `Lecturer ${randomUUID()}`) {
  return { ...(await createUser({ roles: ['lecturer'], fullName })), fullName }
}

/** Offers the course in the semester as the admin, the way the semester page does. */
async function offer(semester: Semester, courseId: string, coordinatorId: string, lecturerIds: string[] = []) {
  const { data, error } = await admin.rpc('create_offering', { semester_id: semester.id, course_id: courseId, coordinator_id: coordinatorId, lecturer_ids: lecturerIds })
  if (error) throw error
  return data as string
}

async function copy(client: SupabaseClient, source: Semester, target: Semester) {
  return client.rpc('copy_offerings', { source_semester_id: source.id, target_semester_id: target.id })
}

/** Copies as the admin and returns what the copy did, by course id. */
async function copyAsAdmin(source: Semester, target: Semester) {
  const { data, error } = await copy(admin, source, target)
  if (error) throw error
  return new Map((data as Copied[]).map((row) => [row.course_id, row]))
}

/** The offerings of the semester, as the service role reads them: course, coordinator, sorted lecturers and sections. */
async function offeringsOf(semester: Semester) {
  const { data, error } = await adminClient()
    .from('offerings')
    .select('id, course_id, coordinator_id, default_sections_on, section_reasons, offering_lecturers!offering_lecturers_offering_id_fkey(lecturer_id)')
    .eq('semester_id', semester.id)
  if (error) throw error
  return new Map(
    data.map((offering) => [
      offering.course_id as string,
      {
        id: offering.id as string,
        coordinator: offering.coordinator_id as string,
        lecturers: offering.offering_lecturers.map((row: { lecturer_id: string }) => row.lecturer_id).toSorted(),
        defaultSectionsOn: (offering.default_sections_on as number[]).toSorted(),
        sectionReasons: offering.section_reasons,
      },
    ]),
  )
}

async function deactivate(userId: string) {
  const { error } = await adminClient().from('profiles').update({ active: false }).eq('id', userId)
  if (error) throw error
}

async function revokeLecturerRole(userId: string) {
  const { error } = await adminClient().from('user_roles').delete().match({ user_id: userId, role: 'lecturer' })
  if (error) throw error
}

test('copying a semester offers each of its courses in the target with the same coordinator and lecturers, and the course type\'s sections as they are now', async () => {
  const [source, target] = [await emptyReportSemester(), await emptyReportSemester()]
  const [coordinator, lecturer, otherCoordinator] = [await createLecturer(), await createLecturer(), await createLecturer()]
  const courseTypeId = await createCourseType([10, 12])
  const course = await createCourse(courseTypeId)
  const otherCourse = await createCourse()
  const sourceOfferingId = await offer(source, course.id, coordinator.id, [lecturer.id])
  await offer(source, otherCourse.id, otherCoordinator.id)
  // The source offering switches a section on, and the course type changes after it was offered.
  const coordinatorClient = await signIn(coordinator.email, coordinator.password)
  const switched = await coordinatorClient.rpc('switch_section', { offering_id: sourceOfferingId, section: 11, is_on: true, reason: 'Labs this semester' })
  expect(switched.error).toBeNull()
  const { error } = await adminClient().from('course_types').update({ sections_on: [13, 14] }).eq('id', courseTypeId)
  expect(error).toBeNull()

  const copied = await copyAsAdmin(source, target)

  const offered = await offeringsOf(target)
  expect(offered.get(course.id)).toEqual({
    id: copied.get(course.id)!.offering_id,
    coordinator: coordinator.id,
    lecturers: [coordinator.id, lecturer.id].toSorted(),
    defaultSectionsOn: [13, 14],
    sectionReasons: {},
  })
  expect(offered.get(otherCourse.id)).toMatchObject({ coordinator: otherCoordinator.id, lecturers: [otherCoordinator.id], defaultSectionsOn: [10, 12] })
  expect(copied.get(course.id)).toMatchObject({ course_code: course.code, skipped: null, coordinator_name: coordinator.fullName, left_off: [] })
  expect(copied.get(otherCourse.id)).toMatchObject({ offering_id: offered.get(otherCourse.id)!.id, skipped: null, left_off: [] })
  // The source semester stays as it was.
  expect((await offeringsOf(source)).get(course.id)).toMatchObject({ coordinator: coordinator.id, lecturers: [coordinator.id, lecturer.id].toSorted(), sectionReasons: { 11: 'Labs this semester' } })
})

test('copying skips courses the target already offers and offerings whose coordinator is deactivated or no longer a lecturer, and leaves off such lecturers', async () => {
  const [source, target] = [await emptyReportSemester(), await emptyReportSemester()]
  const [coordinator, deactivated, unroled, goneCoordinator, noLongerCoordinator, other, targetCoordinator] = await Promise.all(
    Array.from({ length: 7 }, () => createLecturer()),
  )
  const [kept, withGoneCoordinator, withUnroledCoordinator, alreadyOffered] = [await createCourse(), await createCourse(), await createCourse(), await createCourse()]
  await offer(source, kept.id, coordinator.id, [deactivated.id, unroled.id, other.id])
  await offer(source, withGoneCoordinator.id, goneCoordinator.id, [other.id])
  await offer(source, withUnroledCoordinator.id, noLongerCoordinator.id)
  await offer(source, alreadyOffered.id, coordinator.id, [other.id])
  const targetOfferingId = await offer(target, alreadyOffered.id, targetCoordinator.id)
  await deactivate(deactivated.id)
  await deactivate(goneCoordinator.id)
  await revokeLecturerRole(unroled.id)
  await revokeLecturerRole(noLongerCoordinator.id)

  const copied = await copyAsAdmin(source, target)

  const offered = await offeringsOf(target)
  expect(offered.get(kept.id)).toMatchObject({ coordinator: coordinator.id, lecturers: [coordinator.id, other.id].toSorted() })
  expect(copied.get(kept.id)).toMatchObject({ offering_id: offered.get(kept.id)!.id, skipped: null })
  expect(copied.get(kept.id)!.left_off.toSorted()).toEqual([deactivated.fullName, unroled.fullName].toSorted())
  expect(offered.has(withGoneCoordinator.id)).toBe(false)
  expect(copied.get(withGoneCoordinator.id)).toMatchObject({ offering_id: null, skipped: 'coordinator_unavailable', coordinator_name: goneCoordinator.fullName, left_off: [goneCoordinator.fullName] })
  expect(offered.has(withUnroledCoordinator.id)).toBe(false)
  expect(copied.get(withUnroledCoordinator.id)).toMatchObject({ offering_id: null, skipped: 'coordinator_unavailable', coordinator_name: noLongerCoordinator.fullName })
  // The target's own offering of the course stays as it was.
  expect(offered.get(alreadyOffered.id)).toMatchObject({ id: targetOfferingId, coordinator: targetCoordinator.id, lecturers: [targetCoordinator.id] })
  expect(copied.get(alreadyOffered.id)).toMatchObject({ offering_id: null, skipped: 'already_offered', left_off: [] })
  expect(copied.size).toBe(4)

  // A second copy adds nothing, since the target now offers every course it can.
  const again = await copyAsAdmin(source, target)

  expect(new Map([...again].map(([courseId, row]) => [courseId, row.skipped]))).toEqual(
    new Map([
      [kept.id, 'already_offered'],
      [withGoneCoordinator.id, 'coordinator_unavailable'],
      [withUnroledCoordinator.id, 'coordinator_unavailable'],
      [alreadyOffered.id, 'already_offered'],
    ]),
  )
  expect((await offeringsOf(target)).size).toBe(2)
})

test('copying lists the offerings by course code', async () => {
  const [source, target] = [await emptyReportSemester(), await emptyReportSemester()]
  const coordinator = await createLecturer()
  const courses = [await createCourse(), await createCourse(), await createCourse()]
  for (const course of courses) await offer(source, course.id, coordinator.id)

  const { data, error } = await copy(admin, source, target)

  expect(error).toBeNull()
  expect((data as Copied[]).map((row) => row.course_code)).toEqual(courses.map((course) => course.code).toSorted())
})

test.each(['lecturer', 'auditor', 'hod', 'dean', 'deputy_dean', 'root'] as const)('the %s user cannot copy offerings', async (role) => {
  const client = await signInAs(role)
  const [source, target] = [await pickSemester(), await pickSemester()]
  const before = (await offeringsOf(target)).size

  const { error } = await copy(client, source, target)

  expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE)
  expect((await offeringsOf(target)).size).toBe(before)
})
