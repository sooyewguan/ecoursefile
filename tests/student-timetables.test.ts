import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { sizedPdf } from '../src/pdf/fixtures.ts'
import { createUploadSession, deleteFile, deleteSharedFile, finalizeUpload, sendChunks, uploadFile, type SharedSlot } from '../src/uploads.ts'
import { adminClient, createOffering, createUser, fakeStoreItems, pickSemester, signIn, signInAs, userIdOf } from './harness.ts'

// Every test gives its timetables to new program codes. A student timetable links only into the
// offerings that tick its code, so these uploads change no other test's offering, in any semester.

const STUDENT_TIMETABLE = 5
const INSUFFICIENT_PRIVILEGE = '42501'
const FOREIGN_KEY_VIOLATION = '23503'

/** A stored file's name: the upload time, an underscore, then the uploader's file name. */
const STORED_NAME = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z_`

type Semester = { id: string; code: string }
type ProgramCode = { id: string; code: string }
type Staff = { id: string; client: SupabaseClient }

let admin: SupabaseClient
let adminId: string
let auditor: SupabaseClient

beforeAll(async () => {
  admin = await signInAs('admin')
  adminId = await userIdOf(admin)
  auditor = await signInAs('auditor')
})

async function createStaff(): Promise<Staff> {
  const user = await createUser({ roles: ['lecturer'] })
  return { id: user.id, client: await signIn(user.email, user.password) }
}

/** Adds a program code with the service role, as a test arrangement. */
async function createProgramCode(): Promise<ProgramCode> {
  const { data, error } = await adminClient().from('program_codes').insert({ code: `1 BITS S1G1 ${randomUUID()}` }).select('id, code').single()
  if (error) throw error
  return data
}

/** An offering in the semester with this coordinator and these other lecturers. */
async function offer(semester: Semester, coordinator: Staff, lecturers: Staff[] = []) {
  const offering = await createOffering({ coordinatorId: coordinator.id, lecturerIds: lecturers.map((lecturer) => lecturer.id), semester })
  return offering.id
}

/** A new lecturer who coordinates a new offering in the semester. */
async function teacherIn(semester: Semester) {
  const staff = await createStaff()
  await offer(semester, staff)
  return staff
}

/** Two different semesters. */
async function twoSemesters(): Promise<[Semester, Semester]> {
  const first = await pickSemester()
  let second = await pickSemester()
  while (second.id === first.id) second = await pickSemester()
  return [first, second]
}

function pdf(name: string, size = 1024) {
  return new File([sizedPdf(size)], name, { type: 'application/pdf' })
}

function timetableSlot(semester: Semester, programCode: ProgramCode): SharedSlot {
  return { semesterId: semester.id, section: STUDENT_TIMETABLE, programCodeId: programCode.id }
}

/** Uploads the program code's timetable for the semester as the admin. */
function uploadTimetable(semester: Semester, programCode: ProgramCode, name = 'timetable.pdf') {
  return uploadFile(admin, timetableSlot(semester, programCode), pdf(name))
}

/** Uploads the file to a new session and returns its stored name, without finalizing it. */
async function uploadWithoutFinalize(client: SupabaseClient, slot: SharedSlot, file: File) {
  const session = await createUploadSession(client, slot, file.name)
  await sendChunks(session.uploadUrl, file)
  return session.storedName
}

/** The program code's folder of timetables for the semester in the storage library: its id, then the code. */
function timetableFolder(semester: Semester, programCode: ProgramCode) {
  return `eCourseFile/${semester.code.replace('/', '-')}/_shared/05 Student Timetable/${programCode.id} ${programCode.code}`
}

/** Ticks or unticks the program code in section 5 of the offering as this client, and returns the error. */
async function tick(client: SupabaseClient, offeringId: string, programCode: ProgramCode, ticked = true) {
  const { error } = await client.rpc('tick_program_code', { offering_id: offeringId, program_code_id: programCode.id, ticked })
  return error
}

/** Which of these program codes the pick list of section 5 of the offering shows, as this client reads it, sorted. */
async function choicesAmong(client: SupabaseClient, offeringId: string, programCodes: ProgramCode[]) {
  const { data, error } = await client
    .from('offerings')
    .select('program_code_choices(id)')
    .eq('id', offeringId)
    .in('program_code_choices.id', programCodes.map((programCode) => programCode.id))
    .single()
  if (error) throw error
  return data.program_code_choices.map((choice: { id: string }) => choice.id).toSorted()
}

/** The program codes ticked in section 5 of the offering, as this client reads them, sorted. */
async function tickedCodes(client: SupabaseClient, offeringId: string) {
  const { data, error } = await client.from('offering_program_codes').select('program_code_id').eq('offering_id', offeringId)
  if (error) throw error
  return data.map((row) => row.program_code_id).toSorted()
}

/** The student timetables that section 5 of the offering's course file links, as this client reads them, sorted by id. */
async function linkedTimetables(client: SupabaseClient, offeringId: string) {
  const { data, error } = await client
    .from('offerings')
    .select('linked_files(id)')
    .eq('id', offeringId)
    .eq('linked_files.section', STUDENT_TIMETABLE)
    .single()
  if (error) throw error
  return data.linked_files.map((file: { id: string }) => file.id).toSorted()
}

/** The status of section 5 of the offering's course file, as the auditor reads it. */
async function timetableStatus(offeringId: string) {
  const { data, error } = await auditor.rpc('section_statuses', { offering_id: offeringId })
  if (error) throw error
  return data.find((row: { section: number }) => row.section === STUDENT_TIMETABLE)?.status
}

/** The timetables of these program codes for the semester, as this client reads them, by program code. */
async function timetablesOf(client: SupabaseClient, semester: Semester, programCodes: ProgramCode[]) {
  const { data, error } = await client
    .from('files')
    .select('id, program_code_id, name, deletable')
    .eq('semester_id', semester.id)
    .eq('section', STUDENT_TIMETABLE)
    .in('program_code_id', programCodes.map((programCode) => programCode.id))
    .order('program_code_id')
  if (error) throw error
  return data
}

function sortedIds(...rows: { id: string }[]) {
  return rows.map((row) => row.id).toSorted()
}

test('the admin uploads one student timetable for each program code for a semester, stored once in its folder of _shared', async () => {
  const [semester, otherSemester] = await twoSemesters()
  const [first, second] = [await createProgramCode(), await createProgramCode()]

  const timetable = await uploadFile(admin, timetableSlot(semester, first), pdf('s1g1.pdf', 2000))

  expect(timetable).toMatchObject({
    semester_id: semester.id,
    offering_id: null,
    lecturer_id: null,
    program_code_id: first.id,
    section: STUDENT_TIMETABLE,
    name: 's1g1.pdf',
    size: 2000,
    uploaded_by: adminId,
  })
  const folder = timetableFolder(semester, first)
  expect(await fakeStoreItems(folder)).toEqual([
    { id: timetable.storage_item_id, path: expect.stringMatching(new RegExp(`^${folder}/${STORED_NAME}s1g1\\.pdf$`)), size: 2000, mime_type: 'application/pdf' },
  ])

  // One per program code per semester.
  await expect(createUploadSession(admin, timetableSlot(semester, first), 'again.pdf')).rejects.toMatchObject({ status: 409, code: 'slot_full' })
  // An upload for one program code cannot be recorded for another.
  const pending = await uploadWithoutFinalize(admin, timetableSlot(semester, second), pdf('second.pdf'))
  await expect(finalizeUpload(admin, timetableSlot(semester, first), pending)).rejects.toMatchObject({ status: 404, code: 'not_found' })
  const secondTimetable = await finalizeUpload(admin, timetableSlot(semester, second), pending)
  await uploadTimetable(otherSemester, first, 'other.pdf')

  expect(await timetablesOf(admin, semester, [first, second])).toEqual(
    [
      { id: timetable.id, program_code_id: first.id, name: 's1g1.pdf', deletable: true },
      { id: secondTimetable.id, program_code_id: second.id, name: 'second.pdf', deletable: true },
    ].toSorted((a, b) => (a.program_code_id < b.program_code_id ? -1 : 1)),
  )
  expect((await timetablesOf(admin, otherSemester, [first, second])).map((file) => file.name)).toEqual(['other.pdf'])
})

test('a student timetable names a semester, section 5 and a program code that exists, and nobody uploads to a course file\'s section 5', async () => {
  const semester = await pickSemester()
  const programCode = await createProgramCode()
  const offeringId = await offer(semester, await createStaff())

  for (const slot of [
    { semesterId: semester.id, section: STUDENT_TIMETABLE },
    { semesterId: semester.id, section: STUDENT_TIMETABLE, programCodeId: 'not-a-uuid' },
    { semesterId: semester.id, section: STUDENT_TIMETABLE, programCodeId: randomUUID() },
    { semesterId: semester.id, section: STUDENT_TIMETABLE, programCodeId: programCode.id, offeringId },
    { semesterId: semester.id, section: 1, programCodeId: programCode.id },
    { semesterId: semester.id, section: 4, programCodeId: programCode.id },
    { offeringId, section: STUDENT_TIMETABLE, programCodeId: programCode.id },
  ]) {
    await expect(createUploadSession(admin, slot, 'timetable.pdf')).rejects.toMatchObject({ status: 400, code: 'invalid_request' })
  }
  await expect(createUploadSession(admin, { offeringId, section: STUDENT_TIMETABLE }, 'timetable.pdf')).rejects.toMatchObject({
    status: 403,
    code: 'forbidden',
  })
})

test.each(['lecturer', 'auditor', 'hod', 'dean', 'deputy_dean', 'root'] as const)(
  'the %s user cannot upload, record or delete a student timetable',
  async (role) => {
    const semester = await pickSemester()
    const programCode = await createProgramCode()
    // The lecturer teaches in the semester, so they read its student timetables.
    const client = role === 'lecturer' ? (await teacherIn(semester)).client : await signInAs(role)
    const slot = timetableSlot(semester, programCode)
    const pending = await uploadWithoutFinalize(admin, slot, pdf('timetable.pdf'))

    await expect(createUploadSession(client, slot, 'mine.pdf')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(finalizeUpload(client, slot, pending)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    expect(await timetablesOf(admin, semester, [programCode])).toEqual([])

    const timetable = await finalizeUpload(admin, slot, pending)
    // Root reads no course files, so it does not see the timetable at all.
    const refusal = role === 'root' ? { status: 404, code: 'not_found' } : { status: 403, code: 'forbidden' }
    await expect(deleteFile(client, timetable.id)).rejects.toMatchObject(refusal)
    await expect(deleteSharedFile(client, timetable.id)).rejects.toMatchObject(refusal)
    expect((await timetablesOf(admin, semester, [programCode])).map((file) => file.id)).toEqual([timetable.id])
    expect(await fakeStoreItems(timetableFolder(semester, programCode))).toHaveLength(1)
  },
)

test('the pick list of section 5 shows only program codes with a timetable in the offering\'s semester, and only those can be ticked', async () => {
  const [semester, otherSemester] = await twoSemesters()
  const [listed, elsewhere, missing] = [await createProgramCode(), await createProgramCode(), await createProgramCode()]
  const coordinator = await createStaff()
  const offeringId = await offer(semester, coordinator)
  await uploadTimetable(semester, listed)
  await uploadTimetable(otherSemester, elsewhere)
  const codes = [listed, elsewhere, missing]

  expect(await choicesAmong(coordinator.client, offeringId, codes)).toEqual([listed.id])
  expect(await choicesAmong(auditor, offeringId, codes)).toEqual([listed.id])
  for (const programCode of [elsewhere, missing]) {
    expect((await tick(coordinator.client, offeringId, programCode))?.code).toBe(FOREIGN_KEY_VIOLATION)
  }
  expect(await tickedCodes(coordinator.client, offeringId)).toEqual([])

  const late = await uploadTimetable(semester, missing)
  expect(await choicesAmong(coordinator.client, offeringId, codes)).toEqual(sortedIds(listed, missing))
  await deleteSharedFile(admin, late.id)
  expect(await choicesAmong(coordinator.client, offeringId, codes)).toEqual([listed.id])
})

test('section 5 is Missing while no program code is ticked, and Pending review once one is', async () => {
  const semester = await pickSemester()
  const [first, second] = [await createProgramCode(), await createProgramCode()]
  const coordinator = await createStaff()
  const offeringId = await offer(semester, coordinator)
  await uploadTimetable(semester, first)
  await uploadTimetable(semester, second)
  expect(await timetableStatus(offeringId)).toBe('missing')

  expect(await tick(coordinator.client, offeringId, first)).toBeNull()
  expect(await timetableStatus(offeringId)).toBe('pending_review')
  expect(await tick(coordinator.client, offeringId, second)).toBeNull()
  expect(await timetableStatus(offeringId)).toBe('pending_review')

  expect(await tick(coordinator.client, offeringId, first, false)).toBeNull()
  expect(await timetableStatus(offeringId)).toBe('pending_review')
  expect(await tick(coordinator.client, offeringId, second, false)).toBeNull()
  expect(await timetableStatus(offeringId)).toBe('missing')
})

test('ticking and unticking program codes changes the timetables that section 5 links, and each change is logged', async () => {
  const semester = await pickSemester()
  const [first, second] = [await createProgramCode(), await createProgramCode()]
  const [coordinator, lecturer, outsider] = [await createStaff(), await createStaff(), await teacherIn(semester)]
  const offeringId = await offer(semester, coordinator, [lecturer])
  const firstTimetable = await uploadTimetable(semester, first)
  const secondTimetable = await uploadTimetable(semester, second)
  expect(await linkedTimetables(coordinator.client, offeringId)).toEqual([])

  expect(await tick(coordinator.client, offeringId, first)).toBeNull()
  expect(await tick(lecturer.client, offeringId, second)).toBeNull()
  // Ticking a ticked code changes nothing and logs nothing.
  expect(await tick(lecturer.client, offeringId, first)).toBeNull()
  expect(await tickedCodes(lecturer.client, offeringId)).toEqual(sortedIds(first, second))
  expect(await linkedTimetables(lecturer.client, offeringId)).toEqual(sortedIds(firstTimetable, secondTimetable))
  expect(await linkedTimetables(auditor, offeringId)).toEqual(sortedIds(firstTimetable, secondTimetable))

  expect(await tick(lecturer.client, offeringId, first, false)).toBeNull()
  expect(await tick(coordinator.client, offeringId, first, false)).toBeNull()
  expect(await linkedTimetables(coordinator.client, offeringId)).toEqual([secondTimetable.id])
  expect(await tick(coordinator.client, offeringId, second, false)).toBeNull()
  expect(await linkedTimetables(coordinator.client, offeringId)).toEqual([])
  expect(await tickedCodes(coordinator.client, offeringId)).toEqual([])

  const logOf = async (client: SupabaseClient) => {
    const { data, error } = await client
      .from('activity_log')
      .select('section, program_code_id, action, actor_id, file_name')
      .eq('offering_id', offeringId)
      .order('id')
    if (error) throw error
    return data
  }
  const entry = (programCode: ProgramCode, action: 'tick' | 'untick', actor: Staff) => ({
    section: STUDENT_TIMETABLE,
    program_code_id: programCode.id,
    action,
    actor_id: actor.id,
    file_name: null,
  })
  const expected = [entry(first, 'tick', coordinator), entry(second, 'tick', lecturer), entry(first, 'untick', lecturer), entry(second, 'untick', coordinator)]
  expect(await logOf(lecturer.client)).toEqual(expected)
  expect(await logOf(auditor)).toEqual(expected)
  expect(await logOf(outsider.client)).toEqual([])
  expect(await logOf(await signInAs('root'))).toEqual([])
})

test('only the coordinator and lecturers of the offering tick and untick its program codes', async () => {
  const semester = await pickSemester()
  const programCode = await createProgramCode()
  const coordinator = await createStaff()
  const offeringId = await offer(semester, coordinator)
  // The outsider teaches another offering in the semester.
  const outsider = await teacherIn(semester)
  await uploadTimetable(semester, programCode)
  const others = [outsider.client, admin, auditor, ...(await Promise.all((['hod', 'dean', 'deputy_dean', 'root'] as const).map(signInAs)))]

  for (const client of others) {
    expect((await tick(client, offeringId, programCode))?.code).toBe(INSUFFICIENT_PRIVILEGE)
  }
  expect(await tickedCodes(auditor, offeringId)).toEqual([])

  expect(await tick(coordinator.client, offeringId, programCode)).toBeNull()
  for (const client of others) {
    expect((await tick(client, offeringId, programCode, false))?.code).toBe(INSUFFICIENT_PRIVILEGE)
  }
  expect(await tickedCodes(auditor, offeringId)).toEqual([programCode.id])
  expect(await tickedCodes(outsider.client, offeringId)).toEqual([])
})

test('deleting a student timetable needs confirmation, lists the offerings that tick its code, and leaves section 5 Missing in each until the code is unticked or its timetable is back', async () => {
  const semester = await pickSemester()
  const [deleted, kept] = [await createProgramCode(), await createProgramCode()]
  const [onlyDeleted, both, onlyKept] = [await createStaff(), await createStaff(), await createStaff()]
  const offerings = { onlyDeleted: await offer(semester, onlyDeleted), both: await offer(semester, both), onlyKept: await offer(semester, onlyKept) }
  const timetable = await uploadTimetable(semester, deleted)
  const keptTimetable = await uploadTimetable(semester, kept)
  for (const [staff, offeringId, codes] of [
    [onlyDeleted, offerings.onlyDeleted, [deleted]],
    [both, offerings.both, [deleted, kept]],
    [onlyKept, offerings.onlyKept, [kept]],
  ] as const) {
    for (const programCode of codes) expect(await tick(staff.client, offeringId, programCode)).toBeNull()
  }

  const { data: warning, error } = await admin.from('files').select('linked_offerings(id)').eq('id', timetable.id).single()
  expect(error).toBeNull()
  expect(warning!.linked_offerings.map((offering: { id: string }) => offering.id).toSorted()).toEqual([offerings.onlyDeleted, offerings.both].toSorted())

  await expect(deleteFile(admin, timetable.id)).rejects.toMatchObject({ status: 409, code: 'confirmation_required' })
  expect(await timetableStatus(offerings.onlyDeleted)).toBe('pending_review')

  await deleteSharedFile(admin, timetable.id)
  expect(await timetableStatus(offerings.onlyDeleted)).toBe('missing')
  expect(await timetableStatus(offerings.both)).toBe('missing')
  expect(await timetableStatus(offerings.onlyKept)).toBe('pending_review')
  expect(await linkedTimetables(both.client, offerings.both)).toEqual([keptTimetable.id])
  expect(await fakeStoreItems(timetableFolder(semester, deleted))).toEqual([])
  // The ticks stay, so each course file shows which program code lost its timetable.
  expect(await tickedCodes(both.client, offerings.both)).toEqual(sortedIds(deleted, kept))

  expect(await tick(both.client, offerings.both, deleted, false)).toBeNull()
  expect(await timetableStatus(offerings.both)).toBe('pending_review')

  const replacement = await uploadTimetable(semester, deleted, 'replacement.pdf')
  expect(await timetableStatus(offerings.onlyDeleted)).toBe('pending_review')
  expect(await linkedTimetables(onlyDeleted.client, offerings.onlyDeleted)).toEqual([replacement.id])
  expect(await linkedTimetables(both.client, offerings.both)).toEqual([keptTimetable.id])
})

test('uploads and deletes of student timetables are logged with their program code, and the semester\'s readers read the log', async () => {
  const [semester, otherSemester] = await twoSemesters()
  const programCode = await createProgramCode()
  const [teaching, elsewhere] = [await teacherIn(semester), await teacherIn(otherSemester)]

  const timetable = await uploadTimetable(semester, programCode)
  await deleteSharedFile(admin, timetable.id)

  const logOf = async (client: SupabaseClient) => {
    const { data, error } = await client
      .from('activity_log')
      .select('offering_id, semester_id, section, action, actor_id, file_name')
      .eq('program_code_id', programCode.id)
      .order('id')
    if (error) throw error
    return data
  }
  const entry = (action: 'upload' | 'delete') => ({
    offering_id: null,
    semester_id: semester.id,
    section: STUDENT_TIMETABLE,
    action,
    actor_id: adminId,
    file_name: 'timetable.pdf',
  })
  expect(await logOf(teaching.client)).toEqual([entry('upload'), entry('delete')])
  expect(await logOf(auditor)).toEqual([entry('upload'), entry('delete')])
  expect(await logOf(elsewhere.client)).toEqual([])
  expect(await logOf(await signInAs('root'))).toEqual([])
})
