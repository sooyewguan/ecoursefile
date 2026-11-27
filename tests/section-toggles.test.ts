import { setTimeout } from 'node:timers/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { numberedPdf } from '../src/pdf/fixtures.ts'
import { createUploadSession, finalizeUpload, sendChunks, uploadFile } from '../src/uploads.ts'
import { adminClient, createOffering, createUser, signIn, signInAs } from './harness.ts'

const PERMISSION_DENIED = '42501'
const CHECK_VIOLATION = '23514'

/** Sections 10 to 16. The course type of every offering here has 10 and 12 on. */
const SWITCHABLE = [10, 11, 12, 13, 14, 15, 16]
const ON_BY_DEFAULT = [10, 12]
const LECTURE_NOTES = 10
const LAB = 11

/** An offering's switchable sections and reasons before anyone switches a section. */
const UNSWITCHED = { sections_on: ON_BY_DEFAULT, section_reasons: {} }

type Staff = { id: string; client: SupabaseClient }

/** An offering with a coordinator and a lecturer, and a lecturer who teaches another offering. */
type Course = { offeringId: string; coordinator: Staff; lecturer: Staff; outsider: Staff }

let auditor: SupabaseClient

beforeAll(async () => {
  auditor = await signInAs('auditor')
})

async function createStaff(): Promise<Staff> {
  const user = await createUser({ roles: ['lecturer'] })
  return { id: user.id, client: await signIn(user.email, user.password) }
}

async function createCourse(): Promise<Course> {
  const [coordinator, lecturer, outsider] = await Promise.all([createStaff(), createStaff(), createStaff()])
  const offering = await createOffering({ coordinatorId: coordinator.id, lecturerIds: [lecturer.id], sectionsOn: ON_BY_DEFAULT })
  await createOffering({ coordinatorId: outsider.id })
  return { offeringId: offering.id, coordinator, lecturer, outsider }
}

/** Switches the section on or off as this client, the way the course file page does, and returns the RPC's result. */
function switchSection(client: SupabaseClient, offeringId: string, section: number, isOn: boolean, reason?: string | null) {
  return client.rpc('switch_section', { offering_id: offeringId, section, is_on: isOn, reason })
}

/** The offering's switchable sections that are on, and the reason for each that differs from the course type, as this client reads them. */
async function togglesOf(client: SupabaseClient, offeringId: string) {
  const { data, error } = await client.from('offerings').select('sections_on, section_reasons').eq('id', offeringId).single()
  if (error) throw error
  return data
}

/** The section's status row, as this client reads it. */
async function statusOf(client: SupabaseClient, offeringId: string, section: number) {
  const { data, error } = await client.rpc('section_statuses', { offering_id: offeringId })
  if (error) throw error
  return data.find((row: { section: number }) => row.section === section)
}

test('the coordinator switches every section from 10 to 16 away from its default and back', async () => {
  const course = await createCourse()

  for (const section of SWITCHABLE) {
    const { error } = await switchSection(course.coordinator.client, course.offeringId, section, !ON_BY_DEFAULT.includes(section), `Reason ${section}`)
    expect(error).toBeNull()
  }
  expect(await togglesOf(auditor, course.offeringId)).toEqual({
    sections_on: [11, 13, 14, 15, 16],
    section_reasons: Object.fromEntries(SWITCHABLE.map((section) => [section, `Reason ${section}`])),
  })

  for (const section of SWITCHABLE) {
    expect((await switchSection(course.coordinator.client, course.offeringId, section, ON_BY_DEFAULT.includes(section))).error).toBeNull()
  }
  expect(await togglesOf(auditor, course.offeringId)).toEqual(UNSWITCHED)
})

test("the offering's other lecturers, lecturers of other offerings, admin, auditor, HoD, Dean, Deputy Dean and root cannot switch a section", async () => {
  const course = await createCourse()
  const roles = ['admin', 'auditor', 'hod', 'dean', 'deputy_dean', 'root'] as const
  const others = [course.lecturer.client, course.outsider.client, ...(await Promise.all(roles.map(signInAs)))]

  for (const client of others) {
    expect((await switchSection(client, course.offeringId, LAB, true, 'Labs run this semester')).error?.code).toBe(PERMISSION_DENIED)
    expect((await switchSection(client, course.offeringId, LECTURE_NOTES, false, 'No notes')).error?.code).toBe(PERMISSION_DENIED)
  }
  for (const client of [course.coordinator.client, others[2]]) {
    for (const change of [{ section_reasons: { [LAB]: 'Labs run this semester' } }, { default_sections_on: [LAB] }]) {
      expect((await client.from('offerings').update(change).eq('id', course.offeringId)).error?.code).toBe(PERMISSION_DENIED)
    }
  }

  expect(await togglesOf(adminClient(), course.offeringId)).toEqual(UNSWITCHED)
})

test('sections 1 to 9 and 17 to 19 cannot be switched', async () => {
  const course = await createCourse()
  const fixed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 17, 18, 19]
  const before = (await course.coordinator.client.rpc('section_statuses', { offering_id: course.offeringId })).data

  for (const section of fixed) {
    for (const isOn of [false, true]) {
      const { error } = await switchSection(course.coordinator.client, course.offeringId, section, isOn, 'A reason')
      expect(error?.code).toBe(PERMISSION_DENIED)
    }
  }

  expect((await course.coordinator.client.rpc('section_statuses', { offering_id: course.offeringId })).data).toEqual(before)
  expect(await togglesOf(adminClient(), course.offeringId)).toEqual(UNSWITCHED)
})

test('switching a section away from its course type default needs a reason that is not blank', async () => {
  const course = await createCourse()

  for (const [section, isOn] of [
    [LECTURE_NOTES, false],
    [LAB, true],
  ] as const) {
    for (const reason of [undefined, null, '', ' \t\n ']) {
      expect((await switchSection(course.coordinator.client, course.offeringId, section, isOn, reason)).error?.code).toBe(CHECK_VIOLATION)
    }
  }
  expect(await togglesOf(adminClient(), course.offeringId)).toEqual(UNSWITCHED)

  expect((await switchSection(course.coordinator.client, course.offeringId, LAB, true, '  Labs run this semester ')).error).toBeNull()
  expect(await togglesOf(auditor, course.offeringId)).toEqual({ sections_on: [10, 11, 12], section_reasons: { [LAB]: 'Labs run this semester' } })
})

test('returning a section to its default clears its reason, and needs none', async () => {
  const course = await createCourse()
  await switchSection(course.coordinator.client, course.offeringId, LECTURE_NOTES, false, 'Notes are in the textbook')
  await switchSection(course.coordinator.client, course.offeringId, LAB, true, 'Labs run this semester')
  expect((await togglesOf(auditor, course.offeringId)).section_reasons).toEqual({
    [LECTURE_NOTES]: 'Notes are in the textbook',
    [LAB]: 'Labs run this semester',
  })

  expect((await switchSection(course.coordinator.client, course.offeringId, LECTURE_NOTES, true)).error).toBeNull()
  expect((await switchSection(course.coordinator.client, course.offeringId, LAB, false, 'A reason that is not kept')).error).toBeNull()

  expect(await togglesOf(auditor, course.offeringId)).toEqual(UNSWITCHED)
})

test('the default stays the course type setting that the offering copied, after the admin edits the type', async () => {
  const course = await createCourse()
  const service = adminClient()
  const { data } = await service.from('offerings').select('course:courses(course_type_id)').eq('id', course.offeringId).single()
  const courseTypeId = (data as unknown as { course: { course_type_id: string } }).course.course_type_id
  expect((await service.from('course_types').update({ sections_on: [LAB] }).eq('id', courseTypeId)).error).toBeNull()

  expect((await switchSection(course.coordinator.client, course.offeringId, LAB, true)).error?.code).toBe(CHECK_VIOLATION)
  expect((await switchSection(course.coordinator.client, course.offeringId, LECTURE_NOTES, false)).error?.code).toBe(CHECK_VIOLATION)
  expect(await togglesOf(auditor, course.offeringId)).toEqual(UNSWITCHED)
})

test('a switched-off section shows as Off with its reason, even with files, and is left out of completeness', async () => {
  const course = await createCourse()
  const notes = { offeringId: course.offeringId, section: LECTURE_NOTES }
  await uploadFile(course.lecturer.client, notes, new File([await numberedPdf(8)], 'notes.pdf', { type: 'application/pdf' }))
  expect(await statusOf(auditor, course.offeringId, LECTURE_NOTES)).toEqual({
    section: LECTURE_NOTES,
    status: 'pending_review',
    counts_toward_completeness: true,
  })

  await switchSection(course.coordinator.client, course.offeringId, LECTURE_NOTES, false, 'Notes are in the textbook')
  await switchSection(course.coordinator.client, course.offeringId, LAB, true, 'Labs run this semester')

  for (const client of [course.coordinator.client, course.lecturer.client, auditor]) {
    const { data } = await client.rpc('section_statuses', { offering_id: course.offeringId })
    expect(data.filter((row: { section: number }) => SWITCHABLE.includes(row.section))).toEqual([
      { section: 10, status: 'off', counts_toward_completeness: false },
      { section: 11, status: 'missing', counts_toward_completeness: true },
      { section: 12, status: 'missing', counts_toward_completeness: true },
      { section: 13, status: 'off', counts_toward_completeness: false },
      { section: 14, status: 'off', counts_toward_completeness: false },
      { section: 15, status: 'off', counts_toward_completeness: false },
      { section: 16, status: 'off', counts_toward_completeness: false },
    ])
    expect((await togglesOf(client, course.offeringId)).section_reasons).toEqual({
      [LECTURE_NOTES]: 'Notes are in the textbook',
      [LAB]: 'Labs run this semester',
    })
  }
  expect((await course.outsider.client.from('offerings').select('section_reasons').eq('id', course.offeringId)).data).toEqual([])

  await switchSection(course.coordinator.client, course.offeringId, LECTURE_NOTES, true)
  expect(await statusOf(auditor, course.offeringId, LECTURE_NOTES)).toEqual({
    section: LECTURE_NOTES,
    status: 'pending_review',
    counts_toward_completeness: true,
  })
})

test('a section switched on takes new items, and one switched off takes none', async () => {
  const course = await createCourse()
  const addLab = () => course.lecturer.client.rpc('add_item', { offering_id: course.offeringId, section: LAB })
  expect((await addLab()).error?.code).toBe(PERMISSION_DENIED)

  await switchSection(course.coordinator.client, course.offeringId, LAB, true, 'Labs run this semester')
  expect(await addLab()).toMatchObject({ data: 1, error: null })

  await switchSection(course.coordinator.client, course.offeringId, LAB, false)
  expect((await addLab()).error?.code).toBe(PERMISSION_DENIED)
})

test('an upload that finalizes while its section is switched off is refused with the upload session refusal, or recorded before the switch', async () => {
  // Each round switches the section off a few milliseconds after finalize starts, while finalize checks and records the file.
  for (const delay of [0, 0, 0, 4, 4, 4, 8, 8, 8]) {
    const course = await createCourse()
    const notes = { offeringId: course.offeringId, section: LECTURE_NOTES }
    const session = await createUploadSession(course.lecturer.client, notes, 'notes.pdf')
    await sendChunks(session.uploadUrl, new File([await numberedPdf(1)], 'notes.pdf', { type: 'application/pdf' }))

    const finalized = finalizeUpload(course.lecturer.client, notes, session.storedName).then(
      () => null,
      (refusal: unknown) => refusal,
    )
    await setTimeout(delay)
    expect((await switchSection(course.coordinator.client, course.offeringId, LECTURE_NOTES, false, 'Notes are in the textbook')).error).toBeNull()
    const refusal = await finalized
    const sessionRefusal = await createUploadSession(course.lecturer.client, notes, 'notes.pdf').catch((error: unknown) => error)

    const { data: log } = await auditor.from('activity_log').select('action').eq('offering_id', course.offeringId).order('id')
    const { data: files } = await auditor.from('files').select('name').eq('offering_id', course.offeringId).eq('section', LECTURE_NOTES)
    expect({ refusal, log, files }, `switched off ${delay} ms after finalize started`).toEqual(
      refusal
        ? { refusal: sessionRefusal, log: [{ action: 'switch_off' }], files: [] }
        : { refusal: null, log: [{ action: 'upload' }, { action: 'switch_off' }], files: [{ name: 'notes.pdf' }] },
    )
  }
})

test('each switch is recorded in the activity log, and a switch to the setting a section has changes nothing', async () => {
  const course = await createCourse()

  await switchSection(course.coordinator.client, course.offeringId, LECTURE_NOTES, false, 'Notes are in the textbook')
  expect((await switchSection(course.coordinator.client, course.offeringId, LECTURE_NOTES, false, 'Another reason')).error).toBeNull()
  await switchSection(course.coordinator.client, course.offeringId, LAB, true, 'Labs run this semester')
  await switchSection(course.coordinator.client, course.offeringId, LECTURE_NOTES, true)
  expect((await switchSection(course.coordinator.client, course.offeringId, 12, true)).error).toBeNull()

  const { data: log } = await auditor
    .from('activity_log')
    .select('section, action, actor_id, file_name, reason')
    .eq('offering_id', course.offeringId)
    .order('id')
  expect(log).toEqual([
    { section: LECTURE_NOTES, action: 'switch_off', actor_id: course.coordinator.id, file_name: null, reason: 'Notes are in the textbook' },
    { section: LAB, action: 'switch_on', actor_id: course.coordinator.id, file_name: null, reason: 'Labs run this semester' },
    { section: LECTURE_NOTES, action: 'switch_on', actor_id: course.coordinator.id, file_name: null, reason: null },
  ])
  expect(await togglesOf(auditor, course.offeringId)).toEqual({ sections_on: [10, 11, 12], section_reasons: { [LAB]: 'Labs run this semester' } })
})
