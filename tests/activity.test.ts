// Seam 1: the activity of a course file, as its Activity tab reads it with activityPage, and the
// activity log's append-only rule. Every lecturer, auditor and program code here is one the test
// creates, so the timetables are the test's own. tests/shared-files.test.ts covers the calendar and
// letter, since only its tests upload them.
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, inject, test } from 'vitest'
import { ACTIVITY_ACTIONS, activityNote, activityPage, describeActivity, type ActivityEntry } from '../src/activity.ts'
import { replyToAuditRequest, sendAuditRequest } from '../src/audit-requests.ts'
import { numberedPdf } from '../src/pdf/fixtures.ts'
import { GLOBAL_ROLES } from '../src/roles.ts'
import { deleteFile, deleteSharedFile, listReusableFiles, reuseFile, uploadFile } from '../src/uploads.ts'
import { adminClient, anonClient, createOffering, createUser, pickSemester, signIn, signInAs } from './harness.ts'

const PERMISSION_DENIED = '42501'

const TEACHING_PLAN = 2
const LECTURER_TIMETABLE = 4
const STUDENT_TIMETABLE = 5
const ATTENDANCE = 6
const LECTURE_NOTES = 10
const LAB_EXERCISES = 11

type User = { id: string; name: string; client: SupabaseClient }
type Semester = { id: string; code: string; start_year: number; number: number }
type ProgramCode = { id: string; code: string }

let admin: SupabaseClient

beforeAll(async () => {
  admin = await signInAs('admin')
})

/** A new user with the role and a name of their own, signed in. */
async function createPerson(role: 'lecturer' | 'auditor', label: string): Promise<User> {
  const user = await createUser({ roles: [role] })
  const name = `${label} ${randomUUID()}`
  const { error } = await adminClient().from('profiles').update({ full_name: name }).eq('id', user.id)
  if (error) throw error
  return { id: user.id, name, client: await signIn(user.email, user.password) }
}

/** An offering of a new course with a coordinator and a lecturer, and an outsider who teaches another offering in the semester. */
async function createCourse(semester?: Semester) {
  const [coordinator, lecturer, outsider] = await Promise.all([
    createPerson('lecturer', 'Coordinator'),
    createPerson('lecturer', 'Lecturer'),
    createPerson('lecturer', 'Outsider'),
  ])
  const picked = semester ?? (await pickSemester())
  const offering = await createOffering({ coordinatorId: coordinator.id, lecturerIds: [lecturer.id], semester: picked })
  await createOffering({ coordinatorId: outsider.id, semester: picked })
  return { offeringId: offering.id, course: offering.course, semester: picked, coordinator, lecturer, outsider }
}

async function pdf(name: string) {
  return new File([await numberedPdf(1)], name, { type: 'application/pdf' })
}

/** A new program code with a student timetable of this name in the semester, uploaded by the admin, and the timetable's file id. */
async function programCodeWithTimetable(semester: Semester, name: string): Promise<ProgramCode & { timetableId: string }> {
  const { data, error } = await adminClient().from('program_codes').insert({ code: `1 BITS S1G1 ${randomUUID()}` }).select('id, code').single()
  if (error) throw error
  const timetable = await uploadFile(admin, { semesterId: semester.id, section: STUDENT_TIMETABLE, programCodeId: data.id }, await pdf(name))
  return { ...data, timetableId: timetable.id }
}

async function tick(user: User, offeringId: string, programCode: ProgramCode, ticked: boolean) {
  const { error } = await user.client.rpc('tick_program_code', { offering_id: offeringId, program_code_id: programCode.id, ticked })
  if (error) throw error
}

async function switchSection(user: User, offeringId: string, section: number, isOn: boolean, reason?: string) {
  const { error } = await user.client.rpc('switch_section', { offering_id: offeringId, section, is_on: isOn, reason })
  if (error) throw error
}

async function mark(auditor: User, offeringId: string, section: number, verdict: 'verified' | 'needs_fix', comment?: string) {
  const { error } = await auditor.client.rpc('record_verdict', { offering_id: offeringId, section, verdict, comment })
  if (error) throw error
}

/** Two different semesters from pickSemester, earliest first. */
async function semestersInOrder(): Promise<[Semester, Semester]> {
  const first = await pickSemester()
  let second = await pickSemester()
  while (second.id === first.id) second = await pickSemester()
  const [earlier, later] = [first, second].toSorted((a, b) => a.start_year - b.start_year || a.number - b.number)
  return [earlier, later]
}

/** What the Activity tab shows for each entry: its action, actor, description and note. */
function shown(entries: ActivityEntry[]) {
  return entries.map((entry) => ({ action: entry.action, actor: entry.actor_name, description: describeActivity(entry), note: activityNote(entry) }))
}

/** The whole activity of the course file as this client reads it, which fits one page here. */
async function activityOf(client: SupabaseClient, offeringId: string) {
  const page = await activityPage(client, offeringId)
  expect(page.hasMore).toBe(false)
  return page.entries
}

test('the activity lists every kind of logged event of the course file, newest first, with its description and actor’s name', async () => {
  const [pastSemester, semester] = await semestersInOrder()
  const { offeringId, course, coordinator, lecturer } = await createCourse(semester)
  const [pastCoordinator, auditor] = await Promise.all([createPerson('lecturer', 'Past coordinator'), createPerson('auditor', 'Auditor')])
  // A past offering of the same course, which the lecturer does not teach, with notes to reuse.
  const { data: pastId, error } = await adminClient().rpc('create_offering', {
    semester_id: pastSemester.id,
    course_id: course.id,
    coordinator_id: pastCoordinator.id,
    lecturer_ids: [],
  })
  if (error) throw error
  await uploadFile(pastCoordinator.client, { offeringId: pastId, section: LECTURE_NOTES }, await pdf('old notes.pdf'))
  const ticked = await programCodeWithTimetable(semester, 'ticked students.pdf')
  const unticked = await programCodeWithTimetable(semester, 'unticked students.pdf')

  const plan = await uploadFile(lecturer.client, { offeringId, section: TEACHING_PLAN }, await pdf('plan.pdf'))
  await deleteFile(coordinator.client, plan.id)
  const [oldNotes] = await listReusableFiles(lecturer.client, { offeringId, section: LECTURE_NOTES })
  await reuseFile(lecturer.client, { offeringId, section: LECTURE_NOTES }, oldNotes.id)
  await switchSection(coordinator, offeringId, LAB_EXERCISES, true, ' Labs run this semester. ')
  await switchSection(coordinator, offeringId, LAB_EXERCISES, false)
  await uploadFile(lecturer.client, { semesterId: semester.id, section: LECTURER_TIMETABLE }, await pdf('timetable.pdf'))
  await tick(coordinator, offeringId, ticked, true)
  await tick(lecturer, offeringId, unticked, true)
  await tick(coordinator, offeringId, unticked, false)
  await mark(auditor, offeringId, LECTURER_TIMETABLE, 'verified', 'Both timetables are in.')
  await mark(auditor, offeringId, ATTENDANCE, 'needs_fix', 'Week 3 is missing.')
  const { data: request } = await auditor.client.from('audit_requests').select('id').eq('offering_id', offeringId).single()
  await sendAuditRequest(auditor.client, request!.id)
  expect((await lecturer.client.rpc('comment_on_audit_item', { request_id: request!.id, section: ATTENDANCE, comment: 'Week 3 was a holiday.' })).error).toBeNull()
  await replyToAuditRequest(coordinator.client, request!.id, 'Every section is answered.')
  // A deactivated user keeps their name in the activity.
  expect((await adminClient().from('profiles').update({ active: false }).eq('id', lecturer.id)).error).toBeNull()

  const entries = await activityOf(coordinator.client, offeringId)
  const adminName = 'Seam1 admin'
  expect(shown(entries)).toEqual([
    { action: 'reply', actor: coordinator.name, description: 'Replied to an audit request', note: 'Every section is answered.' },
    { action: 'comment', actor: lecturer.name, description: 'Commented on 6 Attendance Record in an audit request', note: 'Week 3 was a holiday.' },
    { action: 'send', actor: auditor.name, description: 'Sent an audit request to the coordinator and lecturers', note: null },
    { action: 'needs_fix', actor: auditor.name, description: 'Marked 6 Attendance Record Needs fix', note: 'Week 3 is missing.' },
    { action: 'verified', actor: auditor.name, description: 'Marked 4 Lecturer Timetable Verified', note: 'Both timetables are in.' },
    { action: 'untick', actor: coordinator.name, description: `Unticked program code ${unticked.code} in 5 Student Timetable`, note: null },
    { action: 'tick', actor: lecturer.name, description: `Ticked program code ${unticked.code} in 5 Student Timetable`, note: null },
    { action: 'tick', actor: coordinator.name, description: `Ticked program code ${ticked.code} in 5 Student Timetable`, note: null },
    { action: 'upload', actor: lecturer.name, description: 'Uploaded timetable.pdf to 4 Lecturer Timetable', note: null },
    { action: 'switch_off', actor: coordinator.name, description: 'Switched 11 Lab Exercises off', note: null },
    { action: 'switch_on', actor: coordinator.name, description: 'Switched 11 Lab Exercises on', note: 'Labs run this semester.' },
    {
      action: 'reuse',
      actor: lecturer.name,
      description: `Copied old notes.pdf into 10 Lecture Notes from ${course.code} ${pastSemester.code}`,
      note: null,
    },
    { action: 'delete', actor: coordinator.name, description: 'Deleted plan.pdf from 2 Teaching Plan', note: null },
    { action: 'upload', actor: lecturer.name, description: 'Uploaded plan.pdf to 2 Teaching Plan', note: null },
    // The timetable of the ticked code is linked, and the unticked code's is not.
    { action: 'upload', actor: adminName, description: `Uploaded ticked students.pdf to 5 Student Timetable for ${ticked.code}`, note: null },
  ])
  expect(new Set(entries.map((entry) => entry.action))).toEqual(new Set(Object.keys(ACTIVITY_ACTIONS)))
  expect(await activityOf(auditor.client, offeringId)).toEqual(entries)

  // The lecturer reads where the reused file came from, but neither the past offering nor its id.
  expect(entries.find((entry) => entry.action === 'reuse')).toEqual({
    id: expect.any(Number),
    created_at: expect.any(String),
    action: 'reuse',
    section: LECTURE_NOTES,
    actor_name: lecturer.name,
    file_name: 'old notes.pdf',
    program_code: null,
    source_course_code: course.code,
    source_semester_code: pastSemester.code,
    reason: null,
    comment: null,
  })
  expect((await lecturer.client.from('offerings').select('id').eq('id', pastId)).data).toEqual([])
})

test('the coordinator, lecturers, auditors, HoD, Dean, Deputy Dean and admin read the activity, and other lecturers, root and visitors cannot', async () => {
  const { offeringId, coordinator, lecturer, outsider } = await createCourse()
  await uploadFile(lecturer.client, { offeringId, section: TEACHING_PLAN }, await pdf('plan.pdf'))
  const expected = await activityOf(coordinator.client, offeringId)
  expect(expected.map((entry) => entry.action)).toEqual(['upload'])

  // The seeded HoD's department is not the course's: HoDs read every course file.
  const readers = [lecturer.client, ...(await Promise.all((['auditor', 'hod', 'dean', 'deputy_dean', 'admin'] as const).map(signInAs)))]
  for (const client of readers) expect(await activityPage(client, offeringId)).toEqual({ entries: expected, hasMore: false })

  for (const client of [outsider.client, await signInAs('lecturer'), await signInAs('root'), anonClient()]) {
    await expect(activityPage(client, offeringId)).rejects.toMatchObject({ code: PERMISSION_DENIED })
  }
  // An offering that does not exist is refused the same way.
  await expect(activityPage(admin, randomUUID())).rejects.toMatchObject({ code: PERMISSION_DENIED })
})

test('Load more continues after the last entry shown, with no entry twice or left out, while newer entries arrive', async () => {
  const { offeringId, coordinator } = await createCourse()
  // Lab Exercises is off by default, so it switches on with a reason and back off without one.
  for (let i = 0; i < 7; i++) await switchSection(coordinator, offeringId, LAB_EXERCISES, i % 2 === 0, `Run ${i}`)
  const all = await activityOf(coordinator.client, offeringId)
  expect(all).toHaveLength(7)

  const first = await activityPage(coordinator.client, offeringId, undefined, 3)
  await switchSection(coordinator, offeringId, LAB_EXERCISES, false)
  await switchSection(coordinator, offeringId, LAB_EXERCISES, true, 'Run 8')
  const second = await activityPage(coordinator.client, offeringId, first.entries.at(-1), 3)
  const third = await activityPage(coordinator.client, offeringId, second.entries.at(-1), 3)

  expect([first, second, third].map((page) => page.hasMore)).toEqual([true, true, false])
  expect([...first.entries, ...second.entries, ...third.entries]).toEqual(all)
  const now = await activityOf(coordinator.client, offeringId)
  expect(shown(now.slice(0, 2))).toEqual([
    { action: 'switch_on', actor: coordinator.name, description: 'Switched 11 Lab Exercises on', note: 'Run 8' },
    { action: 'switch_off', actor: coordinator.name, description: 'Switched 11 Lab Exercises off', note: null },
  ])
  expect(now.slice(2)).toEqual(all)
})

test('the activity holds the timetable entries of the lecturers the offering has and the program codes it ticks, as its linked files do', async () => {
  const { offeringId, semester, coordinator, lecturer, outsider } = await createCourse()
  const newcomer = await createPerson('lecturer', 'Newcomer')
  await createOffering({ coordinatorId: newcomer.id, semester })
  const timetable = { semesterId: semester.id, section: LECTURER_TIMETABLE }

  const first = await uploadFile(coordinator.client, timetable, await pdf('coordinator.pdf'))
  await deleteSharedFile(coordinator.client, first.id)
  await uploadFile(coordinator.client, timetable, await pdf('coordinator again.pdf'))
  await uploadFile(outsider.client, timetable, await pdf('outsider.pdf'))
  await uploadFile(newcomer.client, timetable, await pdf('newcomer.pdf'))
  const ticked = await programCodeWithTimetable(semester, 'ticked.pdf')
  await programCodeWithTimetable(semester, 'other.pdf')
  await tick(coordinator, offeringId, ticked, true)
  await deleteSharedFile(admin, ticked.timetableId)

  /** The descriptions of the entries of shared files in the activity, and the names of the linked files, newest first. */
  const sharedActivity = async () => {
    const entries = await activityOf(coordinator.client, offeringId)
    const { data, error } = await coordinator.client.from('offerings').select('linked_files(name, uploaded_at)').eq('id', offeringId).single()
    if (error) throw error
    return {
      entries: entries.filter((entry) => entry.file_name && [LECTURER_TIMETABLE, STUDENT_TIMETABLE].includes(entry.section!)).map(describeActivity),
      linked: data.linked_files.toSorted((a: { uploaded_at: string }, b: { uploaded_at: string }) => b.uploaded_at.localeCompare(a.uploaded_at)).map((file: { name: string }) => file.name),
    }
  }
  const own = [
    'Uploaded coordinator again.pdf to 4 Lecturer Timetable',
    'Deleted coordinator.pdf from 4 Lecturer Timetable',
    'Uploaded coordinator.pdf to 4 Lecturer Timetable',
  ]
  // A deleted timetable leaves no linked file, but its entries stay while its key is linked.
  const tickedEntries = [`Deleted ticked.pdf from 5 Student Timetable for ${ticked.code}`, `Uploaded ticked.pdf to 5 Student Timetable for ${ticked.code}`]
  expect(await sharedActivity()).toEqual({ entries: [...tickedEntries, ...own], linked: ['coordinator again.pdf'] })

  // A lecturer assigned later brings their timetable and its entries, and takes them along when unassigned.
  const assign = async (lecturerIds: string[]) => {
    const { error } = await admin.rpc('set_offering_lecturers', { offering_id: offeringId, coordinator_id: coordinator.id, lecturer_ids: lecturerIds })
    if (error) throw error
  }
  await assign([lecturer.id, newcomer.id])
  expect(await sharedActivity()).toEqual({
    entries: [...tickedEntries, 'Uploaded newcomer.pdf to 4 Lecturer Timetable', ...own],
    linked: ['newcomer.pdf', 'coordinator again.pdf'],
  })
  await assign([lecturer.id])
  expect(await sharedActivity()).toEqual({ entries: [...tickedEntries, ...own], linked: ['coordinator again.pdf'] })

  // Unticking the code takes its timetable's entries out, and its tick and untick stay.
  await tick(coordinator, offeringId, ticked, false)
  expect(await sharedActivity()).toEqual({ entries: own, linked: ['coordinator again.pdf'] })
  expect((await activityOf(coordinator.client, offeringId)).map((entry) => entry.action).filter((action) => action.endsWith('tick'))).toEqual(['untick', 'tick'])
})

test('nobody changes or removes log entries, and clients cannot add any: every client role is refused, and so is the service role', async () => {
  const { offeringId, coordinator, lecturer } = await createCourse()
  await uploadFile(lecturer.client, { offeringId, section: TEACHING_PLAN }, await pdf('plan.pdf'))
  const before = await activityPage(coordinator.client, offeringId)
  const [entry] = before.entries

  const clients = [anonClient(), coordinator.client, lecturer.client, ...(await Promise.all(GLOBAL_ROLES.map(signInAs)))]
  for (const client of clients) {
    const log = () => client.from('activity_log')
    expect((await log().update({ file_name: 'changed.pdf' }).eq('id', entry.id)).error?.code).toBe(PERMISSION_DENIED)
    expect((await log().delete().eq('id', entry.id)).error?.code).toBe(PERMISSION_DENIED)
    const forged = { offering_id: offeringId, section: TEACHING_PLAN, action: 'upload', actor_id: coordinator.id, file_name: 'forged.pdf' }
    expect((await log().insert(forged)).error?.code).toBe(PERMISSION_DENIED)
  }
  const service = () => adminClient().from('activity_log')
  expect((await service().update({ file_name: 'changed.pdf' }).eq('id', entry.id)).error?.code).toBe(PERMISSION_DENIED)
  expect((await service().delete().eq('id', entry.id)).error?.code).toBe(PERMISSION_DENIED)

  expect(await activityPage(coordinator.client, offeringId)).toEqual(before)
})

test('every action that the activity log records has a description', async () => {
  // The API's OpenAPI description lists the values of the activity_action enum.
  const { url, secretKey } = inject('stack')
  const response = await fetch(`${url}/rest/v1/`, { headers: { apikey: secretKey } })
  const spec = (await response.json()) as { definitions: Record<string, { properties: Record<string, { enum: string[] }> }> }
  expect(spec.definitions.activity_log.properties.action.enum.toSorted()).toEqual(Object.keys(ACTIVITY_ACTIONS).toSorted())
})
