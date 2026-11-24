// Seam 1: the compile manifest, which the files function gives to readers of a course file, and the
// download URLs in it. The timetables here belong to lecturers and program codes the tests create,
// so they change no other test's offering. Their semesters come from pickSemester, which never has
// a calendar or a letter, so sections 1 and 3 have no files. tests/shared-files.test.ts covers those.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { compile } from '../src/pdf/compile.ts'
import { numberedPdf, readPdf, sizedPdf } from '../src/pdf/fixtures.ts'
import { SECTIONS } from '../src/sections.ts'
import { compileManifest, deleteFile, FileActionError, uploadFile, type SharedSlot, type Slot } from '../src/uploads.ts'
import { adminClient, createOffering, createUser, pickSemester, signIn, signInAs } from './harness.ts'

const TEACHING_PLAN = 2
const LECTURER_TIMETABLE = 4
const STUDENT_TIMETABLE = 5
const REPLACEMENT_NOTICES = 7
const LECTURE_NOTES = 10
const LAB_EXERCISES = 11
const LO_PO_ANALYSIS = 19

type Staff = { id: string; client: SupabaseClient }
type Semester = { id: string; code: string }

/** A new lecturer with this name, signed in. */
async function createStaff(name: string): Promise<Staff> {
  const user = await createUser({ roles: ['lecturer'] })
  const { error } = await adminClient().from('profiles').update({ full_name: name }).eq('id', user.id)
  if (error) throw error
  return { id: user.id, client: await signIn(user.email, user.password) }
}

/**
 * An offering in a semester from pickSemester, coordinated by Zainab, also taught by Bala and
 * Aisyah, with sections 10 and 11 on, and a lecturer who teaches only another offering.
 */
async function createCourse() {
  const [coordinator, bala, aisyah, outsider] = await Promise.all([
    createStaff('Zainab Coordinator'),
    createStaff('Bala Lecturer'),
    createStaff('Aisyah Lecturer'),
    createStaff('Outside Lecturer'),
  ])
  const semester: Semester = await pickSemester()
  const offering = await createOffering({ coordinatorId: coordinator.id, lecturerIds: [bala.id, aisyah.id], sectionsOn: [LECTURE_NOTES, LAB_EXERCISES], semester })
  await createOffering({ coordinatorId: outsider.id })
  return { offeringId: offering.id, course: offering.course, semester, coordinator, bala, aisyah, outsider }
}

/** Uploads a PDF to the place as this client. */
function upload(client: SupabaseClient, slot: Slot | SharedSlot, name: string) {
  return uploadFile(client, slot, new File([sizedPdf(1024)], name, { type: 'application/pdf' }))
}

async function addItem(client: SupabaseClient, offeringId: string, section: number) {
  const { data, error } = await client.rpc('add_item', { offering_id: offeringId, section })
  if (error) throw error
  return data as number
}

function switchSection(client: SupabaseClient, offeringId: string, section: number, isOn: boolean, reason?: string) {
  return client.rpc('switch_section', { offering_id: offeringId, section, is_on: isOn, reason })
}

/** Adds a program code with this code, and uploads its student timetable for the semester as the admin. */
async function programCodeWithTimetable(code: string, semester: Semester) {
  const { data, error } = await adminClient().from('program_codes').insert({ code }).select('id').single()
  if (error) throw error
  const timetable = await upload(await signInAs('admin'), { semesterId: semester.id, section: STUDENT_TIMETABLE, programCodeId: data.id }, 'students.pdf')
  return { id: data.id as string, timetable }
}

/** The manifest's sections with the ids of their files. */
function sectionFiles(manifest: Awaited<ReturnType<typeof compileManifest>>) {
  return manifest.sections.map(({ number, title, files }) => ({ number, title, files: files.map((file) => file.id) }))
}

function titleOf(number: number) {
  return SECTIONS.find((section) => section.number === number)!.title
}

/** The error that the promise rejects with, or null when it resolves. */
async function refusal(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => {
      if (error instanceof FileActionError) return { status: error.status, code: error.code }
      throw error
    },
  )
}

test('the manifest lists the sections that are on in order, each with its files in the order staff set, and leaves out switched-off and empty sections 7 to 9', async () => {
  const { offeringId, semester, coordinator, bala, aisyah } = await createCourse()
  const place = (section: number, item?: number, slot?: string): Slot => ({ offeringId, section, item, slot })

  const plan1 = await upload(bala.client, place(TEACHING_PLAN), 'plan-1.pdf')
  const plan2 = await upload(coordinator.client, place(TEACHING_PLAN), 'plan-2.pdf')
  const plan3 = await upload(aisyah.client, place(TEACHING_PLAN), 'plan-3.pdf')
  expect((await coordinator.client.rpc('reorder_files', { file_ids: [plan3.id, plan1.id, plan2.id] })).error).toBeNull()
  const notice = await upload(bala.client, place(REPLACEMENT_NOTICES), 'notice.pdf')

  await upload(bala.client, place(LECTURE_NOTES), 'notes.pdf')
  expect((await switchSection(bala.client, offeringId, LECTURE_NOTES, false, 'Notes are in the textbook')).error).toBeNull()

  const lab1 = await addItem(coordinator.client, offeringId, LAB_EXERCISES)
  const lab2 = await addItem(coordinator.client, offeringId, LAB_EXERCISES)
  const lab2Sheet = await upload(bala.client, place(LAB_EXERCISES, lab2, 'lab_sheet'), 'lab-2-sheet.pdf')
  const lab1Script = await upload(bala.client, place(LAB_EXERCISES, lab1, 'script_high'), 'lab-1-script.pdf')
  const lab1Scheme = await upload(bala.client, place(LAB_EXERCISES, lab1, 'answer_scheme'), 'lab-1-scheme.pdf')
  const lab1Sheet = await upload(bala.client, place(LAB_EXERCISES, lab1, 'lab_sheet'), 'lab-1-sheet.pdf')

  const cqi = await upload(aisyah.client, place(LO_PO_ANALYSIS, undefined, 'cqi'), 'cqi.pdf')
  const poAchievement = await upload(aisyah.client, place(LO_PO_ANALYSIS, undefined, 'po_achievement'), 'po.pdf')

  const balaTimetable = await upload(bala.client, { semesterId: semester.id, section: LECTURER_TIMETABLE }, 'bala.pdf')
  const zainabTimetable = await upload(coordinator.client, { semesterId: semester.id, section: LECTURER_TIMETABLE }, 'zainab.pdf')

  const suffix = randomUUID()
  const later = await programCodeWithTimetable(`3 BITS S1G1 ${suffix}`, semester)
  const earlier = await programCodeWithTimetable(`1 BITS S1G1 ${suffix}`, semester)
  for (const code of [later, earlier]) {
    expect((await coordinator.client.rpc('tick_program_code', { offering_id: offeringId, program_code_id: code.id, ticked: true })).error).toBeNull()
  }

  const expected = [
    { number: 1, files: [] },
    { number: TEACHING_PLAN, files: [plan3.id, plan1.id, plan2.id] },
    { number: 3, files: [] },
    { number: LECTURER_TIMETABLE, files: [zainabTimetable.id, balaTimetable.id] },
    { number: STUDENT_TIMETABLE, files: [earlier.timetable.id, later.timetable.id] },
    { number: 6, files: [] },
    { number: REPLACEMENT_NOTICES, files: [notice.id] },
    { number: LAB_EXERCISES, files: [lab1Sheet.id, lab1Scheme.id, lab1Script.id, lab2Sheet.id] },
    { number: 17, files: [] },
    { number: 18, files: [] },
    { number: LO_PO_ANALYSIS, files: [poAchievement.id, cqi.id] },
  ].map((section) => ({ ...section, title: titleOf(section.number) }))
  expect(sectionFiles(await compileManifest(aisyah.client, offeringId))).toEqual(expected)
  expect(sectionFiles(await compileManifest(await signInAs('auditor'), offeringId))).toEqual(expected)
})

test('each file in an item or a slot comes with its item and slot, which the PDF labels it by, and every other file with neither', async () => {
  const { offeringId, semester, coordinator, bala } = await createCourse()
  const place = (section: number, item?: number, slot?: string): Slot => ({ offeringId, section, item, slot })
  const lab = await addItem(coordinator.client, offeringId, LAB_EXERCISES)
  await upload(bala.client, place(LAB_EXERCISES, lab, 'answer_scheme'), 'lab-scheme.pdf')
  await upload(bala.client, place(LO_PO_ANALYSIS, undefined, 'cqi'), 'cqi.pdf')
  await upload(bala.client, place(TEACHING_PLAN), 'plan.pdf')
  await upload(bala.client, { semesterId: semester.id, section: LECTURER_TIMETABLE }, 'bala.pdf')

  const { sections } = await compileManifest(bala.client, offeringId)

  const files = sections.flatMap((section) => section.files.map(({ name, item, slot }) => ({ section: section.number, name, item, slot })))
  expect(files).toEqual([
    { section: TEACHING_PLAN, name: 'plan.pdf', item: null, slot: null },
    { section: LECTURER_TIMETABLE, name: 'bala.pdf', item: null, slot: null },
    { section: LAB_EXERCISES, name: 'lab-scheme.pdf', item: lab, slot: 'answer_scheme' },
    { section: LO_PO_ANALYSIS, name: 'cqi.pdf', item: null, slot: 'cqi' },
  ])
})

test('the cover names the course, semester, department, coordinator and lecturers, deactivated ones too, for lecturers who cannot read profiles', async () => {
  const { offeringId, course, semester, aisyah, bala } = await createCourse()
  expect((await adminClient().from('profiles').update({ active: false }).eq('id', bala.id)).error).toBeNull()

  const { cover } = await compileManifest(aisyah.client, offeringId)

  expect(cover).toEqual({
    courseCode: course.code,
    courseTitle: 'Seam1 Course',
    semester: semester.code,
    department: 'Seam1 Department',
    coordinator: 'Zainab Coordinator',
    lecturers: ['Zainab Coordinator', 'Aisyah Lecturer', 'Bala Lecturer'],
  })
})

test('the cover names each lecturer by their title and name', async () => {
  const { offeringId, coordinator, bala, aisyah } = await createCourse()
  for (const [staff, fullName, title] of [
    [coordinator, 'Zainab Coordinator', 'Prof. Madya'],
    [bala, 'Bala Lecturer', 'Ts.'],
  ] as const) {
    expect((await staff.client.rpc('update_my_profile', { full_name: fullName, title })).error).toBeNull()
  }

  const { cover } = await compileManifest(aisyah.client, offeringId)

  expect(cover).toMatchObject({
    coordinator: 'Prof. Madya Zainab Coordinator',
    lecturers: ['Prof. Madya Zainab Coordinator', 'Aisyah Lecturer', 'Ts. Bala Lecturer'],
  })
})

test('everyone who reads the course file gets its manifest, and other lecturers and root are refused', async () => {
  const { offeringId, course, coordinator, bala, outsider } = await createCourse()
  const readers = [coordinator.client, bala.client, ...(await Promise.all((['auditor', 'hod', 'dean', 'deputy_dean', 'admin'] as const).map(signInAs)))]

  for (const reader of readers) expect((await compileManifest(reader, offeringId)).cover.courseCode).toBe(course.code)
  for (const other of [outsider.client, await signInAs('root')]) {
    expect(await refusal(compileManifest(other, offeringId))).toEqual({ status: 403, code: 'forbidden' })
  }
  expect(await refusal(compileManifest(await signInAs('admin'), randomUUID()))).toEqual({ status: 404, code: 'not_found' })
})

test('a download URL gets the stored bytes of its file without signing in, and a changed URL or a deleted file gets none', async () => {
  const { offeringId, coordinator } = await createCourse()
  const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  // Random filler, so that no two chunks of the upload hold the same bytes and a mix-up of chunks changes the hash.
  const noise = randomBytes(19 * 1024 * 1024)
  const large = sizedPdf(noise.length, (index) => noise[index])
  const largeFile = await uploadFile(coordinator.client, { offeringId, section: TEACHING_PLAN }, new File([large], 'large.pdf', { type: 'application/pdf' }))
  const small = await upload(coordinator.client, { offeringId, section: TEACHING_PLAN }, 'small.pdf')

  const [largeUrl, smallUrl] = (await compileManifest(coordinator.client, offeringId)).sections[1].files.map((file) => new URL(file.url))
  const response = await fetch(largeUrl)
  expect(response.status).toBe(200)
  expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(sha256(large))

  const extended = new URL(largeUrl)
  extended.searchParams.set('expires', String(Number(largeUrl.searchParams.get('expires')) + 60 * 60 * 1000))
  const otherItem = new URL(largeUrl)
  otherItem.pathname = smallUrl.pathname
  for (const changed of [extended, otherItem]) {
    const refused = await fetch(changed)
    expect(refused.status).toBe(401)
    await refused.body?.cancel()
  }

  await deleteFile(coordinator.client, largeFile.id)
  const gone = await fetch(largeUrl)
  expect(gone.status).toBe(404)
  await gone.body?.cancel()
  const kept = await fetch(smallUrl)
  expect(kept.status).toBe(200)
  expect((await kept.arrayBuffer()).byteLength).toBe(small.size)
})

test('a reader compiles the course file from its manifest, fetching each file from its download URL', async () => {
  const { offeringId, coordinator, bala } = await createCourse()
  const pdf = async (label: string, pages: number) => new File([await numberedPdf(pages, { label })], `${label}.pdf`, { type: 'application/pdf' })
  await uploadFile(coordinator.client, { offeringId, section: TEACHING_PLAN }, await pdf('plan', 2))
  await uploadFile(bala.client, { offeringId, section: REPLACEMENT_NOTICES }, await pdf('notice', 1))
  const manifest = await compileManifest(await signInAs('hod'), offeringId)

  const pages = await readPdf(await compile(manifest, async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer())))

  const firstTexts = pages.map((page) => page.texts[0].text)
  expect(firstTexts).toHaveLength(2 + manifest.sections.length + 3)
  const plan = firstTexts.indexOf('Section 2')
  expect(firstTexts.slice(plan, plan + 4)).toEqual(['Section 2', 'plan 1', 'plan 2', 'Section 3'])
  const notice = firstTexts.indexOf('Section 7')
  expect(firstTexts.slice(notice, notice + 3)).toEqual(['Section 7', 'notice 1', 'Section 10'])
})
