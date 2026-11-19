import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PDFDocument, PDFName } from 'pdf-lib'
import { beforeAll, expect, test } from 'vitest'
import { numberedPdf, readPdf } from '../src/pdf/fixtures.ts'
import { SECTION_SLOTS } from '../src/sections.ts'
import {
  createUploadSession,
  deleteFile,
  deleteItem,
  finalizeUpload,
  sendChunks,
  uploadFile,
  type FileRecord,
  type Slot,
} from '../src/uploads.ts'
import { adminClient, createOffering, createUser, fakeStoreItems, signIn, signInAs } from './harness.ts'

const PERMISSION_DENIED = '42501'

/** 20 MB, the largest file the platform takes. */
const MAX_BYTES = 20 * 1024 * 1024

/** A stored file's name: the upload time, an underscore, then the uploader's file name. */
const STORED_NAME = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z_`

const GRADED_SCRIPTS = { script_high: 'Script High', script_medium: 'Script Medium', script_low: 'Script Low' }

/**
 * The sections with items, from the spec's section table: the section's folder, what its items
 * are called, and its slots in order, each with the folder its files go in.
 */
const ITEM_SECTIONS = [
  {
    section: 11,
    folder: '11 Lab Exercises',
    item: 'Lab',
    slots: { lab_sheet: 'Lab Sheet', answer_scheme: 'Answer Scheme', ...GRADED_SCRIPTS },
  },
  { section: 12, folder: '12 Tutorial', item: 'Tutorial', slots: { question: 'Question', answer_scheme: 'Answer Scheme' } },
  { section: 13, folder: '13 Quiz', item: 'Quiz', slots: { question: 'Question', answer_scheme: 'Answer Scheme', scripts: 'Scripts' } },
  {
    section: 14,
    folder: '14 Assignment',
    item: 'Assignment',
    slots: { question: 'Question', rubric: 'Rubric', moderation_form: 'Moderation Form', ...GRADED_SCRIPTS },
  },
  {
    section: 15,
    folder: '15 Mid-Term Test',
    item: 'Test',
    slots: { question: 'Question', answer_scheme: 'Answer Scheme', moderation_form: 'Moderation Form', ...GRADED_SCRIPTS },
  },
  {
    section: 16,
    folder: '16 Final Exam',
    item: 'Exam',
    slots: { question: 'Question', answer_scheme: 'Answer Scheme', moderation_form: 'Moderation Form', ...GRADED_SCRIPTS },
  },
]

const ALL_ITEM_SECTIONS = ITEM_SECTIONS.map(({ section }) => section)

/** The answer script slots, whose PDFs the browser merges 4 pages to a page. */
const SCRIPT_SLOTS = new Set(['script_high', 'script_medium', 'script_low', 'scripts'])

const LAB = 11
const QUIZ = 13

type Staff = { id: string; client: SupabaseClient }

/** An offering with a coordinator, two lecturers, and a lecturer who teaches another offering. root is its course file's folder. */
type Course = { offeringId: string; root: string; coordinator: Staff; lecturer: Staff; secondLecturer: Staff; outsider: Staff }

let auditor: SupabaseClient

beforeAll(async () => {
  auditor = await signInAs('auditor')
})

async function createStaff(): Promise<Staff> {
  const user = await createUser({ roles: ['lecturer'] })
  return { id: user.id, client: await signIn(user.email, user.password) }
}

/** A course whose course type has sectionsOn on, by default every section with items. */
async function createCourse(sectionsOn = ALL_ITEM_SECTIONS): Promise<Course> {
  const [coordinator, lecturer, secondLecturer, outsider] = await Promise.all([createStaff(), createStaff(), createStaff(), createStaff()])
  const offering = await createOffering({ coordinatorId: coordinator.id, lecturerIds: [lecturer.id, secondLecturer.id], sectionsOn })
  await createOffering({ coordinatorId: outsider.id })
  const root = `eCourseFile/${offering.semesterCode.replace('/', '-')}/${offering.course.code} ${offering.course.title}`
  return { offeringId: offering.id, root, coordinator, lecturer, secondLecturer, outsider }
}

/** A PDF of count numbered A4 portrait pages, as a scanned answer script is. */
async function script(name: string, count = 1) {
  return new File([await numberedPdf(count, { width: 595.28, height: 841.89 })], name, { type: 'application/pdf' })
}

/** Adds the next item to the section as this client, and returns the RPC's result. */
function addItem(client: SupabaseClient, offeringId: string, section: number) {
  return client.rpc('add_item', { offering_id: offeringId, section })
}

/** The section's items as this client reads them, by number. */
async function itemsOf(client: SupabaseClient, offeringId: string, section: number) {
  const { data, error } = await client.from('items').select('number, deletable').eq('offering_id', offeringId).eq('section', section).order('number')
  if (error) throw error
  return data as { number: number; deletable: boolean }[]
}

/** The files of one slot of one item as this client reads them, in their order. */
async function filesOf(client: SupabaseClient, slot: Slot) {
  const { data, error } = await client
    .from('files')
    .select('id, name, position')
    .eq('offering_id', slot.offeringId)
    .eq('section', slot.section)
    .eq('item', slot.item!)
    .eq('slot', slot.slot!)
    .order('position')
    .order('uploaded_at')
  if (error) throw error
  return data as { id: string; name: string; position: number }[]
}

/** The status of the section, as this client reads it. */
async function sectionStatus(client: SupabaseClient, offeringId: string, section: number) {
  const { data, error } = await client.rpc('section_statuses', { offering_id: offeringId })
  if (error) throw error
  return data.find((row: { section: number }) => row.section === section)?.status
}

/** Uploads the bytes to a new session and returns its stored name, without finalizing it. */
async function uploadWithoutFinalize(client: SupabaseClient, slot: Slot, name: string, bytes: Blob) {
  const session = await createUploadSession(client, slot, name)
  await sendChunks(session.uploadUrl, bytes)
  return session.storedName
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

test('the coordinator and lecturers add the next item in sections 11 to 16, each section numbered on its own', async () => {
  const course = await createCourse()

  for (const section of ALL_ITEM_SECTIONS) {
    expect(await itemsOf(course.lecturer.client, course.offeringId, section)).toEqual([])
    for (const [staff, number] of [
      [course.lecturer, 1],
      [course.coordinator, 2],
      [course.secondLecturer, 3],
    ] as const) {
      expect(await addItem(staff.client, course.offeringId, section)).toMatchObject({ data: number, error: null })
    }
  }

  for (const section of ALL_ITEM_SECTIONS) {
    expect((await itemsOf(auditor, course.offeringId, section)).map((item) => item.number)).toEqual([1, 2, 3])
  }
})

test('only staff of the offering add items, only to sections 11 to 16, and only through add_item', async () => {
  const course = await createCourse()
  const others = [course.outsider.client, auditor, ...(await Promise.all((['admin', 'hod', 'dean', 'root'] as const).map(signInAs)))]

  for (const client of others) {
    expect((await addItem(client, course.offeringId, LAB)).error?.code).toBe(PERMISSION_DENIED)
  }
  for (const section of [1, 2, 10, 17, 19]) {
    expect((await addItem(course.coordinator.client, course.offeringId, section)).error?.code).toBe(PERMISSION_DENIED)
  }
  const insert = await course.coordinator.client.from('items').insert({ offering_id: course.offeringId, section: LAB, number: 1 })
  expect(insert.error?.code).toBe(PERMISSION_DENIED)

  expect(await itemsOf(adminClient(), course.offeringId, LAB)).toEqual([])
  expect(await itemsOf(course.outsider.client, course.offeringId, LAB)).toEqual([])
})

test.each(ITEM_SECTIONS)('each $item in section $section takes uploads in the slots of the spec, stored under its own folder', async ({
  section,
  folder,
  item,
  slots,
}) => {
  // The section page shows each item's slots from SECTION_SLOTS, in this order.
  expect(SECTION_SLOTS[section]?.map((slot) => [slot.name, slot.title])).toEqual(Object.entries(slots))
  const course = await createCourse()
  await addItem(course.lecturer.client, course.offeringId, section)
  await addItem(course.lecturer.client, course.offeringId, section)

  for (const slot of Object.keys(slots)) {
    await uploadFile(course.lecturer.client, { offeringId: course.offeringId, section, item: 2, slot }, await script(`${slot}.pdf`))
  }

  expect((await fakeStoreItems(`${course.root}/${folder}`)).map((stored) => stored.path)).toEqual(
    Object.entries(slots)
      .toSorted(([, a], [, b]) => a.localeCompare(b))
      .map(([slot, title]) => expect.stringMatching(new RegExp(`^${course.root}/${folder}/${item} 2/${title}/${STORED_NAME}${slot}\\.pdf$`))),
  )
  for (const slot of Object.keys(slots)) {
    expect((await filesOf(auditor, { offeringId: course.offeringId, section, item: 2, slot })).map((file) => file.name)).toEqual([`${slot}.pdf`])
    expect(await filesOf(auditor, { offeringId: course.offeringId, section, item: 1, slot })).toEqual([])
  }
})

test('an upload to a section with items names an item that exists and one of its section slots', async () => {
  const course = await createCourse()
  const lab = { offeringId: course.offeringId, section: LAB }
  await addItem(course.lecturer.client, course.offeringId, LAB)

  for (const target of [lab, { ...lab, slot: 'lab_sheet' }, { ...lab, item: 1 }, { ...lab, item: 1, slot: 'rubric' }, { ...lab, item: 0, slot: 'lab_sheet' }]) {
    await expect(createUploadSession(course.lecturer.client, target, 'a.pdf')).rejects.toMatchObject({ status: 400, code: 'invalid_request' })
  }
  await expect(createUploadSession(course.lecturer.client, { ...lab, item: 2, slot: 'lab_sheet' }, 'a.pdf')).rejects.toMatchObject({
    status: 404,
    code: 'not_found',
  })
  const teachingPlan = { offeringId: course.offeringId, section: 2, item: 1 }
  await expect(createUploadSession(course.lecturer.client, teachingPlan, 'a.pdf')).rejects.toMatchObject({ status: 400, code: 'invalid_request' })

  for (const client of [course.outsider.client, auditor]) {
    await expect(createUploadSession(client, { ...lab, item: 1, slot: 'lab_sheet' }, 'a.pdf')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  }
  expect(await fakeStoreItems(course.root)).toEqual([])
})

test('script high, medium and low hold one file each, and the other slots and quiz scripts take many', async () => {
  const course = await createCourse()
  for (const section of [LAB, LAB, QUIZ]) await addItem(course.lecturer.client, course.offeringId, section)
  const lab = (item: number, slot: string): Slot => ({ offeringId: course.offeringId, section: LAB, item, slot })
  const quizScripts: Slot = { offeringId: course.offeringId, section: QUIZ, item: 1, slot: 'scripts' }
  const labFolder = `${course.root}/11 Lab Exercises`

  const high = await uploadFile(course.lecturer.client, lab(1, 'script_high'), await script('high.pdf'))
  await uploadFile(course.lecturer.client, lab(1, 'script_medium'), await script('medium.pdf'))
  await uploadFile(course.lecturer.client, lab(1, 'script_low'), await script('low.pdf'))
  await uploadFile(course.lecturer.client, lab(2, 'script_high'), await script('lab 2 high.pdf'))
  for (const slot of ['script_high', 'script_medium', 'script_low']) {
    await expect(uploadFile(course.coordinator.client, lab(1, slot), await script('second.pdf'))).rejects.toMatchObject({
      status: 409,
      code: 'slot_full',
    })
  }
  expect((await fakeStoreItems(labFolder)).map((stored) => stored.path.slice(labFolder.length + 1).replace(new RegExp(STORED_NAME), ''))).toEqual([
    'Lab 1/Script High/high.pdf',
    'Lab 1/Script Low/low.pdf',
    'Lab 1/Script Medium/medium.pdf',
    'Lab 2/Script High/lab 2 high.pdf',
  ])

  for (const name of ['sheet part 1.pdf', 'sheet part 2.pdf']) await uploadFile(course.lecturer.client, lab(1, 'lab_sheet'), await script(name))
  for (const name of ['ali.pdf', 'bala.pdf', 'chong.pdf']) await uploadFile(course.lecturer.client, quizScripts, await script(name))
  expect((await filesOf(auditor, lab(1, 'lab_sheet'))).map((file) => file.name)).toEqual(['sheet part 1.pdf', 'sheet part 2.pdf'])
  expect((await filesOf(auditor, quizScripts)).map((file) => file.name)).toEqual(['ali.pdf', 'bala.pdf', 'chong.pdf'])

  await deleteFile(course.lecturer.client, high.id)
  await uploadFile(course.coordinator.client, lab(1, 'script_high'), await script('new high.pdf'))
  expect((await filesOf(auditor, lab(1, 'script_high'))).map((file) => file.name)).toEqual(['new high.pdf'])
})

test('of two uploads to an empty one-file slot, the second to finalize is refused and its stored file deleted', async () => {
  const course = await createCourse()
  await addItem(course.lecturer.client, course.offeringId, LAB)
  const low = { offeringId: course.offeringId, section: LAB, item: 1, slot: 'script_low' }
  const folder = `${course.root}/11 Lab Exercises/Lab 1/Script Low`
  const first = await uploadWithoutFinalize(course.lecturer.client, low, 'first.pdf', await script('first.pdf'))
  const second = await uploadWithoutFinalize(course.coordinator.client, low, 'second.pdf', await script('second.pdf'))

  const recorded = await finalizeUpload(course.lecturer.client, low, first)
  await expect(finalizeUpload(course.coordinator.client, low, second)).rejects.toMatchObject({ status: 409, code: 'slot_full' })

  expect(await finalizeUpload(course.lecturer.client, low, first)).toEqual(recorded)
  expect((await fakeStoreItems(folder)).map((stored) => stored.id)).toEqual([recorded.storage_item_id])
  expect((await filesOf(auditor, low)).map((file) => file.name)).toEqual(['first.pdf'])
})

test('an upload to an item deleted after its session opened is refused, and its stored file deleted', async () => {
  const course = await createCourse()
  await addItem(course.lecturer.client, course.offeringId, QUIZ)
  const question = { offeringId: course.offeringId, section: QUIZ, item: 1, slot: 'question' }
  const pending = await uploadWithoutFinalize(course.lecturer.client, question, 'question.pdf', await script('question.pdf'))

  await deleteItem(course.lecturer.client, { offeringId: course.offeringId, section: QUIZ, item: 1 })
  await expect(finalizeUpload(course.lecturer.client, question, pending)).rejects.toMatchObject({ status: 404, code: 'not_found' })

  expect(await fakeStoreItems(`${course.root}/13 Quiz`)).toEqual([])
})

test.each(ITEM_SECTIONS.flatMap(({ section, slots }) => Object.keys(slots).filter((slot) => SCRIPT_SLOTS.has(slot)).map((slot) => ({ section, slot }))))(
  'an answer script in section $section slot $slot is merged 4 pages to an A4 page before upload',
  async ({ section, slot }) => {
    const course = await createCourse()
    await addItem(course.lecturer.client, course.offeringId, section)

    const file = await uploadFile(course.lecturer.client, { offeringId: course.offeringId, section, item: 1, slot }, await script('script.pdf', 9))

    const sheets = await storedPdf(file)
    expect(sheets.map((sheet) => [sheet.width, sheet.height])).toEqual(Array(3).fill([595.28, 841.89]))
    expect(sheets.map(pagesOn)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]])
  },
)

test('every slot that does not hold answer scripts stores the PDF as it is', async () => {
  const course = await createCourse()
  const original = await numberedPdf(9)

  for (const { section, slots } of ITEM_SECTIONS) {
    await addItem(course.lecturer.client, course.offeringId, section)
    for (const slot of Object.keys(slots).filter((name) => !SCRIPT_SLOTS.has(name))) {
      const file = await uploadFile(
        course.lecturer.client,
        { offeringId: course.offeringId, section, item: 1, slot },
        new File([original], `${slot}.pdf`, { type: 'application/pdf' }),
      )
      const { data } = await adminClient().schema('fake_storage').from('items').select('content').eq('id', file.storage_item_id).single()
      expect(data!.content, `section ${section} slot ${slot}`).toBe(`\\x${Buffer.from(original).toString('hex')}`)
    }
  }
})

test('answer scripts apply the 20 MB limit to the merged PDF, and an unreadable script is refused before upload', async () => {
  const course = await createCourse()
  await addItem(course.lecturer.client, course.offeringId, LAB)
  const lab = (slot: string): Slot => ({ offeringId: course.offeringId, section: LAB, item: 1, slot })
  // 21 MB that no page uses, so the merged PDF leaves it out.
  const padded = await PDFDocument.load(await numberedPdf(9, { width: 595.28, height: 841.89 }))
  padded.context.register(padded.context.stream(new Uint8Array(MAX_BYTES + 1)))
  const picked = new File([await padded.save()], 'padded.pdf', { type: 'application/pdf' })
  expect(picked.size).toBeGreaterThan(MAX_BYTES)

  await expect(uploadFile(course.lecturer.client, lab('answer_scheme'), picked)).rejects.toMatchObject({ code: 'too_large', status: null })
  const file = await uploadFile(course.lecturer.client, lab('script_high'), picked)
  expect(file.size).toBeLessThan(MAX_BYTES)
  expect((await storedPdf(file)).map(pagesOn)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]])

  // 21 MB that the page draws stays in the merged PDF, which is then too large.
  const heavy = await PDFDocument.load(await numberedPdf(1))
  heavy.getPage(0).node.set(PDFName.of('Contents'), heavy.context.register(heavy.context.stream(randomBytes(MAX_BYTES + 1))))
  const tooLarge = new File([await heavy.save()], 'heavy.pdf', { type: 'application/pdf' })
  await expect(uploadFile(course.lecturer.client, lab('script_medium'), tooLarge)).rejects.toMatchObject({ code: 'too_large', status: null })
  const broken = new File([new TextEncoder().encode('%PDF-1.7 not really')], 'broken.pdf', { type: 'application/pdf' })
  await expect(uploadFile(course.lecturer.client, lab('script_low'), broken)).rejects.toMatchObject({ code: 'unreadable_pdf', status: null })

  expect((await fakeStoreItems(`${course.root}/11 Lab Exercises`)).map((stored) => stored.id)).toEqual([file.storage_item_id])
})

test.each(ALL_ITEM_SECTIONS)('section %i is Missing with empty items, and Pending review once any slot of any item has a file', async (section) => {
  const course = await createCourse()
  const [firstSlot, lastSlot] = [SECTION_SLOTS[section]!.at(0)!.name, SECTION_SLOTS[section]!.at(-1)!.name]
  const status = () => sectionStatus(course.lecturer.client, course.offeringId, section)
  expect(await status()).toBe('missing')
  await addItem(course.lecturer.client, course.offeringId, section)
  await addItem(course.lecturer.client, course.offeringId, section)
  expect(await status()).toBe('missing')

  const last = await uploadFile(course.lecturer.client, { offeringId: course.offeringId, section, item: 2, slot: lastSlot }, await script('a.pdf'))
  expect(await status()).toBe('pending_review')
  await uploadFile(course.lecturer.client, { offeringId: course.offeringId, section, item: 1, slot: firstSlot }, await script('b.pdf'))
  await deleteFile(course.lecturer.client, last.id)
  expect(await status()).toBe('pending_review')
  await deleteItem(course.lecturer.client, { offeringId: course.offeringId, section, item: 1 })
  expect(await status()).toBe('missing')
})

test('an item is deleted with its files by staff who may delete every file in it', async () => {
  const course = await createCourse()
  for (let n = 0; n < 3; n++) await addItem(course.lecturer.client, course.offeringId, LAB)
  const lab = (item: number) => ({ offeringId: course.offeringId, section: LAB, item })
  const own = [
    await uploadFile(course.lecturer.client, { ...lab(1), slot: 'lab_sheet' }, await script('sheet.pdf')),
    await uploadFile(course.lecturer.client, { ...lab(1), slot: 'script_high' }, await script('high.pdf')),
  ]
  await uploadFile(course.lecturer.client, { ...lab(2), slot: 'lab_sheet' }, await script('sheet 2.pdf'))
  await uploadFile(course.secondLecturer.client, { ...lab(2), slot: 'answer_scheme' }, await script('scheme 2.pdf'))
  const deletable = async (client: SupabaseClient) => (await itemsOf(client, course.offeringId, LAB)).map((item) => item.deletable)
  expect(await deletable(course.lecturer.client)).toEqual([true, false, true])
  expect(await deletable(course.secondLecturer.client)).toEqual([false, false, true])
  expect(await deletable(course.coordinator.client)).toEqual([true, true, true])
  expect(await deletable(auditor)).toEqual([false, false, false])

  for (const [client, item] of [
    [course.secondLecturer.client, 1],
    [course.lecturer.client, 2],
    [auditor, 1],
  ] as const) {
    await expect(deleteItem(client, lab(item))).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  }
  await expect(deleteItem(course.outsider.client, lab(1))).rejects.toMatchObject({ status: 404, code: 'not_found' })
  expect(await fakeStoreItems(`${course.root}/11 Lab Exercises`)).toHaveLength(4)

  await deleteItem(course.lecturer.client, lab(1))
  expect(await fakeStoreItems(`${course.root}/11 Lab Exercises/Lab 1`)).toEqual([])
  expect((await itemsOf(auditor, course.offeringId, LAB)).map((item) => item.number)).toEqual([2, 3])
  const { data: log } = await auditor
    .from('activity_log')
    .select('section, action, actor_id, file_name')
    .eq('offering_id', course.offeringId)
    .eq('action', 'delete')
  expect(log).toHaveLength(own.length)
  expect(log).toEqual(expect.arrayContaining(own.map((file) => ({ section: LAB, action: 'delete', actor_id: course.lecturer.id, file_name: file.name }))))

  await deleteItem(course.coordinator.client, lab(2))
  await deleteItem(course.secondLecturer.client, lab(3))
  expect(await fakeStoreItems(`${course.root}/11 Lab Exercises`)).toEqual([])
  expect(await itemsOf(auditor, course.offeringId, LAB)).toEqual([])
  expect((await addItem(course.lecturer.client, course.offeringId, LAB)).data).toBe(1)
})

test('a new item takes the number after the highest, so deleting a middle item leaves a gap', async () => {
  const course = await createCourse()
  for (let n = 0; n < 3; n++) await addItem(course.lecturer.client, course.offeringId, QUIZ)

  await deleteItem(course.lecturer.client, { offeringId: course.offeringId, section: QUIZ, item: 2 })

  expect((await addItem(course.lecturer.client, course.offeringId, QUIZ)).data).toBe(4)
  expect((await itemsOf(auditor, course.offeringId, QUIZ)).map((item) => item.number)).toEqual([1, 3, 4])
})

test('each slot of each item keeps its own order, and new files go last in it', async () => {
  const course = await createCourse()
  await addItem(course.lecturer.client, course.offeringId, QUIZ)
  await addItem(course.lecturer.client, course.offeringId, QUIZ)
  const quiz = (item: number, slot: string): Slot => ({ offeringId: course.offeringId, section: QUIZ, item, slot })
  const upload = async (target: Slot, name: string) => uploadFile(course.lecturer.client, target, await script(name))
  const [a, b] = [await upload(quiz(1, 'question'), 'a.pdf'), await upload(quiz(1, 'question'), 'b.pdf')]
  const c = await upload(quiz(2, 'question'), 'c.pdf')
  const d = await upload(quiz(1, 'answer_scheme'), 'd.pdf')
  expect([a, b, c, d].map((file) => file.position)).toEqual([1, 2, 1, 1])

  for (const mixed of [[c.id, a.id], [d.id, a.id]]) {
    expect((await course.coordinator.client.rpc('reorder_files', { file_ids: mixed })).error?.code).toBe(PERMISSION_DENIED)
  }
  expect((await course.outsider.client.rpc('reorder_files', { file_ids: [b.id, a.id] })).error?.code).toBe(PERMISSION_DENIED)
  expect((await course.secondLecturer.client.rpc('reorder_files', { file_ids: [b.id, a.id] })).error).toBeNull()
  await upload(quiz(1, 'question'), 'e.pdf')
  await upload(quiz(2, 'question'), 'f.pdf')

  expect(await filesOf(auditor, quiz(1, 'question'))).toEqual([
    { id: b.id, name: 'b.pdf', position: 1 },
    { id: a.id, name: 'a.pdf', position: 2 },
    { id: expect.any(String), name: 'e.pdf', position: 3 },
  ])
  expect((await filesOf(auditor, quiz(2, 'question'))).map((file) => file.name)).toEqual(['c.pdf', 'f.pdf'])
  expect((await filesOf(auditor, quiz(1, 'answer_scheme'))).map((file) => file.name)).toEqual(['d.pdf'])
})

test('a switched-off section takes no new items or uploads, and its items can still be deleted', async () => {
  const course = await createCourse()
  await addItem(course.lecturer.client, course.offeringId, LAB)
  await addItem(course.lecturer.client, course.offeringId, LAB)
  const sheet = { offeringId: course.offeringId, section: LAB, item: 1, slot: 'lab_sheet' }
  const file = await uploadFile(course.lecturer.client, sheet, await script('sheet.pdf'))

  // The service role switches the section off, as a section toggle would.
  const { error } = await adminClient().from('offerings').update({ sections_on: [12] }).eq('id', course.offeringId)
  expect(error).toBeNull()
  expect(await sectionStatus(auditor, course.offeringId, LAB)).toBe('off')
  expect((await addItem(course.lecturer.client, course.offeringId, LAB)).error?.code).toBe(PERMISSION_DENIED)
  await expect(uploadFile(course.lecturer.client, sheet, await script('more.pdf'))).rejects.toMatchObject({ status: 403, code: 'forbidden' })

  await deleteFile(course.lecturer.client, file.id)
  await deleteItem(course.lecturer.client, { offeringId: course.offeringId, section: LAB, item: 1 })
  expect((await itemsOf(auditor, course.offeringId, LAB)).map((item) => item.number)).toEqual([2])

  const off = await createCourse([12])
  expect((await addItem(off.coordinator.client, off.offeringId, LAB)).error?.code).toBe(PERMISSION_DENIED)
})
