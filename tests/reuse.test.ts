import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { numberedPdf } from '../src/pdf/fixtures.ts'
import { deleteFile, listReusableFiles, reuseFile, uploadFile, type FileRecord, type Slot } from '../src/uploads.ts'
import { adminClient, createOffering, createUser, fakeStoreItems, pickSemester, signIn, signInAs } from './harness.ts'

const PERMISSION_DENIED = '42501'

/** A stored file's name: the upload time, an underscore, then the uploader's file name. */
const STORED_NAME = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z_`

/** The reusable places of the spec, in the first lab and tutorial of an offering. */
const NOTES = { section: 10 }
const LAB_SHEET = { section: 11, item: 1, slot: 'lab_sheet' }
const LAB_SCHEME = { section: 11, item: 1, slot: 'answer_scheme' }
const TUTORIAL_QUESTION = { section: 12, item: 1, slot: 'question' }
const TUTORIAL_SCHEME = { section: 12, item: 1, slot: 'answer_scheme' }

type Place = Omit<Slot, 'offeringId'>

type Staff = { id: string; client: SupabaseClient }

/** An offering, the folder of its course file, and its coordinator. */
type Offering = { id: string; root: string; coordinator: Staff }

/**
 * One course offered in four semesters, earliest first: two past offerings, the current offering
 * and a later one, each with its own coordinator. The current offering also has a lecturer who
 * teaches no other. otherCourse is another course, offered in the semester of the second past
 * offering. Sections 10 to 12 are on in each offering, and each has Lab 1 and Tutorial 1.
 */
type History = { past: [Offering, Offering]; current: Offering; later: Offering; otherCourse: Offering; lecturer: Staff }

let auditor: SupabaseClient

/** A history that the tests below only read, with files in it that its coordinators uploaded, by name. */
let history: History
let uploaded: Record<string, FileRecord>

beforeAll(async () => {
  auditor = await signInAs('auditor')
  history = await createHistory()
  const { past, current, later, otherCourse } = history
  const [oldest, previous] = past
  await addItem(previous, 11)
  const files = [
    [oldest, NOTES, 'old notes.pdf'],
    [oldest, LAB_SHEET, 'old sheet.pdf'],
    [oldest, LAB_SCHEME, 'old scheme.pdf'],
    [oldest, { ...LAB_SHEET, slot: 'script_high' }, 'old script.pdf'],
    [oldest, TUTORIAL_QUESTION, 'old question.pdf'],
    [oldest, TUTORIAL_SCHEME, 'old tutorial scheme.pdf'],
    [previous, LAB_SHEET, 'sheet 1.pdf'],
    [previous, { ...LAB_SHEET, item: 2 }, 'sheet 2a.pdf'],
    [previous, { ...LAB_SHEET, item: 2 }, 'sheet 2b.pdf'],
    [current, LAB_SHEET, 'own sheet.pdf'],
    [later, LAB_SHEET, 'later sheet.pdf'],
    [later, NOTES, 'later notes.pdf'],
    [otherCourse, LAB_SHEET, 'other course sheet.pdf'],
    [otherCourse, NOTES, 'other course notes.pdf'],
  ] as const
  uploaded = {}
  // One after another, so that each slot's files are in this order.
  for (const [offering, place, name] of files) uploaded[name] = await upload(offering, place, name)
})

async function createStaff(): Promise<Staff> {
  const user = await createUser({ roles: ['lecturer'] })
  return { id: user.id, client: await signIn(user.email, user.password) }
}

/** count different semesters from pickSemester, earliest first: by start year, then by number. */
async function semestersInOrder(count: number) {
  const picked = new Map<string, { id: string; code: string; start_year: number; number: number }>()
  while (picked.size < count) {
    const semester = await pickSemester()
    picked.set(semester.id, semester)
  }
  return [...picked.values()].toSorted((a, b) => a.start_year - b.start_year || a.number - b.number)
}

async function createHistory(): Promise<History> {
  const semesters = await semestersInOrder(4)
  const [lecturer, ...coordinators] = await Promise.all(Array.from({ length: 6 }, createStaff))
  const sectionsOn = [10, 11, 12]
  const first = await createOffering({ coordinatorId: coordinators[2].id, lecturerIds: [lecturer.id], sectionsOn, semester: semesters[2] })
  const [oldest, previous, later] = await Promise.all(
    [0, 1, 3].map(async (index) => {
      const { data: id, error } = await adminClient().rpc('create_offering', {
        semester_id: semesters[index].id,
        course_id: first.course.id,
        coordinator_id: coordinators[index].id,
        lecturer_ids: [],
      })
      if (error) throw error
      return { id: id as string, root: rootOf(semesters[index].code, first.course), coordinator: coordinators[index] }
    }),
  )
  const other = await createOffering({ coordinatorId: coordinators[4].id, sectionsOn, semester: semesters[1] })
  const current = { id: first.id, root: rootOf(first.semesterCode, first.course), coordinator: coordinators[2] }
  const otherCourse = { id: other.id, root: rootOf(other.semesterCode, other.course), coordinator: coordinators[4] }
  await Promise.all([oldest, previous, current, later, otherCourse].flatMap((offering) => [addItem(offering, 11), addItem(offering, 12)]))
  return { past: [oldest, previous], current, later, otherCourse, lecturer }
}

function rootOf(semesterCode: string, course: { code: string; title: string }) {
  return `eCourseFile/${semesterCode.replace('/', '-')}/${course.code} ${course.title}`
}

/** The semester code of the offering, from its folder. */
function semesterOf(offering: Offering) {
  return offering.root.split('/')[1].replace('-', '/')
}

async function addItem(offering: Offering, section: number) {
  const { error } = await offering.coordinator.client.rpc('add_item', { offering_id: offering.id, section })
  if (error) throw error
}

function at(offering: Offering, place: Place): Slot {
  return { offeringId: offering.id, ...place }
}

/** Uploads a one-page PDF with this name to the place, as the offering's coordinator. */
async function upload(offering: Offering, place: Place, name: string) {
  return uploadFile(offering.coordinator.client, at(offering, place), new File([await numberedPdf(1)], name, { type: 'application/pdf' }))
}

/** What the picker lists for a file of a past offering in the semester. */
function listed(file: FileRecord, semesterCode: string) {
  return { id: file.id, semester_code: semesterCode, item: file.item, name: file.name, size: file.size }
}

/** The stored bytes of the item, as PostgREST sends bytea, or undefined when there is no such item. */
async function storedContent(storageItemId: string) {
  const { data, error } = await adminClient().schema('fake_storage').from('items').select('content').eq('id', storageItemId).maybeSingle()
  if (error) throw error
  return data?.content as string | undefined
}

/** The ids of the files of the slot as this client reads them, in their order. */
async function fileIdsOf(client: SupabaseClient, slot: Slot) {
  let query = client.from('files').select('id').eq('offering_id', slot.offeringId).eq('section', slot.section)
  query = slot.item === undefined ? query.is('item', null) : query.eq('item', slot.item)
  query = slot.slot === undefined ? query.is('slot', null) : query.eq('slot', slot.slot)
  const { data, error } = await query.order('position').order('uploaded_at')
  if (error) throw error
  return data.map((file) => file.id)
}

async function sectionStatus(client: SupabaseClient, offeringId: string, section: number) {
  const { data, error } = await client.rpc('section_statuses', { offering_id: offeringId })
  if (error) throw error
  return data.find((row: { section: number }) => row.section === section)?.status
}

test('the picker lists the files of past offerings of the same course in the same slot type, the latest semester first', async () => {
  const { past, current, later, lecturer } = history
  const [oldest, previous] = past.map(semesterOf)

  for (const client of [lecturer.client, current.coordinator.client]) {
    expect(await listReusableFiles(client, at(current, LAB_SHEET))).toEqual([
      listed(uploaded['sheet 1.pdf'], previous),
      listed(uploaded['sheet 2a.pdf'], previous),
      listed(uploaded['sheet 2b.pdf'], previous),
      listed(uploaded['old sheet.pdf'], oldest),
    ])
  }
  expect(await listReusableFiles(lecturer.client, at(current, LAB_SCHEME))).toEqual([listed(uploaded['old scheme.pdf'], oldest)])
  expect(await listReusableFiles(lecturer.client, at(current, TUTORIAL_QUESTION))).toEqual([listed(uploaded['old question.pdf'], oldest)])
  expect(await listReusableFiles(lecturer.client, at(current, TUTORIAL_SCHEME))).toEqual([listed(uploaded['old tutorial scheme.pdf'], oldest)])
  expect(await listReusableFiles(lecturer.client, at(current, NOTES))).toEqual([listed(uploaded['old notes.pdf'], oldest)])

  // The later offering's past includes the current offering, and the oldest offering has none.
  expect((await listReusableFiles(later.coordinator.client, at(later, LAB_SHEET))).map((file) => file.name)).toEqual([
    'own sheet.pdf',
    'sheet 1.pdf',
    'sheet 2a.pdf',
    'sheet 2b.pdf',
    'old sheet.pdf',
  ])
  expect(await listReusableFiles(past[0].coordinator.client, at(past[0], LAB_SHEET))).toEqual([])
})

test('only Lecture Notes, lab sheets and answer schemes, and tutorial questions and answer schemes take files from past offerings', async () => {
  const { current, lecturer } = history
  const others: Place[] = [
    { section: 11, item: 1, slot: 'script_high' },
    { section: 13, item: 1, slot: 'answer_scheme' },
    { section: 15, item: 1, slot: 'question' },
    { section: 2 },
    { section: 1 },
    { section: 19, slot: 'cqi' },
    { section: 12, item: 1 },
    { section: 11, slot: 'lab_sheet' },
  ]

  for (const place of others) {
    const slot = at(current, place)
    await expect(listReusableFiles(lecturer.client, slot), JSON.stringify(place)).rejects.toMatchObject({ status: 400, code: 'invalid_request' })
    await expect(reuseFile(lecturer.client, slot, uploaded['old sheet.pdf'].id)).rejects.toMatchObject({ status: 400, code: 'invalid_request' })
  }
})

test('staff cannot pick a file of another course, of the offering itself or a later one, or of another slot type', async () => {
  const { current, lecturer } = history
  const stored = await fakeStoreItems(current.root)
  const refused: [Place, string][] = [
    [LAB_SHEET, 'other course sheet.pdf'],
    [NOTES, 'other course notes.pdf'],
    [LAB_SHEET, 'later sheet.pdf'],
    [NOTES, 'later notes.pdf'],
    [LAB_SHEET, 'own sheet.pdf'],
    [LAB_SHEET, 'old scheme.pdf'],
    [LAB_SHEET, 'old question.pdf'],
    [LAB_SCHEME, 'old tutorial scheme.pdf'],
    [TUTORIAL_SCHEME, 'old scheme.pdf'],
    [NOTES, 'old sheet.pdf'],
  ]

  for (const [place, name] of refused) {
    await expect(reuseFile(lecturer.client, at(current, place), uploaded[name].id), `${name} into ${JSON.stringify(place)}`).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    })
  }
  await expect(reuseFile(lecturer.client, at(current, LAB_SHEET), randomUUID())).rejects.toMatchObject({ status: 404, code: 'not_found' })
  expect(await fakeStoreItems(current.root)).toEqual(stored)
  expect(await fileIdsOf(auditor, at(current, LAB_SHEET))).toEqual([uploaded['own sheet.pdf'].id])
})

test('only the coordinator and lecturers of the offering list and pick files for it, into an item that exists', async () => {
  const { past, current, later, otherCourse, lecturer } = history
  const others = [
    past[0].coordinator.client,
    later.coordinator.client,
    otherCourse.coordinator.client,
    auditor,
    ...(await Promise.all((['admin', 'hod', 'dean', 'deputy_dean', 'root'] as const).map(signInAs))),
  ]

  for (const client of others) {
    await expect(listReusableFiles(client, at(current, LAB_SHEET))).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(reuseFile(client, at(current, LAB_SHEET), uploaded['old sheet.pdf'].id)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  }
  await expect(reuseFile(lecturer.client, at(current, { ...LAB_SHEET, item: 2 }), uploaded['old sheet.pdf'].id)).rejects.toMatchObject({
    status: 404,
    code: 'not_found',
  })
  expect(await fileIdsOf(auditor, at(current, LAB_SHEET))).toEqual([uploaded['own sheet.pdf'].id])
})

test('picking a file copies it into the slot as a new file at its end, with a stored copy of its own', async () => {
  const { past, current, lecturer } = await createHistory()
  const [oldest, previous] = past
  await addItem(current, 11)
  const own = await upload(current, { ...LAB_SHEET, item: 2 }, 'own sheet.pdf')
  const sheet = await upload(previous, LAB_SHEET, 'sheet.pdf')
  const question = await upload(oldest, TUTORIAL_QUESTION, 'question.pdf')
  const notes = await upload(oldest, NOTES, 'notes.pdf')
  const target = at(current, { ...LAB_SHEET, item: 2 })

  const copy = await reuseFile(lecturer.client, target, sheet.id)

  expect(copy).toMatchObject({
    offering_id: current.id,
    section: 11,
    item: 2,
    slot: 'lab_sheet',
    name: 'sheet.pdf',
    size: sheet.size,
    position: 2,
    uploaded_by: lecturer.id,
  })
  expect(copy.id).not.toBe(sheet.id)
  const folder = `${current.root}/11 Lab Exercises/Lab 2/Lab Sheet`
  expect(await fakeStoreItems(folder)).toEqual([
    { id: own.storage_item_id, path: expect.stringMatching(/_own sheet\.pdf$/), size: own.size, mime_type: 'application/pdf' },
    { id: copy.storage_item_id, path: expect.stringMatching(new RegExp(`^${folder}/${STORED_NAME}sheet\\.pdf$`)), size: sheet.size, mime_type: 'application/pdf' },
  ])
  expect(copy.storage_item_id).not.toBe(sheet.storage_item_id)
  expect(await storedContent(copy.storage_item_id)).toBe(await storedContent(sheet.storage_item_id))
  expect(await fileIdsOf(auditor, target)).toEqual([own.id, copy.id])
  const { data: rights } = await lecturer.client.from('files').select('deletable').eq('id', copy.id).single()
  expect(rights).toEqual({ deletable: true })

  expect(await sectionStatus(lecturer.client, current.id, 12)).toBe('missing')
  await reuseFile(lecturer.client, at(current, TUTORIAL_QUESTION), question.id)
  expect(await sectionStatus(lecturer.client, current.id, 12)).toBe('pending_review')

  const notesCopy = await reuseFile(current.coordinator.client, at(current, NOTES), notes.id)
  expect(notesCopy).toMatchObject({ section: 10, item: null, slot: null, name: 'notes.pdf', uploaded_by: current.coordinator.id })
  expect((await fakeStoreItems(`${current.root}/10 Lecture Notes`)).map((item) => item.id)).toEqual([notesCopy.storage_item_id])
})

test('deleting the original leaves the copy and its stored bytes, and deleting the copy leaves the original', async () => {
  const { past, current, lecturer } = await createHistory()
  const oldest = past[0]
  const sheet = await upload(oldest, LAB_SHEET, 'sheet.pdf')
  const scheme = await upload(oldest, LAB_SCHEME, 'scheme.pdf')
  const sheetCopy = await reuseFile(lecturer.client, at(current, LAB_SHEET), sheet.id)
  const schemeCopy = await reuseFile(lecturer.client, at(current, LAB_SCHEME), scheme.id)
  const bytes = await storedContent(sheet.storage_item_id)

  await deleteFile(oldest.coordinator.client, sheet.id)

  expect(await storedContent(sheet.storage_item_id)).toBeUndefined()
  expect(await storedContent(sheetCopy.storage_item_id)).toBe(bytes)
  expect(await fileIdsOf(auditor, at(current, LAB_SHEET))).toEqual([sheetCopy.id])
  expect(await listReusableFiles(lecturer.client, at(current, LAB_SHEET))).toEqual([])
  await expect(reuseFile(lecturer.client, at(current, LAB_SHEET), sheet.id)).rejects.toMatchObject({ status: 404, code: 'not_found' })

  await deleteFile(lecturer.client, schemeCopy.id)

  expect(await storedContent(schemeCopy.storage_item_id)).toBeUndefined()
  expect(await storedContent(scheme.storage_item_id)).toBeDefined()
  expect(await fileIdsOf(auditor, at(oldest, LAB_SCHEME))).toEqual([scheme.id])
  expect((await listReusableFiles(lecturer.client, at(current, LAB_SCHEME))).map((file) => file.id)).toEqual([scheme.id])
})

test('a lecturer reads a past offering only through the picker, before and after picking from it', async () => {
  const { past, current, lecturer } = await createHistory()
  const oldest = past[0]
  const sheet = await upload(oldest, LAB_SHEET, 'sheet.pdf')
  const pastCourseFile = async (client: SupabaseClient) =>
    (
      await Promise.all([
        client.from('offerings').select('id').eq('id', oldest.id),
        client.from('offering_lecturers').select('lecturer_id').eq('offering_id', oldest.id),
        client.from('items').select('number').eq('offering_id', oldest.id).eq('section', 11),
        client.from('files').select('id').eq('offering_id', oldest.id),
        client.rpc('section_statuses', { offering_id: oldest.id }),
        client.from('activity_log').select('action').eq('offering_id', oldest.id),
      ])
    ).map(({ data, error }) => error ?? (data as unknown[]).length)

  expect(await pastCourseFile(auditor)).toEqual([1, 1, 1, 1, 19, 1])
  expect(await pastCourseFile(lecturer.client)).toEqual([0, 0, 0, 0, 0, 0])
  await reuseFile(lecturer.client, at(current, LAB_SHEET), sheet.id)
  expect(await pastCourseFile(lecturer.client)).toEqual([0, 0, 0, 0, 0, 0])
  await expect(deleteFile(lecturer.client, sheet.id)).rejects.toMatchObject({ status: 404, code: 'not_found' })

  const place = { offering_id: current.id, section: 11, slot: 'lab_sheet' }
  const record = { ...place, item: 1, storage_item_id: 'forged', name: 'forged.pdf', size: 1 }
  for (const [rpc, args] of [
    ['reusable_files', place],
    ['reuse_file', { ...record, source_offering_id: oldest.id, actor_id: lecturer.id }],
    ['user_can_upload', { user_id: lecturer.id, offering_id: current.id, section: 11 }],
  ] as const) {
    expect((await lecturer.client.rpc(rpc, args)).error?.code, rpc).toBe(PERMISSION_DENIED)
  }
})

test('a section takes no reused file while it is off, also when it goes off or the lecturer leaves while the file is copied', async () => {
  const { past, current, lecturer } = await createHistory()
  const oldest = past[0]
  const sheet = await upload(oldest, LAB_SHEET, 'sheet.pdf')
  const question = await upload(oldest, TUTORIAL_QUESTION, 'question.pdf')
  const { error } = await current.coordinator.client.rpc('switch_section', {
    offering_id: current.id,
    section: 11,
    is_on: false,
    reason: 'No labs this semester',
  })
  expect(error).toBeNull()

  await expect(listReusableFiles(lecturer.client, at(current, LAB_SHEET))).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  await expect(reuseFile(lecturer.client, at(current, LAB_SHEET), sheet.id)).rejects.toMatchObject({ status: 403, code: 'forbidden' })

  // The files function checks before it copies, and its record step checks again after the copy.
  const record = { source_offering_id: oldest.id, offering_id: current.id, item: 1, name: 'sheet.pdf', size: sheet.size, actor_id: lecturer.id }
  const recordReuse = (place: { section: number; slot: string }) =>
    adminClient().rpc('reuse_file', { ...record, ...place, storage_item_id: `copy-${randomUUID()}` })
  expect((await recordReuse({ section: 11, slot: 'lab_sheet' })).error?.code).toBe(PERMISSION_DENIED)
  expect((await recordReuse({ section: 12, slot: 'question' })).error).toBeNull()
  const unassigned = await adminClient().rpc('set_offering_lecturers', { offering_id: current.id, coordinator_id: current.coordinator.id, lecturer_ids: [] })
  expect(unassigned.error).toBeNull()
  expect((await recordReuse({ section: 12, slot: 'question' })).error?.code).toBe(PERMISSION_DENIED)
  await expect(reuseFile(lecturer.client, at(current, TUTORIAL_QUESTION), question.id)).rejects.toMatchObject({ status: 403, code: 'forbidden' })

  expect(await fileIdsOf(adminClient(), at(current, LAB_SHEET))).toEqual([])
  expect(await fileIdsOf(adminClient(), at(current, TUTORIAL_QUESTION))).toHaveLength(1)
  expect(await fakeStoreItems(current.root)).toEqual([])
})

test("each reuse is logged in the offering's activity log with the past offering it came from", async () => {
  const { past, current, lecturer } = await createHistory()
  const [oldest, previous] = past
  const sheet = await upload(previous, LAB_SHEET, 'sheet.pdf')
  const notes = await upload(oldest, NOTES, 'notes.pdf')

  await reuseFile(lecturer.client, at(current, LAB_SHEET), sheet.id)
  await reuseFile(current.coordinator.client, at(current, NOTES), notes.id)

  const logOf = async (client: SupabaseClient, offering: Offering) => {
    const { data, error } = await client
      .from('activity_log')
      .select('section, action, actor_id, file_name, source_offering_id')
      .eq('offering_id', offering.id)
      .order('id')
    if (error) throw error
    return data
  }
  const reuses = [
    { section: 11, action: 'reuse', actor_id: lecturer.id, file_name: 'sheet.pdf', source_offering_id: previous.id },
    { section: 10, action: 'reuse', actor_id: current.coordinator.id, file_name: 'notes.pdf', source_offering_id: oldest.id },
  ]
  expect(await logOf(lecturer.client, current)).toEqual(reuses)
  expect(await logOf(auditor, current)).toEqual(reuses)
  expect(await logOf(previous.coordinator.client, current)).toEqual([])
  expect(await logOf(auditor, previous)).toEqual([
    { section: 11, action: 'upload', actor_id: previous.coordinator.id, file_name: 'sheet.pdf', source_offering_id: null },
  ])
})
