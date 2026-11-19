import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
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

/** 20 MB, the largest file the platform takes. */
const MAX_BYTES = 20 * 1024 * 1024

/** A stored file's name: the upload time, an underscore, then the uploader's file name. */
const STORED_NAME = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z_`

type Staff = { id: string; client: SupabaseClient }

/** An offering with a coordinator, two lecturers, and a lecturer who teaches another offering. */
type Course = { slot: Slot; folder: string; coordinator: Staff; lecturer: Staff; secondLecturer: Staff; outsider: Staff }

let auditor: SupabaseClient

beforeAll(async () => {
  auditor = await signInAs('auditor')
})

async function createStaff(): Promise<Staff> {
  const user = await createUser({ roles: ['lecturer'] })
  return { id: user.id, client: await signIn(user.email, user.password) }
}

async function createCourse(): Promise<Course> {
  const [coordinator, lecturer, secondLecturer, outsider] = await Promise.all([createStaff(), createStaff(), createStaff(), createStaff()])
  const offering = await createOffering({ coordinatorId: coordinator.id, lecturerIds: [lecturer.id, secondLecturer.id] })
  await createOffering({ coordinatorId: outsider.id })
  const folder = `eCourseFile/${offering.semesterCode.replace('/', '-')}/${offering.course.code} ${offering.course.title}/02 Teaching Plan`
  return { slot: { offeringId: offering.id, section: TEACHING_PLAN }, folder, coordinator, lecturer, secondLecturer, outsider }
}

function pdf(name: string, size = 1024) {
  return new File([new Uint8Array(size).fill(37)], name, { type: 'application/pdf' })
}

/** The slot's files as this client reads them, in their order. */
async function filesOf(client: SupabaseClient, slot: Slot) {
  const { data, error } = await client
    .from('files')
    .select('id, name, deletable')
    .eq('offering_id', slot.offeringId)
    .eq('section', slot.section)
    .order('position')
    .order('uploaded_at')
  if (error) throw error
  return data as { id: string; name: string; deletable: boolean }[]
}

async function teachingPlanStatus(client: SupabaseClient, slot: Slot) {
  const { data, error } = await client.rpc('section_statuses', { offering_id: slot.offeringId })
  if (error) throw error
  return data.find((row: { section: number }) => row.section === TEACHING_PLAN)?.status
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
  const bytes = Uint8Array.from({ length: 6 * 1024 * 1024 + 7 }, (_, i) => (i * 7 + (i >> 13)) & 255)

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

test('staff cannot upload to sections other than Teaching Plan yet', async () => {
  const course = await createCourse()

  for (const section of [1, 3, 6, 17]) {
    await expect(
      createUploadSession(course.coordinator.client, { ...course.slot, section }, 'plan.pdf'),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  }
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

test.each([
  ['a non-PDF', 'plan.docx', 100, 'not_pdf'],
  ['a file over 20 MB', 'big.pdf', MAX_BYTES + 1, 'too_large'],
] as const)('finalize refuses %s that skipped the browser check, and deletes it from storage', async (_, name, size, code) => {
  const course = await createCourse()
  const storedName = await uploadWithoutFinalize(course.lecturer.client, course.slot, name, new Blob([new Uint8Array(size)]))
  expect((await fakeStoreItems(course.folder)).map((item) => item.size)).toEqual([size])

  await expect(finalizeUpload(course.lecturer.client, course.slot, storedName)).rejects.toMatchObject({ status: 422, code })

  expect(await fakeStoreItems(course.folder)).toEqual([])
  expect(await filesOf(course.coordinator.client, course.slot)).toEqual([])
  expect(await teachingPlanStatus(course.coordinator.client, course.slot)).toBe('missing')
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
  const record = { offering_id: course.slot.offeringId, section: TEACHING_PLAN, storage_item_id: 'forged', name: 'forged.pdf', size: 1 }

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
  expect(await teachingPlanStatus(auditor, course.slot)).toBe('pending_review')

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
