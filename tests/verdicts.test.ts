import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { numberedPdf } from '../src/pdf/fixtures.ts'
import { deleteFile, deleteSharedFile, listReusableFiles, reuseFile, uploadFile, type Slot } from '../src/uploads.ts'
import { adminClient, createOffering, createUser, pickSemester, signIn, signInAs, userIdOf } from './harness.ts'

// Every timetable here belongs to a lecturer or a program code that the test creates, so these
// uploads change no other test's offering.

const PERMISSION_DENIED = '42501'
const CHECK_VIOLATION = '23514'
const NULL_VALUE = '22004'

const TEACHING_PLAN = 2
const LECTURER_TIMETABLE = 4
const STUDENT_TIMETABLE = 5
const REPLACEMENT_NOTICES = 7
const LECTURE_NOTES = 10
const TUTORIAL = 12
const QUIZ = 13

type Verdict = 'verified' | 'needs_fix'
type Staff = { id: string; client: SupabaseClient }
type Semester = { id: string; code: string; start_year: number; number: number }

/**
 * An offering with a coordinator and a lecturer, and a lecturer who teaches another offering. Its
 * course type has sections 10 and 12 on.
 */
type Course = { offeringId: string; semester: Semester; courseId: string; coordinator: Staff; lecturer: Staff; outsider: Staff }

let auditor: SupabaseClient
let auditorId: string

beforeAll(async () => {
  auditor = await signInAs('auditor')
  auditorId = await userIdOf(auditor)
})

async function createStaff(): Promise<Staff> {
  const user = await createUser({ roles: ['lecturer'] })
  return { id: user.id, client: await signIn(user.email, user.password) }
}

async function createCourse(semester?: Semester): Promise<Course> {
  const [coordinator, lecturer, outsider] = await Promise.all([createStaff(), createStaff(), createStaff()])
  const picked = semester ?? (await pickSemester())
  const offering = await createOffering({ coordinatorId: coordinator.id, lecturerIds: [lecturer.id], semester: picked })
  await createOffering({ coordinatorId: outsider.id })
  return { offeringId: offering.id, semester: picked, courseId: offering.course.id, coordinator, lecturer, outsider }
}

function pdf(name: string) {
  const bytes = new Uint8Array(1024).fill(37)
  bytes.set(new TextEncoder().encode('%PDF-'))
  return new File([bytes], name, { type: 'application/pdf' })
}

/** Uploads a PDF to the place in the course file as this client. A merged place, such as Lecture Notes, gets a real one-page PDF. */
async function upload(client: SupabaseClient, slot: Slot, name: string) {
  const file = slot.section === LECTURE_NOTES ? new File([await numberedPdf(1)], name, { type: 'application/pdf' }) : pdf(name)
  return uploadFile(client, slot, file)
}

/** Records the verdict as this client, the way the section page does, and returns the RPC's result. */
function recordVerdict(client: SupabaseClient, offeringId: string, section: number, verdict: Verdict | null, comment?: string | null) {
  return client.rpc('record_verdict', { offering_id: offeringId, section, verdict, comment })
}

/** Records the verdict as the auditor, and fails the test if it is refused. */
async function mark(offeringId: string, section: number, verdict: Verdict, comment?: string) {
  const { error } = await recordVerdict(auditor, offeringId, section, verdict, comment)
  if (error) throw error
}

/** The section's status row, as this client reads it. */
async function statusOf(client: SupabaseClient, offeringId: string, section: number) {
  const { data, error } = await client.rpc('section_statuses', { offering_id: offeringId })
  if (error) throw error
  return data.find((row: { section: number }) => row.section === section) as { section: number; status: string; counts_toward_completeness: boolean }
}

async function status(offeringId: string, section: number) {
  return (await statusOf(auditor, offeringId, section)).status
}

/** The section's verdicts, newest first, as this client reads them. */
async function verdictsOf(client: SupabaseClient, offeringId: string, section: number) {
  const { data, error } = await client
    .from('section_verdicts')
    .select('verdict, comment, auditor_id, auditor_name')
    .eq('offering_id', offeringId)
    .eq('section', section)
    .order('id', { ascending: false })
  if (error) throw error
  return data
}

/** Adds a program code with the service role, and uploads its student timetable for the semester as the admin. */
async function programCodeWithTimetable(semester: Semester) {
  const { data: code, error } = await adminClient().from('program_codes').insert({ code: `1 BITS S1G1 ${randomUUID()}` }).select('id').single()
  if (error) throw error
  const timetable = await uploadFile(await signInAs('admin'), { semesterId: semester.id, section: STUDENT_TIMETABLE, programCodeId: code.id }, pdf('students.pdf'))
  return { id: code.id as string, timetable }
}

function tick(client: SupabaseClient, offeringId: string, programCodeId: string, ticked: boolean) {
  return client.rpc('tick_program_code', { offering_id: offeringId, program_code_id: programCodeId, ticked })
}

function switchSection(client: SupabaseClient, offeringId: string, section: number, isOn: boolean, reason?: string) {
  return client.rpc('switch_section', { offering_id: offeringId, section, is_on: isOn, reason })
}

test('auditors mark sections of offerings in every semester, and nobody else can, also without record_verdict', async () => {
  const course = await createCourse()
  let otherSemester = await pickSemester()
  while (otherSemester.id === course.semester.id) otherSemester = await pickSemester()
  const other = await createCourse(otherSemester)

  for (const offeringId of [course.offeringId, other.offeringId]) {
    await mark(offeringId, REPLACEMENT_NOTICES, 'verified')
    expect(await statusOf(auditor, offeringId, REPLACEMENT_NOTICES)).toEqual({
      section: REPLACEMENT_NOTICES,
      status: 'verified',
      counts_toward_completeness: true,
    })
  }

  const roles = ['admin', 'hod', 'dean', 'deputy_dean', 'lecturer', 'root'] as const
  const others = [course.coordinator.client, course.lecturer.client, course.outsider.client, ...(await Promise.all(roles.map(signInAs)))]
  for (const client of others) {
    for (const verdict of ['verified', 'needs_fix'] as const) {
      expect((await recordVerdict(client, course.offeringId, TEACHING_PLAN, verdict, 'A comment')).error?.code).toBe(PERMISSION_DENIED)
    }
    const insert = await client.from('section_verdicts').insert({
      offering_id: course.offeringId,
      section: TEACHING_PLAN,
      verdict: 'verified',
      auditor_id: course.coordinator.id,
      file_ids: [],
      section_on: true,
    })
    expect(insert.error?.code).toBe(PERMISSION_DENIED)
  }
  for (const section of [0, 20]) {
    expect((await recordVerdict(auditor, course.offeringId, section, 'verified')).error?.code).toBe(PERMISSION_DENIED)
  }
  expect((await recordVerdict(auditor, randomUUID(), TEACHING_PLAN, 'verified')).error?.code).toBe(PERMISSION_DENIED)

  expect(await status(course.offeringId, TEACHING_PLAN)).toBe('missing')
  expect(await verdictsOf(adminClient(), course.offeringId, TEACHING_PLAN)).toEqual([])
})

test('Needs fix needs a comment that is not blank, and comments are kept without their outer blanks', async () => {
  const course = await createCourse()
  const slot = { offeringId: course.offeringId, section: TEACHING_PLAN }
  await upload(course.lecturer.client, slot, 'plan.pdf')

  for (const comment of [undefined, null, '', ' \t\n ']) {
    expect((await recordVerdict(auditor, course.offeringId, TEACHING_PLAN, 'needs_fix', comment)).error?.code).toBe(CHECK_VIOLATION)
  }
  expect((await recordVerdict(auditor, course.offeringId, TEACHING_PLAN, null, 'A comment')).error?.code).toBe(NULL_VALUE)
  expect(await verdictsOf(auditor, course.offeringId, TEACHING_PLAN)).toEqual([])
  expect(await status(course.offeringId, TEACHING_PLAN)).toBe('pending_review')

  await mark(course.offeringId, TEACHING_PLAN, 'needs_fix', '  The plan is not signed.\n')
  await mark(course.offeringId, TEACHING_PLAN, 'verified', '   ')
  await mark(course.offeringId, TEACHING_PLAN, 'verified', ' Signed now. ')

  const auditorName = 'Seam1 auditor'
  expect(await verdictsOf(course.lecturer.client, course.offeringId, TEACHING_PLAN)).toEqual([
    { verdict: 'verified', comment: 'Signed now.', auditor_id: auditorId, auditor_name: auditorName },
    { verdict: 'verified', comment: null, auditor_id: auditorId, auditor_name: auditorName },
    { verdict: 'needs_fix', comment: 'The plan is not signed.', auditor_id: auditorId, auditor_name: auditorName },
  ])
})

test('a section with files is Pending review until an auditor marks it, and then shows the latest verdict to every reader', async () => {
  const course = await createCourse()
  await upload(course.lecturer.client, { offeringId: course.offeringId, section: TEACHING_PLAN }, 'plan.pdf')
  const readers = [course.coordinator.client, course.lecturer.client, auditor, await signInAs('hod')]
  const expectStatus = async (status: string) => {
    for (const client of readers) {
      expect(await statusOf(client, course.offeringId, TEACHING_PLAN)).toEqual({ section: TEACHING_PLAN, status, counts_toward_completeness: true })
    }
  }

  await expectStatus('pending_review')
  await mark(course.offeringId, TEACHING_PLAN, 'verified')
  await expectStatus('verified')
  await mark(course.offeringId, TEACHING_PLAN, 'needs_fix', 'Week 7 is missing.')
  await expectStatus('needs_fix')
  await mark(course.offeringId, TEACHING_PLAN, 'verified')
  await expectStatus('verified')

  expect((await course.outsider.client.from('section_verdicts').select('id').eq('offering_id', course.offeringId)).data).toEqual([])
  expect((await (await signInAs('root')).from('section_verdicts').select('id').eq('offering_id', course.offeringId)).data).toEqual([])
  expect((await course.outsider.client.rpc('section_statuses', { offering_id: course.offeringId })).data).toEqual([])
})

test('uploading or deleting a file after a verdict returns the section to Pending review, and reordering does not', async () => {
  const course = await createCourse()
  const slot = { offeringId: course.offeringId, section: TEACHING_PLAN }
  const first = await upload(course.lecturer.client, slot, 'part 1.pdf')
  await mark(course.offeringId, TEACHING_PLAN, 'verified')

  const second = await upload(course.coordinator.client, slot, 'part 2.pdf')
  expect(await status(course.offeringId, TEACHING_PLAN)).toBe('pending_review')

  await mark(course.offeringId, TEACHING_PLAN, 'needs_fix', 'Part 2 is the wrong course.')
  expect((await course.coordinator.client.rpc('reorder_files', { file_ids: [second.id, first.id] })).error).toBeNull()
  expect(await status(course.offeringId, TEACHING_PLAN)).toBe('needs_fix')

  await deleteFile(course.coordinator.client, second.id)
  expect(await status(course.offeringId, TEACHING_PLAN)).toBe('pending_review')

  await mark(course.offeringId, TEACHING_PLAN, 'verified')
  await deleteFile(course.lecturer.client, first.id)
  expect(await status(course.offeringId, TEACHING_PLAN)).toBe('missing')
  await upload(course.lecturer.client, slot, 'part 1.pdf')
  expect(await status(course.offeringId, TEACHING_PLAN)).toBe('pending_review')
})

test('a verdict covers every slot and item of a section, and a new item without files changes nothing', async () => {
  const course = await createCourse()
  const addTutorial = async () => {
    const { data, error } = await course.lecturer.client.rpc('add_item', { offering_id: course.offeringId, section: TUTORIAL })
    if (error) throw error
    return data as number
  }
  const first = await addTutorial()
  await upload(course.lecturer.client, { offeringId: course.offeringId, section: TUTORIAL, item: first, slot: 'question' }, 'question.pdf')
  await mark(course.offeringId, TUTORIAL, 'verified')

  const second = await addTutorial()
  expect(await status(course.offeringId, TUTORIAL)).toBe('verified')

  await upload(course.coordinator.client, { offeringId: course.offeringId, section: TUTORIAL, item: second, slot: 'answer_scheme' }, 'scheme.pdf')
  expect(await status(course.offeringId, TUTORIAL)).toBe('pending_review')
})

test('a Missing section stays Missing whatever its verdict, and a section that may be empty shows its verdict', async () => {
  const course = await createCourse()

  await mark(course.offeringId, TEACHING_PLAN, 'needs_fix', 'Upload the teaching plan.')
  expect(await status(course.offeringId, TEACHING_PLAN)).toBe('missing')

  expect(await status(course.offeringId, REPLACEMENT_NOTICES)).toBe('empty')
  await mark(course.offeringId, REPLACEMENT_NOTICES, 'needs_fix', 'Week 5 was replaced. Upload its notice.')
  expect(await statusOf(course.lecturer.client, course.offeringId, REPLACEMENT_NOTICES)).toEqual({
    section: REPLACEMENT_NOTICES,
    status: 'needs_fix',
    counts_toward_completeness: true,
  })
  await upload(course.lecturer.client, { offeringId: course.offeringId, section: REPLACEMENT_NOTICES }, 'notice.pdf')
  expect(await status(course.offeringId, REPLACEMENT_NOTICES)).toBe('pending_review')
})

test('a file reused from a past offering after a verdict returns the section to Pending review', async () => {
  const semesters = [await pickSemester()]
  while (semesters.length < 2) {
    const semester = await pickSemester()
    if (semester.id !== semesters[0].id) semesters.push(semester)
  }
  const [earlier, later] = semesters.toSorted((a, b) => a.start_year - b.start_year || a.number - b.number)
  const current = await createCourse(later)
  const { data: pastId, error } = await adminClient().rpc('create_offering', {
    semester_id: earlier.id,
    course_id: current.courseId,
    coordinator_id: current.outsider.id,
    lecturer_ids: [],
  })
  if (error) throw error
  await upload(current.outsider.client, { offeringId: pastId, section: LECTURE_NOTES }, 'old notes.pdf')

  const notes = { offeringId: current.offeringId, section: LECTURE_NOTES }
  await upload(current.lecturer.client, notes, 'notes.pdf')
  await mark(current.offeringId, LECTURE_NOTES, 'verified')

  const [reusable] = await listReusableFiles(current.lecturer.client, notes)
  await reuseFile(current.lecturer.client, notes, reusable.id)
  expect(await status(current.offeringId, LECTURE_NOTES)).toBe('pending_review')
})

test('section 4 returns to Pending review when a lecturer joins or leaves the offering or replaces their timetable, and is Missing for a lecturer without one', async () => {
  const course = await createCourse()
  const second = await createStaff()
  await createOffering({ coordinatorId: second.id, semester: course.semester })
  const timetable = (staff: Staff) => uploadFile(staff.client, { semesterId: course.semester.id, section: LECTURER_TIMETABLE }, pdf('timetable.pdf'))
  const assign = async (lecturers: Staff[]) => {
    const { error } = await adminClient().rpc('set_offering_lecturers', {
      offering_id: course.offeringId,
      coordinator_id: course.coordinator.id,
      lecturer_ids: lecturers.map((lecturer) => lecturer.id),
    })
    if (error) throw error
  }
  await timetable(course.coordinator)
  await timetable(course.lecturer)
  await mark(course.offeringId, LECTURER_TIMETABLE, 'verified')
  expect(await status(course.offeringId, LECTURER_TIMETABLE)).toBe('verified')

  const secondTimetable = await timetable(second)
  await assign([course.lecturer, second])
  expect(await status(course.offeringId, LECTURER_TIMETABLE)).toBe('pending_review')

  await mark(course.offeringId, LECTURER_TIMETABLE, 'needs_fix', 'The second timetable is last semester\'s.')
  await deleteSharedFile(second.client, secondTimetable.id)
  expect(await status(course.offeringId, LECTURER_TIMETABLE)).toBe('missing')
  await timetable(second)
  expect(await status(course.offeringId, LECTURER_TIMETABLE)).toBe('pending_review')

  await mark(course.offeringId, LECTURER_TIMETABLE, 'verified')
  await assign([course.lecturer])
  expect(await status(course.offeringId, LECTURER_TIMETABLE)).toBe('pending_review')

  await mark(course.offeringId, LECTURER_TIMETABLE, 'verified')
  const withoutTimetable = await createStaff()
  await assign([course.lecturer, withoutTimetable])
  expect(await status(course.offeringId, LECTURER_TIMETABLE)).toBe('missing')
})

test('section 5 returns to Pending review when a program code is ticked or unticked or its timetable replaced', async () => {
  const course = await createCourse()
  const [first, second] = await Promise.all([programCodeWithTimetable(course.semester), programCodeWithTimetable(course.semester)])
  const admin = await signInAs('admin')
  const expectTicked = async (programCodeId: string, ticked: boolean) => {
    expect((await tick(course.lecturer.client, course.offeringId, programCodeId, ticked)).error).toBeNull()
  }

  await expectTicked(first.id, true)
  await mark(course.offeringId, STUDENT_TIMETABLE, 'verified')
  expect(await status(course.offeringId, STUDENT_TIMETABLE)).toBe('verified')

  await expectTicked(second.id, true)
  expect(await status(course.offeringId, STUDENT_TIMETABLE)).toBe('pending_review')

  await mark(course.offeringId, STUDENT_TIMETABLE, 'needs_fix', 'This course is not taken by the second program.')
  await expectTicked(second.id, false)
  expect(await status(course.offeringId, STUDENT_TIMETABLE)).toBe('pending_review')

  await mark(course.offeringId, STUDENT_TIMETABLE, 'verified')
  await deleteSharedFile(admin, first.timetable.id)
  expect(await status(course.offeringId, STUDENT_TIMETABLE)).toBe('missing')
  await uploadFile(admin, { semesterId: course.semester.id, section: STUDENT_TIMETABLE, programCodeId: first.id }, pdf('students v2.pdf'))
  expect(await status(course.offeringId, STUDENT_TIMETABLE)).toBe('pending_review')
})

test('a switched-off section can be marked, and counts toward completeness while its status is Needs fix', async () => {
  const course = await createCourse()
  const notes = async () => statusOf(course.coordinator.client, course.offeringId, LECTURE_NOTES)
  await upload(course.lecturer.client, { offeringId: course.offeringId, section: LECTURE_NOTES }, 'notes.pdf')
  await mark(course.offeringId, LECTURE_NOTES, 'verified')
  expect(await notes()).toEqual({ section: LECTURE_NOTES, status: 'verified', counts_toward_completeness: true })

  expect((await switchSection(course.lecturer.client, course.offeringId, LECTURE_NOTES, false, 'Notes are in the textbook')).error).toBeNull()
  expect(await notes()).toEqual({ section: LECTURE_NOTES, status: 'off', counts_toward_completeness: false })

  await mark(course.offeringId, LECTURE_NOTES, 'needs_fix', 'The textbook does not cover weeks 8 to 14. Switch this back on.')
  for (const client of [course.coordinator.client, course.lecturer.client, auditor]) {
    expect(await statusOf(client, course.offeringId, LECTURE_NOTES)).toEqual({ section: LECTURE_NOTES, status: 'needs_fix', counts_toward_completeness: true })
  }

  await mark(course.offeringId, LECTURE_NOTES, 'verified', 'The textbook covers every week.')
  expect(await notes()).toEqual({ section: LECTURE_NOTES, status: 'verified', counts_toward_completeness: false })

  await mark(course.offeringId, LECTURE_NOTES, 'needs_fix', 'Switch this back on.')
  expect(await notes()).toEqual({ section: LECTURE_NOTES, status: 'needs_fix', counts_toward_completeness: true })
  expect((await switchSection(course.lecturer.client, course.offeringId, LECTURE_NOTES, true)).error).toBeNull()
  expect(await notes()).toEqual({ section: LECTURE_NOTES, status: 'pending_review', counts_toward_completeness: true })

  expect(await statusOf(auditor, course.offeringId, QUIZ)).toEqual({ section: QUIZ, status: 'off', counts_toward_completeness: false })
  await mark(course.offeringId, QUIZ, 'needs_fix', 'The course outline lists two quizzes.')
  expect(await statusOf(course.coordinator.client, course.offeringId, QUIZ)).toEqual({ section: QUIZ, status: 'needs_fix', counts_toward_completeness: true })
  expect((await switchSection(course.coordinator.client, course.offeringId, QUIZ, true, 'Two quizzes this semester')).error).toBeNull()
  expect(await statusOf(course.coordinator.client, course.offeringId, QUIZ)).toEqual({ section: QUIZ, status: 'missing', counts_toward_completeness: true })
})

test('a switched-off section counts while its latest verdict is Needs fix, and is Pending review once it changes', async () => {
  const course = await createCourse()
  const notes = async () => statusOf(course.coordinator.client, course.offeringId, LECTURE_NOTES)
  const place = { offeringId: course.offeringId, section: LECTURE_NOTES }
  const first = await upload(course.lecturer.client, place, 'part-1.pdf')
  await upload(course.lecturer.client, place, 'part-2.pdf')
  expect((await switchSection(course.lecturer.client, course.offeringId, LECTURE_NOTES, false, 'Notes are in the textbook')).error).toBeNull()
  await mark(course.offeringId, LECTURE_NOTES, 'needs_fix', 'The textbook does not cover weeks 8 to 14. Switch this back on.')

  await deleteFile(course.lecturer.client, first.id)
  expect(await notes()).toEqual({ section: LECTURE_NOTES, status: 'pending_review', counts_toward_completeness: true })

  await mark(course.offeringId, LECTURE_NOTES, 'verified', 'The textbook covers every week.')
  expect(await notes()).toEqual({ section: LECTURE_NOTES, status: 'verified', counts_toward_completeness: false })

  expect((await switchSection(course.lecturer.client, course.offeringId, LECTURE_NOTES, true)).error).toBeNull()
  await mark(course.offeringId, LECTURE_NOTES, 'needs_fix', 'Part 1 is missing.')
  expect((await switchSection(course.lecturer.client, course.offeringId, LECTURE_NOTES, false, 'Notes are in the textbook')).error).toBeNull()
  for (const client of [course.coordinator.client, course.lecturer.client, auditor]) {
    expect(await statusOf(client, course.offeringId, LECTURE_NOTES)).toEqual({ section: LECTURE_NOTES, status: 'pending_review', counts_toward_completeness: true })
  }
})

test('each verdict is logged with its comment, and section 5 verdicts name no program code', async () => {
  const course = await createCourse()
  const code = await programCodeWithTimetable(course.semester)
  await tick(course.coordinator.client, course.offeringId, code.id, true)
  await upload(course.lecturer.client, { offeringId: course.offeringId, section: TEACHING_PLAN }, 'plan.pdf')

  await mark(course.offeringId, STUDENT_TIMETABLE, 'needs_fix', ' Tick the second group too. ')
  await mark(course.offeringId, TEACHING_PLAN, 'verified')
  await mark(course.offeringId, QUIZ, 'verified', 'No quizzes, as the outline says.')

  const verdictRows = (rows: { action: string }[] | null) => rows?.filter((row) => row.action === 'verified' || row.action === 'needs_fix')
  const { data: log, error } = await course.lecturer.client
    .from('activity_log')
    .select('section, action, actor_id, comment, program_code_id, file_name, reason')
    .eq('offering_id', course.offeringId)
    .order('id')
  expect(error).toBeNull()
  const expected = [
    { section: STUDENT_TIMETABLE, action: 'needs_fix', actor_id: auditorId, comment: 'Tick the second group too.', program_code_id: null, file_name: null, reason: null },
    { section: TEACHING_PLAN, action: 'verified', actor_id: auditorId, comment: null, program_code_id: null, file_name: null, reason: null },
    { section: QUIZ, action: 'verified', actor_id: auditorId, comment: 'No quizzes, as the outline says.', program_code_id: null, file_name: null, reason: null },
  ]
  expect(verdictRows(log)).toEqual(expected)
  expect(log!.find((row) => row.action === 'tick')).toMatchObject({ section: STUDENT_TIMETABLE, program_code_id: code.id, comment: null })
  expect(log!.find((row) => row.action === 'upload')).toMatchObject({ section: TEACHING_PLAN, file_name: 'plan.pdf', comment: null })

  const { data: auditorLog } = await auditor.from('activity_log').select('section, action, actor_id, comment, program_code_id, file_name, reason').eq('offering_id', course.offeringId).order('id')
  expect(verdictRows(auditorLog)).toEqual(expected)
  expect((await course.outsider.client.from('activity_log').select('id').eq('offering_id', course.offeringId)).data).toEqual([])
})

test('verdicts are never changed or removed, not even by the service role', async () => {
  const course = await createCourse()
  await mark(course.offeringId, TEACHING_PLAN, 'needs_fix', 'Upload the teaching plan.')

  for (const client of [auditor, adminClient()]) {
    const update = await client.from('section_verdicts').update({ verdict: 'verified', comment: null }).eq('offering_id', course.offeringId)
    expect(update.error?.code).toBe(PERMISSION_DENIED)
    const remove = await client.from('section_verdicts').delete().eq('offering_id', course.offeringId)
    expect(remove.error?.code).toBe(PERMISSION_DENIED)
  }

  expect(await verdictsOf(course.coordinator.client, course.offeringId, TEACHING_PLAN)).toMatchObject([{ verdict: 'needs_fix', comment: 'Upload the teaching plan.' }])
})
