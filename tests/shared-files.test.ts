import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import {
  createUploadSession,
  deleteFile,
  deleteSharedFile,
  finalizeUpload,
  sendChunks,
  uploadFile,
  type SharedSlot,
} from '../src/uploads.ts'
import { adminClient, createOffering, createUser, fakeStoreItems, semesterWithoutSharedFiles, signIn, signInAs, userIdOf } from './harness.ts'

const CALENDAR = 1
const LETTER = 3

/** A stored file's name: the upload time, an underscore, then the uploader's file name. */
const STORED_NAME = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z_`

type Semester = { id: string; code: string }
type Staff = { id: string; client: SupabaseClient }

let admin: SupabaseClient
let adminId: string

beforeAll(async () => {
  admin = await signInAs('admin')
  adminId = await userIdOf(admin)
})

async function createStaff(): Promise<Staff> {
  const user = await createUser({ roles: ['lecturer'] })
  return { id: user.id, client: await signIn(user.email, user.password) }
}

/** A new offering in the semester, coordinated by a new lecturer. */
async function offerIn(semester: Semester) {
  const coordinator = await createStaff()
  const offering = await createOffering({ coordinatorId: coordinator.id, semester })
  return { id: offering.id, coordinator }
}

/** Two semesters for shared-file tests, neither with a calendar or a letter. */
async function twoSemesters() {
  const first = await semesterWithoutSharedFiles()
  let second = await semesterWithoutSharedFiles()
  while (second.id === first.id) second = await semesterWithoutSharedFiles()
  return [first, second]
}

function pdf(name: string, size = 1024) {
  const bytes = new Uint8Array(size).fill(37)
  bytes.set(new TextEncoder().encode('%PDF-'))
  return new File([bytes], name, { type: 'application/pdf' })
}

/** The semester's folder of shared files in the storage library. */
function sharedFolder(semester: Semester) {
  return `eCourseFile/${semester.code.replace('/', '-')}/_shared`
}

/** Uploads the file to a new session and returns its stored name, without finalizing it. */
async function uploadWithoutFinalize(client: SupabaseClient, slot: SharedSlot, file: File) {
  const session = await createUploadSession(client, slot, file.name)
  await sendChunks(session.uploadUrl, file)
  return session.storedName
}

/** The status of sections 1 and 3 of the offering's course file, as this client reads them. */
async function sharedStatuses(client: SupabaseClient, offeringId: string) {
  const { data, error } = await client.rpc('section_statuses', { offering_id: offeringId })
  if (error) throw error
  const statusOf = (section: number) => data.find((row: { section: number }) => row.section === section)?.status
  return { calendar: statusOf(CALENDAR), letter: statusOf(LETTER) }
}

/** The shared files of the semester, as this client reads them, by section. */
async function sharedFilesOf(client: SupabaseClient, semester: Semester) {
  const { data, error } = await client.from('files').select('id, section, name, deletable').eq('semester_id', semester.id).order('section')
  if (error) throw error
  return data
}

test('the admin uploads the calendar and the letter of a semester, stored once in its _shared folder', async () => {
  const semester = await semesterWithoutSharedFiles()

  const calendar = await uploadFile(admin, { semesterId: semester.id, section: CALENDAR }, pdf('calendar.pdf', 2000))
  const letter = await uploadFile(admin, { semesterId: semester.id, section: LETTER }, pdf('letter.pdf', 3000))

  expect(calendar).toMatchObject({ semester_id: semester.id, offering_id: null, section: CALENDAR, name: 'calendar.pdf', size: 2000, uploaded_by: adminId })
  expect(letter).toMatchObject({ semester_id: semester.id, offering_id: null, section: LETTER, name: 'letter.pdf', size: 3000, uploaded_by: adminId })
  const folder = sharedFolder(semester)
  expect(await fakeStoreItems(folder)).toEqual([
    { id: calendar.storage_item_id, path: expect.stringMatching(new RegExp(`^${folder}/01 Academic Calendar/${STORED_NAME}calendar\\.pdf$`)), size: 2000, mime_type: 'application/pdf' },
    { id: letter.storage_item_id, path: expect.stringMatching(new RegExp(`^${folder}/03 Appointment Letter/${STORED_NAME}letter\\.pdf$`)), size: 3000, mime_type: 'application/pdf' },
  ])
  expect(await sharedFilesOf(admin, semester)).toEqual([
    { id: calendar.id, section: CALENDAR, name: 'calendar.pdf', deletable: true },
    { id: letter.id, section: LETTER, name: 'letter.pdf', deletable: true },
  ])
})

test.each(['lecturer', 'auditor', 'hod', 'dean', 'deputy_dean', 'root'] as const)(
  'the %s user cannot upload or delete the calendar or the letter',
  async (role) => {
    const semester = await semesterWithoutSharedFiles()
    // The lecturer teaches in the semester, so the calendar and letter are in their course file.
    const client = role === 'lecturer' ? (await offerIn(semester)).coordinator.client : await signInAs(role)
    const calendarSlot = { semesterId: semester.id, section: CALENDAR }
    const pending = await uploadWithoutFinalize(admin, calendarSlot, pdf('calendar.pdf'))

    for (const section of [CALENDAR, LETTER]) {
      await expect(createUploadSession(client, { semesterId: semester.id, section }, 'mine.pdf')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    }
    await expect(finalizeUpload(client, calendarSlot, pending)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    expect(await sharedFilesOf(admin, semester)).toEqual([])

    const calendar = await finalizeUpload(admin, calendarSlot, pending)
    const letter = await uploadFile(admin, { semesterId: semester.id, section: LETTER }, pdf('letter.pdf'))
    // Root reads no course files, so it does not see the files at all.
    const refusal = role === 'root' ? { status: 404, code: 'not_found' } : { status: 403, code: 'forbidden' }
    for (const file of [calendar, letter]) {
      await expect(deleteFile(client, file.id)).rejects.toMatchObject(refusal)
      await expect(deleteSharedFile(client, file.id)).rejects.toMatchObject(refusal)
    }
    expect((await sharedFilesOf(admin, semester)).map((file) => file.id)).toEqual([calendar.id, letter.id])
    expect(await fakeStoreItems(sharedFolder(semester))).toHaveLength(2)
  },
)

test('a semester holds one calendar and one letter, and a new one goes up once the old one is deleted', async () => {
  const semester = await semesterWithoutSharedFiles()
  const calendarSlot = { semesterId: semester.id, section: CALENDAR }
  const first = await uploadWithoutFinalize(admin, calendarSlot, pdf('first.pdf'))
  const second = await uploadWithoutFinalize(admin, calendarSlot, pdf('second.pdf'))

  const calendar = await finalizeUpload(admin, calendarSlot, first)
  expect(await finalizeUpload(admin, calendarSlot, first)).toEqual(calendar)
  await expect(finalizeUpload(admin, calendarSlot, second)).rejects.toMatchObject({ status: 409, code: 'slot_full' })
  await expect(createUploadSession(admin, calendarSlot, 'third.pdf')).rejects.toMatchObject({ status: 409, code: 'slot_full' })
  const letter = await uploadFile(admin, { semesterId: semester.id, section: LETTER }, pdf('letter.pdf'))
  expect((await fakeStoreItems(sharedFolder(semester))).map((item) => item.id)).toEqual([calendar.storage_item_id, letter.storage_item_id])

  await deleteSharedFile(admin, calendar.id)
  const replacement = await uploadFile(admin, calendarSlot, pdf('replacement.pdf'))
  expect((await sharedFilesOf(admin, semester)).map((file) => file.name)).toEqual(['replacement.pdf', 'letter.pdf'])
  expect((await fakeStoreItems(sharedFolder(semester))).map((item) => item.id).toSorted()).toEqual(
    [replacement.storage_item_id, letter.storage_item_id].toSorted(),
  )
})

test('a shared file names a semester and a shared-file section, and no offering, item or slot', async () => {
  const semester = await semesterWithoutSharedFiles()
  const { id: offeringId } = await offerIn(semester)

  for (const slot of [
    { semesterId: semester.id, section: 2 },
    { semesterId: semester.id, section: 5 },
    { semesterId: 'not-a-uuid', section: CALENDAR },
    { semesterId: semester.id, section: CALENDAR, offeringId },
    { semesterId: semester.id, section: CALENDAR, item: 1 },
    { semesterId: semester.id, section: CALENDAR, slot: 'question' },
  ]) {
    await expect(createUploadSession(admin, slot, 'calendar.pdf')).rejects.toMatchObject({ status: 400, code: 'invalid_request' })
  }
  await expect(createUploadSession(admin, { semesterId: crypto.randomUUID(), section: CALENDAR }, 'calendar.pdf')).rejects.toMatchObject({
    status: 403,
    code: 'forbidden',
  })
  // Staff upload to a course file's own sections, never to the shared ones.
  await expect(createUploadSession(admin, { offeringId, section: CALENDAR }, 'calendar.pdf')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
})

test('every offering of the semester links its calendar and letter, Pending review, and offerings of other semesters do not', async () => {
  const [semester, otherSemester] = await twoSemesters()
  const first = await offerIn(semester)
  const second = await offerIn(semester)
  const other = await offerIn(otherSemester)
  const missing = { calendar: 'missing', letter: 'missing' }
  for (const offering of [first, second, other]) {
    expect(await sharedStatuses(offering.coordinator.client, offering.id)).toEqual(missing)
  }

  await uploadFile(admin, { semesterId: semester.id, section: CALENDAR }, pdf('calendar.pdf'))
  for (const offering of [first, second]) {
    expect(await sharedStatuses(offering.coordinator.client, offering.id)).toEqual({ calendar: 'pending_review', letter: 'missing' })
  }

  await uploadFile(admin, { semesterId: semester.id, section: LETTER }, pdf('letter.pdf'))
  const later = await offerIn(semester)
  const auditor = await signInAs('auditor')
  for (const offering of [first, second, later]) {
    expect(await sharedStatuses(offering.coordinator.client, offering.id)).toEqual({ calendar: 'pending_review', letter: 'pending_review' })
    expect(await sharedStatuses(auditor, offering.id)).toEqual({ calendar: 'pending_review', letter: 'pending_review' })
    const { data, error } = await offering.coordinator.client.from('offerings').select('linked_files(section, name)').eq('id', offering.id).single()
    expect(error).toBeNull()
    expect(data!.linked_files.toSorted((a, b) => a.section - b.section)).toEqual([
      { section: CALENDAR, name: 'calendar.pdf' },
      { section: LETTER, name: 'letter.pdf' },
    ])
  }
  expect(await sharedStatuses(other.coordinator.client, other.id)).toEqual(missing)
})

test('the lecturers of a semester and users who read every course file read its shared files, and other lecturers and root do not', async () => {
  const [semester, otherSemester] = await twoSemesters()
  const teaching = await offerIn(semester)
  const elsewhere = await offerIn(otherSemester)
  const calendar = await uploadFile(admin, { semesterId: semester.id, section: CALENDAR }, pdf('calendar.pdf'))
  const readable = [{ id: calendar.id, section: CALENDAR, name: 'calendar.pdf', deletable: false }]

  expect(await sharedFilesOf(teaching.coordinator.client, semester)).toEqual(readable)
  for (const role of ['auditor', 'hod', 'dean', 'deputy_dean'] as const) {
    expect(await sharedFilesOf(await signInAs(role), semester)).toEqual(readable)
  }
  expect(await sharedFilesOf(elsewhere.coordinator.client, semester)).toEqual([])
  expect(await sharedFilesOf(await signInAs('root'), semester)).toEqual([])
})

test('deleting a shared file needs confirmation, lists the offerings that link it, and leaves their section Missing', async () => {
  const [semester, otherSemester] = await twoSemesters()
  const first = await offerIn(semester)
  const second = await offerIn(semester)
  await offerIn(otherSemester)
  const calendar = await uploadFile(admin, { semesterId: semester.id, section: CALENDAR }, pdf('calendar.pdf'))
  await uploadFile(admin, { semesterId: semester.id, section: LETTER }, pdf('letter.pdf'))

  const { data: warning, error } = await admin.from('files').select('linked_offerings(id)').eq('id', calendar.id).single()
  expect(error).toBeNull()
  const { data: semesterOfferings } = await adminClient().from('offerings').select('id').eq('semester_id', semester.id)
  const linked = warning!.linked_offerings.map((offering: { id: string }) => offering.id).toSorted()
  expect(linked).toEqual(semesterOfferings!.map((offering) => offering.id).toSorted())
  expect(linked).toEqual(expect.arrayContaining([first.id, second.id]))

  await expect(deleteFile(admin, calendar.id)).rejects.toMatchObject({ status: 409, code: 'confirmation_required' })
  expect((await sharedFilesOf(admin, semester)).map((file) => file.name)).toEqual(['calendar.pdf', 'letter.pdf'])
  expect(await sharedStatuses(first.coordinator.client, first.id)).toEqual({ calendar: 'pending_review', letter: 'pending_review' })

  await deleteSharedFile(admin, calendar.id)
  expect((await sharedFilesOf(admin, semester)).map((file) => file.name)).toEqual(['letter.pdf'])
  expect((await fakeStoreItems(sharedFolder(semester))).map((item) => item.path)).toEqual([
    expect.stringContaining('/03 Appointment Letter/'),
  ])
  for (const offering of [first, second]) {
    expect(await sharedStatuses(offering.coordinator.client, offering.id)).toEqual({ calendar: 'missing', letter: 'pending_review' })
  }
})

test('uploads and deletes of shared files are logged for the semester, and its readers read the log', async () => {
  const [semester, otherSemester] = await twoSemesters()
  const teaching = await offerIn(semester)
  const elsewhere = await offerIn(otherSemester)
  // Earlier tests and runs logged their own uploads and deletes for the semester.
  const { data: earlier } = await adminClient().from('activity_log').select('id').order('id', { ascending: false }).limit(1)
  const after = earlier![0]?.id ?? 0

  const calendar = await uploadFile(admin, { semesterId: semester.id, section: CALENDAR }, pdf('calendar.pdf'))
  await uploadFile(admin, { semesterId: semester.id, section: LETTER }, pdf('letter.pdf'))
  await deleteSharedFile(admin, calendar.id)

  const logOf = async (client: SupabaseClient) => {
    const { data, error } = await client
      .from('activity_log')
      .select('offering_id, section, action, actor_id, file_name')
      .eq('semester_id', semester.id)
      .gt('id', after)
      .order('id')
    if (error) throw error
    return data
  }
  const expected = [
    { offering_id: null, section: CALENDAR, action: 'upload', actor_id: adminId, file_name: 'calendar.pdf' },
    { offering_id: null, section: LETTER, action: 'upload', actor_id: adminId, file_name: 'letter.pdf' },
    { offering_id: null, section: CALENDAR, action: 'delete', actor_id: adminId, file_name: 'calendar.pdf' },
  ]
  expect(await logOf(teaching.coordinator.client)).toEqual(expected)
  expect(await logOf(await signInAs('auditor'))).toEqual(expected)
  expect(await logOf(elsewhere.coordinator.client)).toEqual([])
  expect(await logOf(await signInAs('root'))).toEqual([])
})
