import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { sizedPdf } from '../src/pdf/fixtures.ts'
import { createUploadSession, deleteFile, deleteSharedFile, finalizeUpload, sendChunks, uploadFile, type SharedSlot } from '../src/uploads.ts'
import { TEST_DOMAIN } from './global-setup.ts'
import { adminClient, createOffering, createUser, fakeStoreItems, pickSemester, signIn, signInAs } from './harness.ts'

// Every test gives its timetables to new lecturers. A timetable links only into the offerings its
// lecturer teaches, so these uploads change no other test's offering, in any semester.

const TIMETABLE = 4

/** A stored file's name: the upload time, an underscore, then the uploader's file name. */
const STORED_NAME = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z_`

type Semester = { id: string; code: string }
type Staff = { id: string; email: string; client: SupabaseClient }

let admin: SupabaseClient
let auditor: SupabaseClient

beforeAll(async () => {
  admin = await signInAs('admin')
  auditor = await signInAs('auditor')
})

/** A new lecturer, with a new email unless the test gives one. */
async function createStaff(email?: string): Promise<Staff> {
  const user = await createUser({ roles: ['lecturer'], email })
  return { id: user.id, email: user.email, client: await signIn(user.email, user.password) }
}

/** An offering in the semester with this coordinator and these other lecturers. */
async function offer(semester: Semester, coordinator: Staff, lecturers: Staff[] = []) {
  const offering = await createOffering({ coordinatorId: coordinator.id, lecturerIds: lecturers.map((lecturer) => lecturer.id), semester })
  return offering.id
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

function timetableSlot(semester: Semester): SharedSlot {
  return { semesterId: semester.id, section: TIMETABLE }
}

function uploadTimetable(lecturer: Staff, semester: Semester, name = 'timetable.pdf') {
  return uploadFile(lecturer.client, timetableSlot(semester), pdf(name))
}

/** Uploads the file to a new session and returns its stored name, without finalizing it. */
async function uploadWithoutFinalize(client: SupabaseClient, slot: SharedSlot, file: File) {
  const session = await createUploadSession(client, slot, file.name)
  await sendChunks(session.uploadUrl, file)
  return session.storedName
}

/**
 * The lecturer's folder of timetables for the semester in the storage library: their id, then their
 * email with the / that SharePoint forbids in a name made a -.
 */
function timetableFolder(semester: Semester, lecturer: Staff) {
  return `eCourseFile/${semester.code.replace('/', '-')}/_shared/04 Lecturer Timetable/${lecturer.id} ${lecturer.email.replaceAll('/', '-')}`
}

/** The status of section 4 of the offering's course file, as the auditor reads it. */
async function timetableStatus(offeringId: string) {
  const { data, error } = await auditor.rpc('section_statuses', { offering_id: offeringId })
  if (error) throw error
  return data.find((row: { section: number }) => row.section === TIMETABLE)?.status
}

/** The lecturers whose timetables section 4 of the offering's course file links, as this client reads them, sorted. */
async function linkedTimetables(client: SupabaseClient, offeringId: string) {
  const { data, error } = await client
    .from('offerings')
    .select('linked_files(lecturer_id)')
    .eq('id', offeringId)
    .eq('linked_files.section', TIMETABLE)
    .single()
  if (error) throw error
  return data.linked_files.map((file: { lecturer_id: string }) => file.lecturer_id).toSorted()
}

/** The timetables of these lecturers for the semester, as this client reads them, by lecturer. */
async function timetablesOf(client: SupabaseClient, semester: Semester, lecturers: Staff[]) {
  const { data, error } = await client
    .from('files')
    .select('id, lecturer_id, name, deletable')
    .eq('semester_id', semester.id)
    .eq('section', TIMETABLE)
    .in('lecturer_id', lecturers.map((lecturer) => lecturer.id))
    .order('lecturer_id')
  if (error) throw error
  return data
}

function sortedIds(...staff: { id: string }[]) {
  return staff.map((member) => member.id).toSorted()
}

test('a lecturer uploads their own timetable for a semester, stored once in their folder of _shared', async () => {
  const semester = await pickSemester()
  const lecturer = await createStaff()
  await offer(semester, lecturer)

  const timetable = await uploadFile(lecturer.client, timetableSlot(semester), pdf('timetable.pdf', 2000))

  expect(timetable).toMatchObject({
    semester_id: semester.id,
    offering_id: null,
    lecturer_id: lecturer.id,
    section: TIMETABLE,
    name: 'timetable.pdf',
    size: 2000,
    uploaded_by: lecturer.id,
  })
  const folder = timetableFolder(semester, lecturer)
  expect(await fakeStoreItems(folder)).toEqual([
    { id: timetable.storage_item_id, path: expect.stringMatching(new RegExp(`^${folder}/${STORED_NAME}timetable\\.pdf$`)), size: 2000, mime_type: 'application/pdf' },
  ])
  expect(await timetablesOf(lecturer.client, semester, [lecturer])).toEqual([
    { id: timetable.id, lecturer_id: lecturer.id, name: 'timetable.pdf', deletable: true },
  ])
})

test('section 4 of every offering a lecturer teaches in the semester links their timetable, and offerings of other semesters do not', async () => {
  const [semester, otherSemester] = await twoSemesters()
  const [lecturer, colleague] = [await createStaff(), await createStaff()]
  const coordinated = await offer(semester, lecturer)
  const taught = await offer(semester, colleague, [lecturer])
  const elsewhere = await offer(otherSemester, lecturer)

  await uploadTimetable(lecturer, semester)

  expect(await linkedTimetables(lecturer.client, coordinated)).toEqual([lecturer.id])
  expect(await linkedTimetables(lecturer.client, taught)).toEqual([lecturer.id])
  expect(await linkedTimetables(lecturer.client, elsewhere)).toEqual([])
  expect(await timetableStatus(coordinated)).toBe('pending_review')
  // The coordinator of the other offering has no timetable yet.
  expect(await timetableStatus(taught)).toBe('missing')
  expect(await timetableStatus(elsewhere)).toBe('missing')

  await uploadTimetable(colleague, semester)
  expect(await linkedTimetables(colleague.client, taught)).toEqual(sortedIds(lecturer, colleague))
  expect(await linkedTimetables(lecturer.client, coordinated)).toEqual([lecturer.id])
  expect(await timetableStatus(taught)).toBe('pending_review')
  expect(await timetableStatus(elsewhere)).toBe('missing')
})

test('section 4 of an offering with several lecturers is Missing until every lecturer, the coordinator included, has a timetable', async () => {
  const semester = await pickSemester()
  const [coordinator, first, second] = [await createStaff(), await createStaff(), await createStaff()]
  const offeringId = await offer(semester, coordinator, [first, second])
  expect(await timetableStatus(offeringId)).toBe('missing')

  await uploadTimetable(first, semester)
  expect(await timetableStatus(offeringId)).toBe('missing')
  const secondTimetable = await uploadTimetable(second, semester)
  expect(await timetableStatus(offeringId)).toBe('missing')
  await uploadTimetable(coordinator, semester)
  expect(await timetableStatus(offeringId)).toBe('pending_review')
  for (const lecturer of [coordinator, first, second]) {
    expect(await linkedTimetables(lecturer.client, offeringId)).toEqual(sortedIds(coordinator, first, second))
  }

  await deleteSharedFile(second.client, secondTimetable.id)
  expect(await timetableStatus(offeringId)).toBe('missing')
  expect(await linkedTimetables(first.client, offeringId)).toEqual(sortedIds(coordinator, first))
})

test('the lecturers of an offering read each other\'s names', async () => {
  const [coordinator, lecturer] = [await createStaff(), await createStaff()]
  const offeringId = await offer(await pickSemester(), coordinator, [lecturer])
  for (const [member, name] of [
    [coordinator, 'Coordinator Seam1'],
    [lecturer, 'Lecturer Seam1'],
  ] as const) {
    expect((await adminClient().from('profiles').update({ full_name: name }).eq('id', member.id)).error).toBeNull()
  }

  const { data, error } = await lecturer.client.from('offering_lecturers').select('lecturer_id, lecturer_name').eq('offering_id', offeringId)
  expect(error).toBeNull()
  expect(data!.toSorted((a, b) => a.lecturer_name.localeCompare(b.lecturer_name))).toEqual([
    { lecturer_id: coordinator.id, lecturer_name: 'Coordinator Seam1' },
    { lecturer_id: lecturer.id, lecturer_name: 'Lecturer Seam1' },
  ])
})

test('assigning a lecturer without a timetable sets section 4 back to Missing, and one with a timetable keeps it Pending review', async () => {
  const semester = await pickSemester()
  const [coordinator, newcomer, colleague] = [await createStaff(), await createStaff(), await createStaff()]
  const offeringId = await offer(semester, coordinator)
  // The colleague teaches another offering of the semester and has a timetable for it.
  await offer(semester, colleague)
  await uploadTimetable(colleague, semester)
  await uploadTimetable(coordinator, semester)
  expect(await timetableStatus(offeringId)).toBe('pending_review')

  const assign = async (lecturers: Staff[]) => {
    const { error } = await admin.rpc('set_offering_lecturers', {
      offering_id: offeringId,
      coordinator_id: coordinator.id,
      lecturer_ids: lecturers.map((lecturer) => lecturer.id),
    })
    expect(error).toBeNull()
  }

  await assign([newcomer])
  expect(await timetableStatus(offeringId)).toBe('missing')
  expect(await linkedTimetables(newcomer.client, offeringId)).toEqual([coordinator.id])

  await uploadTimetable(newcomer, semester)
  expect(await timetableStatus(offeringId)).toBe('pending_review')

  await assign([newcomer, colleague])
  expect(await timetableStatus(offeringId)).toBe('pending_review')
  expect(await linkedTimetables(coordinator.client, offeringId)).toEqual(sortedIds(coordinator, newcomer, colleague))
})

test('a lecturer replaces or deletes only their own timetable, after confirming the offerings that lose it', async () => {
  const [semester, otherSemester] = await twoSemesters()
  const [coordinator, lecturer] = [await createStaff(), await createStaff()]
  const shared = await offer(semester, coordinator, [lecturer])
  const own = await offer(semester, lecturer)
  await offer(otherSemester, lecturer)
  await uploadTimetable(lecturer, otherSemester, 'other.pdf')
  const coordinatorTimetable = await uploadTimetable(coordinator, semester)
  const timetable = await uploadTimetable(lecturer, semester, 'first.pdf')

  await expect(createUploadSession(lecturer.client, timetableSlot(semester), 'second.pdf')).rejects.toMatchObject({ status: 409, code: 'slot_full' })
  expect(await timetablesOf(lecturer.client, semester, [coordinator, lecturer])).toEqual(
    [
      { id: coordinatorTimetable.id, lecturer_id: coordinator.id, name: 'timetable.pdf', deletable: false },
      { id: timetable.id, lecturer_id: lecturer.id, name: 'first.pdf', deletable: true },
    ].toSorted((a, b) => (a.lecturer_id < b.lecturer_id ? -1 : 1)),
  )
  await expect(deleteSharedFile(lecturer.client, coordinatorTimetable.id)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  await expect(deleteFile(coordinator.client, timetable.id)).rejects.toMatchObject({ status: 403, code: 'forbidden' })

  // The delete warning lists the offerings of the semester that the lecturer teaches.
  const { data: warning, error } = await lecturer.client.from('files').select('linked_offerings(id)').eq('id', timetable.id).single()
  expect(error).toBeNull()
  expect(warning!.linked_offerings.map((offering: { id: string }) => offering.id).toSorted()).toEqual([shared, own].toSorted())

  await expect(deleteFile(lecturer.client, timetable.id)).rejects.toMatchObject({ status: 409, code: 'confirmation_required' })
  expect(await timetableStatus(shared)).toBe('pending_review')

  await deleteSharedFile(lecturer.client, timetable.id)
  expect(await timetableStatus(shared)).toBe('missing')
  expect(await timetableStatus(own)).toBe('missing')
  expect(await fakeStoreItems(timetableFolder(semester, lecturer))).toEqual([])
  expect(await fakeStoreItems(timetableFolder(otherSemester, lecturer))).toHaveLength(1)

  const replacement = await uploadTimetable(lecturer, semester, 'replacement.pdf')
  expect(await timetablesOf(lecturer.client, semester, [lecturer])).toEqual([
    { id: replacement.id, lecturer_id: lecturer.id, name: 'replacement.pdf', deletable: true },
  ])
  expect(await timetableStatus(shared)).toBe('pending_review')
  expect(await timetableStatus(own)).toBe('pending_review')
})

test.each(['admin', 'auditor', 'hod', 'dean', 'deputy_dean', 'root'] as const)(
  'the %s user cannot upload, record or delete a lecturer\'s timetable',
  async (role) => {
    const semester = await pickSemester()
    const lecturer = await createStaff()
    const offeringId = await offer(semester, lecturer)
    const client = await signInAs(role)
    const slot = timetableSlot(semester)
    const pending = await uploadWithoutFinalize(lecturer.client, slot, pdf('timetable.pdf'))

    await expect(createUploadSession(client, slot, 'timetable.pdf')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(finalizeUpload(client, slot, pending)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    expect(await timetableStatus(offeringId)).toBe('missing')

    const timetable = await finalizeUpload(lecturer.client, slot, pending)
    // Root reads no course files, so it does not see the timetable at all.
    const refusal = role === 'root' ? { status: 404, code: 'not_found' } : { status: 403, code: 'forbidden' }
    await expect(deleteFile(client, timetable.id)).rejects.toMatchObject(refusal)
    await expect(deleteSharedFile(client, timetable.id)).rejects.toMatchObject(refusal)
    expect(await timetablesOf(lecturer.client, semester, [lecturer])).toEqual([
      { id: timetable.id, lecturer_id: lecturer.id, name: 'timetable.pdf', deletable: true },
    ])
    expect(await fakeStoreItems(timetableFolder(semester, lecturer))).toHaveLength(1)
    expect(await timetableStatus(offeringId)).toBe('pending_review')
  },
)

test('a lecturer cannot upload a timetable for a semester they do not teach in, or record a colleague\'s upload as theirs', async () => {
  const [semester, otherSemester] = await twoSemesters()
  const [coordinator, lecturer, outsider] = [await createStaff(), await createStaff(), await createStaff()]
  const offeringId = await offer(semester, coordinator, [lecturer])
  await offer(otherSemester, outsider)
  const slot = timetableSlot(semester)

  await expect(createUploadSession(outsider.client, slot, 'timetable.pdf')).rejects.toMatchObject({ status: 403, code: 'forbidden' })

  // Finalize looks for the upload in the caller's own folder, so a colleague cannot record it.
  const pending = await uploadWithoutFinalize(coordinator.client, slot, pdf('timetable.pdf'))
  await expect(finalizeUpload(lecturer.client, slot, pending)).rejects.toMatchObject({ status: 404, code: 'not_found' })
  expect(await timetablesOf(auditor, semester, [coordinator, lecturer])).toEqual([])

  const timetable = await finalizeUpload(coordinator.client, slot, pending)
  expect(timetable).toMatchObject({ lecturer_id: coordinator.id, uploaded_by: coordinator.id })
  expect(await linkedTimetables(lecturer.client, offeringId)).toEqual([coordinator.id])
})

test('two lecturers whose emails make the same folder name each finalize only their own upload', async () => {
  const semester = await pickSemester()
  const id = randomUUID()
  const [slashed, dashed] = [await createStaff(`a/${id}@${TEST_DOMAIN}`), await createStaff(`a-${id}@${TEST_DOMAIN}`)]
  await offer(semester, slashed, [dashed])
  const slot = timetableSlot(semester)

  const pending = await uploadWithoutFinalize(slashed.client, slot, pdf('slashed.pdf'))
  await expect(finalizeUpload(dashed.client, slot, pending)).rejects.toMatchObject({ status: 404, code: 'not_found' })
  expect(await timetablesOf(auditor, semester, [slashed, dashed])).toEqual([])

  const own = await uploadTimetable(dashed, semester, 'dashed.pdf')
  const theirs = await finalizeUpload(slashed.client, slot, pending)
  expect(own).toMatchObject({ lecturer_id: dashed.id, name: 'dashed.pdf' })
  expect(theirs).toMatchObject({ lecturer_id: slashed.id, name: 'slashed.pdf' })
  expect((await fakeStoreItems(timetableFolder(semester, slashed))).map((item) => item.id)).toEqual([theirs.storage_item_id])
  expect((await fakeStoreItems(timetableFolder(semester, dashed))).map((item) => item.id)).toEqual([own.storage_item_id])
})

test('lecturers read the timetables of the lecturers they teach with, and users who read every course file read all of them', async () => {
  const semester = await pickSemester()
  const [coordinator, lecturer, other] = [await createStaff(), await createStaff(), await createStaff()]
  await offer(semester, coordinator, [lecturer])
  await offer(semester, other)
  const everyone = [coordinator, lecturer, other]
  for (const member of everyone) await uploadTimetable(member, semester)

  const lecturersRead = async (client: SupabaseClient) => (await timetablesOf(client, semester, everyone)).map((file) => file.lecturer_id)
  expect(await lecturersRead(coordinator.client)).toEqual(sortedIds(coordinator, lecturer))
  expect(await lecturersRead(lecturer.client)).toEqual(sortedIds(coordinator, lecturer))
  expect(await lecturersRead(other.client)).toEqual([other.id])
  for (const role of ['admin', 'auditor', 'hod', 'dean', 'deputy_dean'] as const) {
    expect(await lecturersRead(await signInAs(role))).toEqual(sortedIds(...everyone))
  }
  expect(await lecturersRead(await signInAs('root'))).toEqual([])

  const logOf = async (client: SupabaseClient) => {
    const { data, error } = await client
      .from('activity_log')
      .select('offering_id, semester_id, lecturer_id, section, action, actor_id, file_name')
      .in('lecturer_id', everyone.map((member) => member.id))
      .order('id')
    if (error) throw error
    return data
  }
  const uploadOf = (member: Staff) => ({
    offering_id: null,
    semester_id: semester.id,
    lecturer_id: member.id,
    section: TIMETABLE,
    action: 'upload',
    actor_id: member.id,
    file_name: 'timetable.pdf',
  })
  expect(await logOf(lecturer.client)).toEqual([uploadOf(coordinator), uploadOf(lecturer)])
  expect(await logOf(other.client)).toEqual([uploadOf(other)])
  expect(await logOf(auditor)).toEqual(everyone.map(uploadOf))
  expect(await logOf(await signInAs('root'))).toEqual([])
})

test('a lecturer who no longer teaches in the semester still reads and deletes their timetable, which no course file links', async () => {
  const semester = await pickSemester()
  const [coordinator, lecturer] = [await createStaff(), await createStaff()]
  const offeringId = await offer(semester, coordinator, [lecturer])
  const timetable = await uploadTimetable(lecturer, semester)
  expect((await admin.rpc('set_offering_lecturers', { offering_id: offeringId, coordinator_id: coordinator.id, lecturer_ids: [] })).error).toBeNull()

  const { data, error } = await lecturer.client.from('files').select('deletable, linked_offerings(id)').eq('id', timetable.id).single()
  expect(error).toBeNull()
  expect(data).toEqual({ deletable: true, linked_offerings: [] })
  expect(await timetablesOf(coordinator.client, semester, [lecturer])).toEqual([])

  await deleteSharedFile(lecturer.client, timetable.id)
  expect(await timetablesOf(auditor, semester, [lecturer])).toEqual([])
})
