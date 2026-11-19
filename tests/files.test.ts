import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PDFDocument, PDFName } from 'pdf-lib'
import { beforeAll, expect, test } from 'vitest'
import { numberedPdf, readPdf } from '../src/pdf/fixtures.ts'
import {
  createUploadSession,
  deleteFile,
  finalizeUpload,
  sendChunks,
  uploadFile,
  type FileRecord,
  type Slot,
} from '../src/uploads.ts'
import { adminClient, createOffering, createUser, fakeStoreItems, signIn, signInAs } from './harness.ts'

const PERMISSION_DENIED = '42501'
const TEACHING_PLAN = 2
const LECTURE_NOTES = 10

/** 20 MB, the largest file the platform takes. */
const MAX_BYTES = 20 * 1024 * 1024

/** A stored file's name: the upload time, an underscore, then the uploader's file name. */
const STORED_NAME = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z_`

type Staff = { id: string; client: SupabaseClient }

/**
 * An offering with a coordinator, two lecturers, and a lecturer who teaches another offering. slot
 * and folder are its Teaching Plan's, and root is the course file's folder.
 */
type Course = { slot: Slot; root: string; folder: string; coordinator: Staff; lecturer: Staff; secondLecturer: Staff; outsider: Staff }

let auditor: SupabaseClient

beforeAll(async () => {
  auditor = await signInAs('auditor')
})

async function createStaff(): Promise<Staff> {
  const user = await createUser({ roles: ['lecturer'] })
  return { id: user.id, client: await signIn(user.email, user.password) }
}

/** A course whose course type has sectionsOn on, by default sections 10 and 12. */
async function createCourse(sectionsOn?: number[]): Promise<Course> {
  const [coordinator, lecturer, secondLecturer, outsider] = await Promise.all([createStaff(), createStaff(), createStaff(), createStaff()])
  const offering = await createOffering({ coordinatorId: coordinator.id, lecturerIds: [lecturer.id, secondLecturer.id], sectionsOn })
  await createOffering({ coordinatorId: outsider.id })
  const root = `eCourseFile/${offering.semesterCode.replace('/', '-')}/${offering.course.code} ${offering.course.title}`
  const slot = { offeringId: offering.id, section: TEACHING_PLAN }
  return { slot, root, folder: `${root}/02 Teaching Plan`, coordinator, lecturer, secondLecturer, outsider }
}

/** The bytes every PDF starts with. */
const PDF_START = new TextEncoder().encode('%PDF-')

/** size bytes that start like a PDF. */
function pdfBytes(size: number, byteAt = (_: number) => 37) {
  const bytes = Uint8Array.from({ length: size }, (_, i) => byteAt(i))
  bytes.set(PDF_START)
  return bytes
}

function pdf(name: string, size = 1024) {
  return new File([pdfBytes(size)], name, { type: 'application/pdf' })
}

/** The slot's files as this client reads them, in their order. */
async function filesOf(client: SupabaseClient, slot: Slot) {
  const query = client.from('files').select('id, name, deletable').eq('offering_id', slot.offeringId).eq('section', slot.section)
  const { data, error } = await (slot.slot ? query.eq('slot', slot.slot) : query.is('slot', null))
    .order('position')
    .order('uploaded_at')
  if (error) throw error
  return data as { id: string; name: string; deletable: boolean }[]
}

/** The status of the slot's section, as this client reads it. */
async function sectionStatus(client: SupabaseClient, slot: Slot) {
  const { data, error } = await client.rpc('section_statuses', { offering_id: slot.offeringId })
  if (error) throw error
  return data.find((row: { section: number }) => row.section === slot.section)?.status
}

/** Uploads the bytes to a new session and returns its stored name, without finalizing it. */
async function uploadWithoutFinalize(client: SupabaseClient, slot: Slot, name: string, bytes: Blob) {
  const session = await createUploadSession(client, slot, name)
  await sendChunks(session.uploadUrl, bytes)
  return session.storedName
}

test.each(['coordinator', 'lecturer'] as const)('the %s uploads a PDF to Teaching Plan, stored at the spec path with a timestamp', async (role) => {
  const course = await createCourse()
  const uploader = course[role]

  const file = await uploadFile(uploader.client, course.slot, pdf('Teaching Plan.pdf', 3000))

  expect(file).toMatchObject({ name: 'Teaching Plan.pdf', size: 3000, uploaded_by: uploader.id })
  const items = await fakeStoreItems(course.folder)
  expect(items).toEqual([{ id: file.storage_item_id, path: expect.any(String), size: 3000, mime_type: 'application/pdf' }])
  expect(items[0].path).toMatch(new RegExp(`/02 Teaching Plan/${STORED_NAME}Teaching Plan\\.pdf$`))
  expect(await filesOf(course.coordinator.client, course.slot)).toEqual([{ id: file.id, name: 'Teaching Plan.pdf', deletable: true }])
})

test('a file larger than one chunk is stored byte for byte', async () => {
  const course = await createCourse()
  const bytes = pdfBytes(6 * 1024 * 1024 + 7, (i) => (i * 7 + (i >> 13)) & 255)

  const file = await uploadFile(course.lecturer.client, course.slot, new File([bytes], 'plan.pdf', { type: 'application/pdf' }))

  const { data, error } = await adminClient().schema('fake_storage').from('items').select('content').eq('id', file.storage_item_id).single()
  expect(error).toBeNull()
  expect(data!.content).toBe(`\\x${Buffer.from(bytes).toString('hex')}`)
})

test.each(['outsider', 'auditor', 'admin', 'hod', 'dean', 'deputy_dean', 'root'] as const)(
  'the %s user cannot upload to Teaching Plan or finalize an upload there',
  async (role) => {
    const course = await createCourse()
    const client = role === 'outsider' ? course.outsider.client : await signInAs(role)
    const pending = await uploadWithoutFinalize(course.lecturer.client, course.slot, 'plan.pdf', pdf('plan.pdf'))

    await expect(createUploadSession(client, course.slot, 'mine.pdf')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(finalizeUpload(client, course.slot, pending)).rejects.toMatchObject({ status: 403, code: 'forbidden' })

    expect((await fakeStoreItems(course.folder)).map((item) => item.path)).toEqual([`${course.folder}/${pending}`])
    expect(await filesOf(adminClient(), course.slot)).toEqual([])
    expect((await finalizeUpload(course.lecturer.client, course.slot, pending)).name).toBe('plan.pdf')
  },
)

test('staff cannot upload to the shared-file sections or the switchable sections after Lecture Notes', async () => {
  const course = await createCourse([10, 11, 12, 13, 14, 15, 16])

  for (const section of [1, 3, 4, 5, 11, 12, 13, 14, 15, 16]) {
    await expect(
      createUploadSession(course.coordinator.client, { ...course.slot, section }, 'plan.pdf'),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  }
})

test.each([
  { section: 6, folder: '06 Attendance Record' },
  { section: 7, folder: '07 Replacement Notices' },
  { section: 8, folder: '08 Proof of Absence' },
  { section: 9, folder: '09 Warning Letters' },
  { section: 17, folder: '17 Week 12 Marks' },
  { section: 18, folder: '18 Grade List' },
  { section: 19, slot: 'cqi', folder: '19 LO-PO Analysis/CQI' },
])('section $section takes uploads, reorders and deletes by the Teaching Plan rules, stored in $folder', async ({ section, slot, folder }) => {
  const course = await createCourse()
  const target = { ...course.slot, section, slot }
  const pending = await uploadWithoutFinalize(course.lecturer.client, target, 'pending.pdf', pdf('pending.pdf'))
  for (const client of [course.outsider.client, auditor]) {
    await expect(createUploadSession(client, target, 'mine.pdf')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(finalizeUpload(client, target, pending)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  }

  const first = await uploadFile(course.lecturer.client, target, pdf('a.pdf'))
  const second = await uploadFile(course.coordinator.client, target, pdf('b.pdf'))
  const third = await finalizeUpload(course.lecturer.client, target, pending)
  // Stored names start with the time the upload session opened, so the pending upload comes first.
  expect((await fakeStoreItems(`${course.root}/${folder}`)).map((item) => item.path)).toEqual(
    [third, first, second].map((file) => expect.stringMatching(new RegExp(`^${course.root}/${folder}/${STORED_NAME}${file.name}$`))),
  )
  expect(await filesOf(adminClient(), course.slot)).toEqual([])

  expect((await course.outsider.client.rpc('reorder_files', { file_ids: [third.id, first.id, second.id] })).error?.code).toBe(PERMISSION_DENIED)
  expect((await course.secondLecturer.client.rpc('reorder_files', { file_ids: [third.id, first.id, second.id] })).error).toBeNull()
  expect(await filesOf(auditor, target)).toEqual([
    { id: third.id, name: 'pending.pdf', deletable: false },
    { id: first.id, name: 'a.pdf', deletable: false },
    { id: second.id, name: 'b.pdf', deletable: false },
  ])

  await expect(deleteFile(course.secondLecturer.client, first.id)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  await deleteFile(course.lecturer.client, first.id)
  await deleteFile(course.coordinator.client, second.id)
  expect((await filesOf(course.lecturer.client, target)).map((file) => file.name)).toEqual(['pending.pdf'])
  expect((await fakeStoreItems(`${course.root}/${folder}`)).map((item) => item.id)).toEqual([third.storage_item_id])
})

test.each([
  { section: 6, empty: 'missing' },
  { section: 7, empty: 'empty' },
  { section: 8, empty: 'empty' },
  { section: 9, empty: 'empty' },
  { section: 17, empty: 'missing' },
  { section: 18, empty: 'missing' },
  { section: 19, slot: 'lo_po_evaluation', empty: 'missing' },
])('section $section is $empty without files and Pending review with files', async ({ section, slot, empty }) => {
  const course = await createCourse()
  const statuses = async () => (await course.lecturer.client.rpc('section_statuses', { offering_id: course.slot.offeringId })).data
  const before = await statuses()
  expect(before[section - 1]).toEqual({ section, status: empty })

  const first = await uploadFile(course.lecturer.client, { ...course.slot, section, slot }, pdf('a.pdf'))
  const second = await uploadFile(course.lecturer.client, { ...course.slot, section, slot }, pdf('b.pdf'))
  const withFiles = before.map((row: { section: number }) => (row.section === section ? { section, status: 'pending_review' } : row))
  expect(await statuses()).toEqual(withFiles)

  await deleteFile(course.coordinator.client, first.id)
  expect(await statuses()).toEqual(withFiles)
  await deleteFile(course.coordinator.client, second.id)
  expect(await statuses()).toEqual(before)
})

test('each of the four LO/PO Analysis slots holds its own files, in its own folder and order', async () => {
  const course = await createCourse()
  const slotOf = (slot: string) => ({ ...course.slot, section: 19, slot })
  const upload = (slot: string, name: string) => uploadFile(course.lecturer.client, slotOf(slot), pdf(name))
  const po = [await upload('po_achievement', 'po 1.pdf'), await upload('cqi', 'cqi.pdf'), await upload('po_achievement', 'po 2.pdf')]
  await upload('lo_achievement', 'lo.pdf')
  await upload('lo_po_evaluation', 'evaluation.pdf')

  const stored = async (title: string) => (await fakeStoreItems(`${course.root}/19 LO-PO Analysis/${title}`)).map((item) => item.path.split('_').pop())
  expect(await stored('PO Achievement')).toEqual(['po 1.pdf', 'po 2.pdf'])
  expect(await stored('LO Achievement')).toEqual(['lo.pdf'])
  expect(await stored('LO-PO Evaluation')).toEqual(['evaluation.pdf'])
  expect(await stored('CQI')).toEqual(['cqi.pdf'])

  const names = async (slot: string) => (await filesOf(auditor, slotOf(slot))).map((file) => file.name)
  expect(await names('po_achievement')).toEqual(['po 1.pdf', 'po 2.pdf'])
  expect(await names('lo_achievement')).toEqual(['lo.pdf'])
  expect(await names('lo_po_evaluation')).toEqual(['evaluation.pdf'])
  expect(await names('cqi')).toEqual(['cqi.pdf'])

  const [first, cqi, second] = po
  expect((await course.coordinator.client.rpc('reorder_files', { file_ids: [cqi.id, first.id] })).error?.code).toBe(PERMISSION_DENIED)
  expect((await course.coordinator.client.rpc('reorder_files', { file_ids: [second.id, first.id] })).error).toBeNull()
  expect(await names('po_achievement')).toEqual(['po 2.pdf', 'po 1.pdf'])
  await upload('po_achievement', 'po 3.pdf')
  expect(await names('po_achievement')).toEqual(['po 2.pdf', 'po 1.pdf', 'po 3.pdf'])
  expect(await names('cqi')).toEqual(['cqi.pdf'])
})

test('a file goes into section 19 only through one of its slots, and finalizes only in the slot it was uploaded to', async () => {
  const course = await createCourse()
  const loPo = { ...course.slot, section: 19 }

  for (const target of [loPo, { ...loPo, slot: 'PO Achievement' }, { ...loPo, slot: 'grades' }, { ...course.slot, slot: 'cqi' }]) {
    await expect(createUploadSession(course.lecturer.client, target, 'a.pdf')).rejects.toMatchObject({ status: 400, code: 'invalid_request' })
  }

  const pending = await uploadWithoutFinalize(course.lecturer.client, { ...loPo, slot: 'cqi' }, 'cqi.pdf', pdf('cqi.pdf'))
  await expect(finalizeUpload(course.lecturer.client, { ...loPo, slot: 'po_achievement' }, pending)).rejects.toMatchObject({
    status: 404,
    code: 'not_found',
  })
  await expect(finalizeUpload(course.lecturer.client, loPo, pending)).rejects.toMatchObject({ status: 400, code: 'invalid_request' })
  expect((await finalizeUpload(course.lecturer.client, { ...loPo, slot: 'cqi' }, pending)).slot).toBe('cqi')
})

test('the browser refuses a non-PDF and a file over 20 MB before it uploads anything', async () => {
  const course = await createCourse()
  const docx = new File(['plan'], 'plan.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })

  await expect(uploadFile(course.lecturer.client, course.slot, docx)).rejects.toMatchObject({ code: 'not_pdf', status: null })
  await expect(uploadFile(course.lecturer.client, course.slot, pdf('big.pdf', MAX_BYTES + 1))).rejects.toMatchObject({
    code: 'too_large',
    status: null,
  })

  expect(await fakeStoreItems(course.folder)).toEqual([])
})

test('an upload session is refused for a file name that does not end in .pdf', async () => {
  const course = await createCourse()

  for (const name of ['plan.docx', 'plan', 'plan.pdf.exe', 'plan.pdfx']) {
    await expect(createUploadSession(course.lecturer.client, course.slot, name)).rejects.toMatchObject({ status: 422, code: 'not_pdf' })
  }
  const session = await createUploadSession(course.lecturer.client, course.slot, 'PLAN.PDF')
  await sendChunks(session.uploadUrl, pdf('PLAN.PDF'))
  expect((await finalizeUpload(course.lecturer.client, course.slot, session.storedName)).name).toBe('PLAN.PDF')
})

test.each([
  ['a non-PDF named .pdf', 'plan.pdf', new TextEncoder().encode('PK\u0003\u0004 a zipped document'), 'not_pdf'],
  ['a non-PDF with part of the PDF signature', 'plan.pdf', new TextEncoder().encode('%PDF'), 'not_pdf'],
  ['a file over 20 MB', 'big.pdf', new Uint8Array(MAX_BYTES + 1), 'too_large'],
] as const)('finalize refuses %s that skipped the browser check, and deletes it from storage', async (_, name, bytes, code) => {
  const course = await createCourse()
  const storedName = await uploadWithoutFinalize(course.lecturer.client, course.slot, name, new Blob([bytes]))
  expect((await fakeStoreItems(course.folder)).map((item) => item.size)).toEqual([bytes.length])

  await expect(finalizeUpload(course.lecturer.client, course.slot, storedName)).rejects.toMatchObject({ status: 422, code })

  expect(await fakeStoreItems(course.folder)).toEqual([])
  expect(await filesOf(course.coordinator.client, course.slot)).toEqual([])
  expect(await sectionStatus(course.coordinator.client, course.slot)).toBe('missing')
})

test('a file of exactly 20 MB is accepted', async () => {
  const course = await createCourse()

  const file = await uploadFile(course.lecturer.client, course.slot, pdf('full.pdf', MAX_BYTES))

  expect(file.size).toBe(MAX_BYTES)
  expect((await fakeStoreItems(course.folder)).map((item) => item.size)).toEqual([MAX_BYTES])
})

test('finalize without an upload is refused, and finalizing twice records the file once', async () => {
  const course = await createCourse()
  const missing = '2026-01-01T00-00-00.000Z_plan.pdf'
  await expect(finalizeUpload(course.lecturer.client, course.slot, missing)).rejects.toMatchObject({ status: 404, code: 'not_found' })

  const storedName = await uploadWithoutFinalize(course.lecturer.client, course.slot, 'plan.pdf', pdf('plan.pdf'))
  const first = await finalizeUpload(course.lecturer.client, course.slot, storedName)
  const second = await finalizeUpload(course.lecturer.client, course.slot, storedName)

  expect(second).toEqual(first)
  expect(await filesOf(course.coordinator.client, course.slot)).toEqual([{ id: first.id, name: 'plan.pdf', deletable: true }])
  const log = await adminClient().from('activity_log').select('action').eq('offering_id', course.slot.offeringId)
  expect(log.data).toEqual([{ action: 'upload' }])
})

test('staff cannot record or remove files without the files function', async () => {
  const course = await createCourse()
  const file = await uploadFile(course.coordinator.client, course.slot, pdf('plan.pdf'))
  const client = course.coordinator.client
  const record = { offering_id: course.slot.offeringId, section: TEACHING_PLAN, slot: null, storage_item_id: 'forged', name: 'forged.pdf', size: 1 }

  expect((await client.rpc('add_file', { ...record, uploaded_by: course.coordinator.id })).error?.code).toBe(PERMISSION_DENIED)
  expect((await client.from('files').insert({ ...record, position: 9, uploaded_by: course.coordinator.id })).error?.code).toBe(PERMISSION_DENIED)
  expect((await client.rpc('remove_file', { file_id: file.id, actor_id: course.coordinator.id })).error?.code).toBe(PERMISSION_DENIED)
  await client.from('files').delete().eq('id', file.id)
  await client.from('files').update({ name: 'renamed.pdf' }).eq('id', file.id)

  expect(await filesOf(adminClient(), course.slot)).toEqual([{ id: file.id, name: 'plan.pdf', deletable: false }])
  expect((await fakeStoreItems(course.folder)).map((item) => item.id)).toEqual([file.storage_item_id])
})

test('several files keep the order staff set, and new files go last', async () => {
  const course = await createCourse()
  const names = (files: { name: string }[]) => files.map((file) => file.name)
  const uploaded: FileRecord[] = []
  for (const name of ['week 1-7.pdf', 'week 8-14.pdf', 'assessment.pdf']) {
    uploaded.push(await uploadFile(course.lecturer.client, course.slot, pdf(name)))
  }
  expect(names(await filesOf(course.coordinator.client, course.slot))).toEqual(['week 1-7.pdf', 'week 8-14.pdf', 'assessment.pdf'])

  const [first, second, third] = uploaded
  const { error } = await course.secondLecturer.client.rpc('reorder_files', { file_ids: [third.id, first.id, second.id] })
  expect(error).toBeNull()
  expect(names(await filesOf(course.coordinator.client, course.slot))).toEqual(['assessment.pdf', 'week 1-7.pdf', 'week 8-14.pdf'])
  expect(names(await filesOf(auditor, course.slot))).toEqual(['assessment.pdf', 'week 1-7.pdf', 'week 8-14.pdf'])

  await uploadFile(course.coordinator.client, course.slot, pdf('errata.pdf'))
  expect(names(await filesOf(course.lecturer.client, course.slot))).toEqual([
    'assessment.pdf',
    'week 1-7.pdf',
    'week 8-14.pdf',
    'errata.pdf',
  ])
})

test('only staff of the offering reorder its files, one section at a time', async () => {
  const course = await createCourse()
  const other = await createCourse()
  const [first, second] = [
    await uploadFile(course.lecturer.client, course.slot, pdf('a.pdf')),
    await uploadFile(course.lecturer.client, course.slot, pdf('b.pdf')),
  ]
  const elsewhere = await uploadFile(other.lecturer.client, other.slot, pdf('c.pdf'))

  for (const client of [course.outsider.client, auditor, await signInAs('admin')]) {
    const { error } = await client.rpc('reorder_files', { file_ids: [second.id, first.id] })
    expect(error?.code).toBe(PERMISSION_DENIED)
  }
  const mixed = await other.lecturer.client.rpc('reorder_files', { file_ids: [elsewhere.id, second.id, first.id] })
  expect(mixed.error?.code).toBe(PERMISSION_DENIED)

  expect((await filesOf(course.coordinator.client, course.slot)).map((file) => file.name)).toEqual(['a.pdf', 'b.pdf'])
})

test('the uploader or the coordinator can delete a file, and other lecturers cannot', async () => {
  const course = await createCourse()
  const [mine, other] = [
    await uploadFile(course.lecturer.client, course.slot, pdf('mine.pdf')),
    await uploadFile(course.lecturer.client, course.slot, pdf('other.pdf')),
  ]
  expect((await filesOf(course.secondLecturer.client, course.slot)).map((file) => file.deletable)).toEqual([false, false])
  expect((await filesOf(course.lecturer.client, course.slot)).map((file) => file.deletable)).toEqual([true, true])
  expect((await filesOf(course.coordinator.client, course.slot)).map((file) => file.deletable)).toEqual([true, true])

  await expect(deleteFile(course.secondLecturer.client, mine.id)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  await expect(deleteFile(auditor, mine.id)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  await expect(deleteFile(course.outsider.client, mine.id)).rejects.toMatchObject({ status: 404, code: 'not_found' })
  expect((await fakeStoreItems(course.folder)).map((item) => item.id).toSorted()).toEqual(
    [mine.storage_item_id, other.storage_item_id].toSorted(),
  )

  await deleteFile(course.lecturer.client, mine.id)
  await deleteFile(course.coordinator.client, other.id)

  expect(await fakeStoreItems(course.folder)).toEqual([])
  expect(await filesOf(adminClient(), course.slot)).toEqual([])
})

test('Teaching Plan goes from Missing to Pending review, and back to Missing when its last file is deleted', async () => {
  const course = await createCourse()
  const statuses = async () => (await course.coordinator.client.rpc('section_statuses', { offering_id: course.slot.offeringId })).data
  const missing = await statuses()
  expect(missing[TEACHING_PLAN - 1]).toEqual({ section: TEACHING_PLAN, status: 'missing' })
  const withTeachingPlan = (status: string) => missing.map((row: { section: number }) => (row.section === TEACHING_PLAN ? { ...row, status } : row))

  const first = await uploadFile(course.lecturer.client, course.slot, pdf('a.pdf'))
  expect(await statuses()).toEqual(withTeachingPlan('pending_review'))
  expect(await sectionStatus(auditor, course.slot)).toBe('pending_review')

  const second = await uploadFile(course.coordinator.client, course.slot, pdf('b.pdf'))
  await deleteFile(course.coordinator.client, first.id)
  expect(await statuses()).toEqual(withTeachingPlan('pending_review'))

  await deleteFile(course.coordinator.client, second.id)
  expect(await statuses()).toEqual(missing)
})

test('each upload and delete adds an activity log entry that only readers of the offering read, and nobody changes', async () => {
  const course = await createCourse()
  const first = await uploadFile(course.lecturer.client, course.slot, pdf('a.pdf'))
  await uploadFile(course.coordinator.client, course.slot, pdf('b.pdf'))
  await deleteFile(course.coordinator.client, first.id)

  const expected = [
    { section: TEACHING_PLAN, action: 'upload', actor_id: course.lecturer.id, file_name: 'a.pdf' },
    { section: TEACHING_PLAN, action: 'upload', actor_id: course.coordinator.id, file_name: 'b.pdf' },
    { section: TEACHING_PLAN, action: 'delete', actor_id: course.coordinator.id, file_name: 'a.pdf' },
  ]
  const logOf = async (client: SupabaseClient) => {
    const { data, error } = await client
      .from('activity_log')
      .select('section, action, actor_id, file_name')
      .eq('offering_id', course.slot.offeringId)
      .order('id')
    if (error) throw error
    return data
  }
  expect(await logOf(course.lecturer.client)).toEqual(expected)
  expect(await logOf(auditor)).toEqual(expected)
  expect(await logOf(course.outsider.client)).toEqual([])
  expect(await logOf(await signInAs('root'))).toEqual([])

  for (const client of [course.coordinator.client, adminClient()]) {
    const update = await client.from('activity_log').update({ file_name: 'changed.pdf' }).eq('offering_id', course.slot.offeringId)
    expect(update.error?.code).toBe(PERMISSION_DENIED)
    const removal = await client.from('activity_log').delete().eq('offering_id', course.slot.offeringId)
    expect(removal.error?.code).toBe(PERMISSION_DENIED)
  }
  expect(await logOf(course.lecturer.client)).toEqual(expected)
})

test('staff read the name of the uploader of each file in their offering', async () => {
  const course = await createCourse()
  const fullName = `Coordinator ${crypto.randomUUID()}`
  expect((await adminClient().from('profiles').update({ full_name: fullName }).eq('id', course.coordinator.id)).error).toBeNull()
  await uploadFile(course.coordinator.client, course.slot, pdf('plan.pdf'))

  const { data } = await course.lecturer.client.from('files').select('uploader_name').eq('offering_id', course.slot.offeringId)

  expect(data).toEqual([{ uploader_name: fullName }])
})

/** A PDF of count numbered 16:9 slides, as lecture notes are exported. */
async function slides(name: string, count: number) {
  return new File([await numberedPdf(count)], name, { type: 'application/pdf' })
}

/** The stored PDF of the file, as a viewer shows it. */
async function storedPdf(file: FileRecord) {
  const { data, error } = await adminClient().schema('fake_storage').from('items').select('content').eq('id', file.storage_item_id).single()
  if (error) throw error
  return readPdf(Buffer.from(data.content.slice(2), 'hex'))
}

/** The numbers of the source pages that the merged page shows, in ascending order. */
function pagesOn(sheet: { texts: { text: string }[] }) {
  return sheet.texts.flatMap(({ text }) => (text.startsWith('Page ') ? [Number(text.slice(5))] : [])).toSorted((a, b) => a - b)
}

test('a Lecture Notes upload is merged 8 slides to an A4 page before upload, and only the merged PDF is stored', async () => {
  const course = await createCourse()
  const notes = { ...course.slot, section: LECTURE_NOTES }

  const file = await uploadFile(course.lecturer.client, notes, await slides('Chapter 1.pdf', 19))

  expect(await fakeStoreItems(`${course.root}/10 Lecture Notes`)).toEqual([
    {
      id: file.storage_item_id,
      path: expect.stringMatching(new RegExp(`/10 Lecture Notes/${STORED_NAME}Chapter 1\\.pdf$`)),
      size: file.size,
      mime_type: 'application/pdf',
    },
  ])
  const sheets = await storedPdf(file)
  expect(sheets.map((sheet) => [sheet.width, sheet.height])).toEqual(Array(3).fill([595.28, 841.89]))
  expect(sheets.map(pagesOn)).toEqual([
    [1, 2, 3, 4, 5, 6, 7, 8],
    [9, 10, 11, 12, 13, 14, 15, 16],
    [17, 18, 19],
  ])
})

test('Lecture Notes apply the 20 MB limit to the merged PDF, not to the file picked', async () => {
  const course = await createCourse()
  const notes = { ...course.slot, section: LECTURE_NOTES }
  // 21 MB that no page uses, so the merged PDF leaves it out.
  const padded = await PDFDocument.load(await numberedPdf(9))
  padded.context.register(padded.context.stream(new Uint8Array(MAX_BYTES + 1)))
  const picked = new File([await padded.save()], 'padded.pdf', { type: 'application/pdf' })
  expect(picked.size).toBeGreaterThan(MAX_BYTES)

  await expect(uploadFile(course.lecturer.client, course.slot, picked)).rejects.toMatchObject({ code: 'too_large', status: null })
  const file = await uploadFile(course.lecturer.client, notes, picked)
  expect(file.size).toBeLessThan(MAX_BYTES)
  expect((await storedPdf(file)).map(pagesOn)).toEqual([[1, 2, 3, 4, 5, 6, 7, 8], [9]])

  // 21 MB that the page draws stays in the merged PDF, which is then too large.
  const heavy = await PDFDocument.load(await numberedPdf(1))
  heavy.getPage(0).node.set(PDFName.of('Contents'), heavy.context.register(heavy.context.stream(randomBytes(MAX_BYTES + 1))))
  const tooLarge = new File([await heavy.save()], 'heavy.pdf', { type: 'application/pdf' })
  await expect(uploadFile(course.lecturer.client, notes, tooLarge)).rejects.toMatchObject({ code: 'too_large', status: null })
  expect((await fakeStoreItems(`${course.root}/10 Lecture Notes`)).map((item) => item.id)).toEqual([file.storage_item_id])
})

test('the browser refuses a Lecture Notes file that is not a PDF it can read, before it uploads anything', async () => {
  const course = await createCourse()
  const notes = { ...course.slot, section: LECTURE_NOTES }
  const pptx = new File(['notes'], 'notes.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })

  await expect(uploadFile(course.lecturer.client, notes, pptx)).rejects.toMatchObject({ code: 'not_pdf', status: null })
  await expect(uploadFile(course.lecturer.client, notes, pdf('broken.pdf'))).rejects.toMatchObject({ code: 'unreadable_pdf', status: null })

  expect(await fakeStoreItems(`${course.root}/10 Lecture Notes`)).toEqual([])
})

test('Lecture Notes take any number of uploads, listed in the order staff set', async () => {
  const course = await createCourse()
  const notes = { ...course.slot, section: LECTURE_NOTES }
  const names = async () => (await filesOf(auditor, notes)).map((file) => file.name)
  const first = await uploadFile(course.lecturer.client, notes, await slides('week 1-4.pdf', 30))
  const second = await uploadFile(course.coordinator.client, notes, await slides('week 5-9.pdf', 41))
  const third = await uploadFile(course.lecturer.client, notes, await slides('week 10-14.pdf', 8))
  expect(await names()).toEqual(['week 1-4.pdf', 'week 5-9.pdf', 'week 10-14.pdf'])
  expect(await Promise.all([first, second, third].map(async (file) => (await storedPdf(file)).length))).toEqual([4, 6, 1])

  expect((await course.outsider.client.rpc('reorder_files', { file_ids: [third.id, first.id, second.id] })).error?.code).toBe(PERMISSION_DENIED)
  expect((await course.secondLecturer.client.rpc('reorder_files', { file_ids: [third.id, first.id, second.id] })).error).toBeNull()
  expect(await names()).toEqual(['week 10-14.pdf', 'week 1-4.pdf', 'week 5-9.pdf'])

  await uploadFile(course.coordinator.client, notes, await slides('revision.pdf', 2))
  await deleteFile(course.coordinator.client, first.id)
  expect(await names()).toEqual(['week 10-14.pdf', 'week 5-9.pdf', 'revision.pdf'])
})

test('Lecture Notes is Missing until it has files, and Off and closed to uploads while the offering has it off', async () => {
  const course = await createCourse()
  const notes = { ...course.slot, section: LECTURE_NOTES }
  expect(await sectionStatus(course.coordinator.client, notes)).toBe('missing')
  for (const client of [course.outsider.client, auditor]) {
    await expect(createUploadSession(client, notes, 'notes.pdf')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  }
  const file = await uploadFile(course.lecturer.client, notes, await slides('notes.pdf', 3))
  expect(await sectionStatus(auditor, notes)).toBe('pending_review')

  // The service role switches the section off, as a section toggle would.
  const { error } = await adminClient().from('offerings').update({ sections_on: [12] }).eq('id', notes.offeringId)
  expect(error).toBeNull()
  expect(await sectionStatus(auditor, notes)).toBe('off')
  await expect(uploadFile(course.lecturer.client, notes, await slides('more.pdf', 3))).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  expect((await filesOf(auditor, notes)).map((row) => row.id)).toEqual([file.id])

  const off = await createCourse([12])
  const offNotes = { ...off.slot, section: LECTURE_NOTES }
  expect(await sectionStatus(off.coordinator.client, offNotes)).toBe('off')
  await expect(createUploadSession(off.coordinator.client, offNotes, 'notes.pdf')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
})
