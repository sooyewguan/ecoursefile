// Seam 1: audit requests from draft to sent to replied. Auditors mark sections Needs fix, send the
// draft through the audit-requests function, staff work through the checklist and reply, all as
// the app does. Each user turns push notifications on in one browser, and the notifications are read
// from the fake push outbox. Every auditor, lecturer and program code here is one the test creates,
// so the outbox and the timetables are the test's own.
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { AuditRequestError, replyToAuditRequest, sendAuditRequest } from '../src/audit-requests.ts'
import { sizedPdf } from '../src/pdf/fixtures.ts'
import { deleteFile, listReusableFiles, reuseFile, uploadFile, type Slot } from '../src/uploads.ts'
import { adminClient, createOffering, createUser, fakePushOutbox, pickSemester, registerPushToken, signIn, signInAs } from './harness.ts'

const PERMISSION_DENIED = '42501'
const CHECK_VIOLATION = '23514'

const TEACHING_PLAN = 2
const LECTURER_TIMETABLE = 4
const STUDENT_TIMETABLE = 5
const ATTENDANCE = 6
const REPLACEMENT_NOTICES = 7
const LECTURE_NOTES = 10
const LAB_EXERCISES = 11
const WEEK_12_MARKS = 17
const GRADE_LIST = 18

/** A user signed in on a browser with push notifications on, whose token is token. */
type User = { id: string; email: string; client: SupabaseClient; token: string }
type Semester = { id: string; code: string; start_year: number; number: number }

/** An offering whose course type has sections 10 and 12 on, with a coordinator and a lecturer, and a lecturer of another offering. */
type Course = { offeringId: string; courseId: string; semester: Semester; coordinator: User; lecturer: User; outsider: User }

type Item = { section: number; ticked: boolean; comment: string | null; commenter_name: string | null; verdict: { comment: string } }

type AuditRequest = {
  id: string
  state: string
  auditor_id: string
  auditor_name: string
  replier_name: string | null
  reply_message: string | null
  checklist_complete: boolean
  notification_pending: boolean
  items: Item[]
}

async function createPerson(role: 'lecturer' | 'auditor'): Promise<User> {
  const user = await createUser({ roles: [role] })
  const client = await signIn(user.email, user.password)
  return { id: user.id, email: user.email, client, token: await registerPushToken(client) }
}

async function createCourse(options: { lecturers?: User[]; semester?: Semester } = {}): Promise<Course> {
  const [coordinator, lecturer, outsider] = await Promise.all([createPerson('lecturer'), createPerson('lecturer'), createPerson('lecturer')])
  const semester = options.semester ?? (await pickSemester())
  const offering = await createOffering({
    coordinatorId: coordinator.id,
    lecturerIds: [lecturer.id, ...(options.lecturers ?? []).map((user) => user.id)],
    semester,
  })
  await createOffering({ coordinatorId: outsider.id })
  return { offeringId: offering.id, courseId: offering.course.id, semester, coordinator, lecturer, outsider }
}

function pdf(name: string) {
  return new File([sizedPdf(1024)], name, { type: 'application/pdf' })
}

function upload(client: SupabaseClient, slot: Slot, name: string) {
  return uploadFile(client, slot, pdf(name))
}

/** Records the verdict as this auditor, the way the section page does, and fails the test if it is refused. */
async function mark(auditor: User, offeringId: string, section: number, verdict: 'verified' | 'needs_fix', comment?: string) {
  const { error } = await auditor.client.rpc('record_verdict', { offering_id: offeringId, section, verdict, comment })
  if (error) throw error
}

/** The offering's audit requests that this client reads, oldest first, each with its items in section order. */
async function requestsOf(client: SupabaseClient, offeringId: string): Promise<AuditRequest[]> {
  const { data, error } = await client
    .from('audit_requests')
    .select(
      'id, state, auditor_id, auditor_name, replier_name, reply_message, checklist_complete, notification_pending, items:audit_request_items(section, ticked, comment, commenter_name, verdict:section_verdicts(comment))',
    )
    .eq('offering_id', offeringId)
    .order('created_at')
  if (error) throw error
  return (data as unknown as AuditRequest[]).map((request) => ({ ...request, items: request.items.toSorted((a, b) => a.section - b.section) }))
}

/** The auditor's one request on the offering in this state. */
async function requestIn(auditor: User, offeringId: string, state: string) {
  const found = (await requestsOf(auditor.client, offeringId)).filter((request) => request.state === state)
  expect(found).toHaveLength(1)
  return found[0]
}

/** Each item's section and whether it is ticked, as this client reads the request. */
async function ticks(client: SupabaseClient, offeringId: string, requestId: string) {
  const request = (await requestsOf(client, offeringId)).find((r) => r.id === requestId)!
  return Object.fromEntries(request.items.map((item) => [item.section, item.ticked]))
}

function comment(client: SupabaseClient, requestId: string, section: number, text: string | null) {
  return client.rpc('comment_on_audit_item', { request_id: requestId, section, comment: text })
}

/** The refusal of a send or reply, as its code and HTTP status. */
async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (error: unknown) => error,
  )
  if (!(error instanceof AuditRequestError)) throw new Error(`Expected a refusal, got ${String(error)}`)
  return { code: error.code, status: error.status }
}

/** The offering's activity log rows of sends, comments and replies, oldest first, as this client reads them. */
async function requestActivity(client: SupabaseClient, offeringId: string) {
  const { data, error } = await client
    .from('activity_log')
    .select('action, section, actor_id, audit_request_id, comment')
    .eq('offering_id', offeringId)
    .in('action', ['send', 'comment', 'reply'])
    .order('id')
  if (error) throw error
  return data
}

/** Deactivates or reactivates the user's profile with the service role, as an admin would. Their session goes on until its token expires. */
async function setActive(userId: string, active: boolean) {
  const { error } = await adminClient().from('profiles').update({ active }).eq('id', userId)
  if (error) throw error
}

/** Makes the fake push service fail, or take again, a notification to this token. */
async function setUndeliverable(token: string, undeliverable: boolean) {
  const table = adminClient().schema('fake_push').from('undeliverable')
  const { error } = undeliverable ? await table.insert({ token }) : await table.delete().eq('token', token)
  if (error) throw error
}

/** The notifications that went to the user's browser, oldest first. */
function outboxOf(user: User) {
  return fakePushOutbox(user.token)
}

test('Needs fix marks collect into the auditor’s draft, which only they read, and nobody is notified before Send', async () => {
  const course = await createCourse()
  const auditor = await createPerson('auditor')
  await upload(course.lecturer.client, { offeringId: course.offeringId, section: TEACHING_PLAN }, 'plan.pdf')

  await mark(auditor, course.offeringId, TEACHING_PLAN, 'needs_fix', 'Sign the plan.')
  await mark(auditor, course.offeringId, ATTENDANCE, 'needs_fix', 'Week 3 is missing.')
  await mark(auditor, course.offeringId, TEACHING_PLAN, 'needs_fix', 'Sign and date the plan.')
  await mark(auditor, course.offeringId, REPLACEMENT_NOTICES, 'verified')

  const [draft] = await requestsOf(auditor.client, course.offeringId)
  expect(draft).toMatchObject({ state: 'draft', auditor_id: auditor.id, auditor_name: 'Seam1 User', notification_pending: false })
  expect(draft.items.map(({ section, ticked, comment, verdict }) => ({ section, ticked, comment, verdict }))).toEqual([
    { section: TEACHING_PLAN, ticked: false, comment: null, verdict: { comment: 'Sign and date the plan.' } },
    { section: ATTENDANCE, ticked: false, comment: null, verdict: { comment: 'Week 3 is missing.' } },
  ])

  const others = [course.coordinator, course.lecturer, course.outsider, await createPerson('auditor')].map((user) => user.client)
  for (const client of [...others, await signInAs('hod'), await signInAs('admin'), await signInAs('root')]) {
    expect(await requestsOf(client, course.offeringId)).toEqual([])
    expect((await client.from('audit_request_items').select('section').eq('request_id', draft.id)).data).toEqual([])
  }
  for (const user of [course.coordinator, course.lecturer]) expect(await outboxOf(user)).toEqual([])
  expect(await requestActivity(adminClient(), course.offeringId)).toEqual([])

  // A Verified takes the section out of the draft, and a draft left empty goes.
  await mark(auditor, course.offeringId, ATTENDANCE, 'verified')
  expect((await requestsOf(auditor.client, course.offeringId))[0].items.map((item) => item.section)).toEqual([TEACHING_PLAN])
  await mark(auditor, course.offeringId, TEACHING_PLAN, 'verified')
  expect(await requestsOf(auditor.client, course.offeringId)).toEqual([])
})

test('clients write requests and items only through the RPCs', async () => {
  const course = await createCourse()
  const auditor = await createPerson('auditor')
  await mark(auditor, course.offeringId, TEACHING_PLAN, 'needs_fix', 'Upload the plan.')
  const draft = await requestIn(auditor, course.offeringId, 'draft')

  for (const client of [auditor.client, course.coordinator.client]) {
    expect((await client.from('audit_requests').insert({ offering_id: course.offeringId, auditor_id: auditor.id })).error?.code).toBe(PERMISSION_DENIED)
    expect((await client.from('audit_requests').update({ state: 'replied' }).eq('id', draft.id)).error?.code).toBe(PERMISSION_DENIED)
    expect((await client.from('audit_request_items').update({ comment: 'Done' }).eq('request_id', draft.id)).error?.code).toBe(PERMISSION_DENIED)
  }
  expect((await requestIn(auditor, course.offeringId, 'draft')).items).toHaveLength(1)
})

test('clients cannot send or reply through the RPCs, so every step goes through the function and its notification', async () => {
  const course = await createCourse()
  const { offeringId, coordinator, lecturer } = course
  const auditor = await createPerson('auditor')
  await mark(auditor, offeringId, TEACHING_PLAN, 'needs_fix', 'Upload the plan.')
  const { id } = await requestIn(auditor, offeringId, 'draft')

  // Whichever arguments a client passes, the step is refused and the request stays as it was. A
  // call with the RPC's own arguments finds it, so the grant refuses it.
  expect((await auditor.client.rpc('send_audit_request', { request_id: id })).error).not.toBeNull()
  expect((await auditor.client.rpc('send_audit_request', { request_id: id, actor_id: auditor.id })).error?.code).toBe(PERMISSION_DENIED)
  expect((await requestIn(auditor, offeringId, 'draft')).id).toBe(id)
  expect(await outboxOf(coordinator)).toEqual([])

  await sendAuditRequest(auditor.client, id)
  expect((await comment(lecturer.client, id, TEACHING_PLAN, 'The plan is in section 1.')).error).toBeNull()
  expect((await coordinator.client.rpc('reply_to_audit_request', { request_id: id })).error).not.toBeNull()
  for (const args of [{ request_id: id, actor_id: coordinator.id }, { request_id: id, actor_id: coordinator.id, message: 'Done.' }]) {
    expect((await coordinator.client.rpc('reply_to_audit_request', args)).error?.code).toBe(PERMISSION_DENIED)
  }
  expect(await requestsOf(auditor.client, offeringId)).toMatchObject([{ id, state: 'sent', checklist_complete: true }])
  expect(await outboxOf(auditor)).toEqual([])
  expect((await requestActivity(adminClient(), offeringId)).map((row) => row.action)).toEqual(['send', 'comment'])
})

test('a user deactivated while signed in can neither send nor reply', async () => {
  const course = await createCourse()
  const { offeringId, coordinator, lecturer } = course
  const auditor = await createPerson('auditor')
  await mark(auditor, offeringId, ATTENDANCE, 'needs_fix', 'Upload the attendance.')
  const { id } = await requestIn(auditor, offeringId, 'draft')

  await setActive(auditor.id, false)
  expect(await refusal(sendAuditRequest(auditor.client, id))).toEqual({ code: 'forbidden', status: 403 })
  await setActive(auditor.id, true)
  await sendAuditRequest(auditor.client, id)

  await upload(lecturer.client, { offeringId, section: ATTENDANCE }, 'attendance.pdf')
  await setActive(lecturer.id, false)
  expect(await refusal(replyToAuditRequest(lecturer.client, id))).toEqual({ code: 'forbidden', status: 403 })
  expect(await requestsOf(coordinator.client, offeringId)).toMatchObject([{ id, state: 'sent', checklist_complete: true }])
  expect(await outboxOf(auditor)).toEqual([])
})

test('Send notifies the coordinator and every lecturer once, and a second Send changes nothing', async () => {
  const leaver = await createPerson('lecturer')
  const course = await createCourse({ lecturers: [leaver] })
  await setActive(leaver.id, false)
  const auditor = await createPerson('auditor')
  const otherAuditor = await createPerson('auditor')
  await mark(auditor, course.offeringId, TEACHING_PLAN, 'needs_fix', 'The plan is for <script>alert("x")</script> & another course.\nUpload the right one.')
  await mark(auditor, course.offeringId, REPLACEMENT_NOTICES, 'needs_fix', 'Upload the notice for week 5.')
  const draft = await requestIn(auditor, course.offeringId, 'draft')

  // Nobody else finds the draft, and only its auditor sends it.
  for (const user of [course.coordinator, otherAuditor]) {
    expect(await refusal(sendAuditRequest(user.client, draft.id))).toEqual({ code: 'not_found', status: 404 })
  }
  const results = await Promise.all([sendAuditRequest(auditor.client, draft.id), sendAuditRequest(auditor.client, draft.id)])
  expect(results.map((result) => result.request)).toEqual([
    { id: draft.id, state: 'sent' },
    { id: draft.id, state: 'sent' },
  ])
  expect(await refusal(sendAuditRequest(otherAuditor.client, draft.id))).toEqual({ code: 'forbidden', status: 403 })
  await sendAuditRequest(auditor.client, draft.id)

  const [toCoordinator, toLecturer] = await Promise.all([outboxOf(course.coordinator), outboxOf(course.lecturer)])
  expect(toCoordinator).toHaveLength(1)
  expect(toLecturer).toHaveLength(1)
  const [notification] = toCoordinator
  expect(toLecturer[0]).toEqual({ ...notification, token: course.lecturer.token })
  expect(notification.title).toMatch(/^Audit request for BITP-[0-9a-f-]+$/)
  expect(notification.body).toMatch(/^Seam1 User asks you to fix 2 sections of the course file of BITP-[0-9a-f-]+ Seam1 Course, \d{4}\/\d{4}-\d\.$/)
  expect(notification.link).toBe(`/course-files/${course.offeringId}#audit-request-${draft.id}`)
  expect(await outboxOf(leaver)).toEqual([])

  // Staff now read the request as their checklist.
  for (const user of [course.coordinator, course.lecturer, otherAuditor]) {
    const [sent] = await requestsOf(user.client, course.offeringId)
    expect(sent).toMatchObject({ id: draft.id, state: 'sent', notification_pending: false, checklist_complete: false })
    expect(sent.items.map((item) => item.section)).toEqual([TEACHING_PLAN, REPLACEMENT_NOTICES])
  }
  expect(await requestsOf(course.outsider.client, course.offeringId)).toEqual([])
  expect(await requestActivity(course.lecturer.client, course.offeringId)).toEqual([
    { action: 'send', section: null, actor_id: auditor.id, audit_request_id: draft.id, comment: null },
  ])
})

test('a checklist item ticks itself when its section gets a file after the send, by upload, reuse or a linked shared file', async () => {
  const [past, current] = await semestersInOrder()
  const course = await createCourse({ semester: current })
  const { offeringId, coordinator, lecturer } = course
  const pastOfferingId = await offerAgain(course, past)
  await upload(coordinator.client, { offeringId: pastOfferingId, section: LECTURE_NOTES }, 'old notes.pdf')
  const programCode = await programCodeWithTimetable(current)
  const plan = await upload(lecturer.client, { offeringId, section: TEACHING_PLAN }, 'plan.pdf')
  const marks = await upload(lecturer.client, { offeringId, section: WEEK_12_MARKS }, 'marks.pdf')
  const auditor = await createPerson('auditor')
  const flagged = [TEACHING_PLAN, LECTURER_TIMETABLE, STUDENT_TIMETABLE, ATTENDANCE, LECTURE_NOTES, WEEK_12_MARKS]
  for (const section of flagged) await mark(auditor, offeringId, section, 'needs_fix', 'Fix this.')
  // A file uploaded before the send does not tick its item.
  await upload(lecturer.client, { offeringId, section: ATTENDANCE }, 'early attendance.pdf')
  const { id } = await requestIn(auditor, offeringId, 'draft')
  await sendAuditRequest(auditor.client, id)
  const expectTicks = async (ticked: number[]) => {
    expect(await ticks(lecturer.client, offeringId, id)).toEqual(Object.fromEntries(flagged.map((section) => [section, ticked.includes(section)])))
  }
  await expectTicks([])

  // Reordering or deleting files does not tick an item.
  const second = await upload(lecturer.client, { offeringId, section: TEACHING_PLAN }, 'plan 2.pdf')
  await expectTicks([TEACHING_PLAN])
  await deleteFile(lecturer.client, second.id)
  await deleteFile(lecturer.client, plan.id)
  expect((await coordinator.client.rpc('reorder_files', { file_ids: [marks.id] })).error).toBeNull()
  await expectTicks([])

  await upload(coordinator.client, { offeringId, section: TEACHING_PLAN }, 'signed plan.pdf')
  await upload(lecturer.client, { offeringId, section: ATTENDANCE }, 'attendance.pdf')
  const [reusable] = await listReusableFiles(coordinator.client, { offeringId, section: LECTURE_NOTES })
  await reuseFile(coordinator.client, { offeringId, section: LECTURE_NOTES }, reusable.id)
  await expectTicks([TEACHING_PLAN, ATTENDANCE, LECTURE_NOTES])

  // Shared files tick an item when the course file links them after the send.
  const { error } = await lecturer.client.rpc('tick_program_code', { offering_id: offeringId, program_code_id: programCode, ticked: true })
  if (error) throw error
  await uploadFile(lecturer.client, { semesterId: current.id, section: LECTURER_TIMETABLE }, pdf('timetable.pdf'))
  await expectTicks([TEACHING_PLAN, LECTURER_TIMETABLE, STUDENT_TIMETABLE, ATTENDANCE, LECTURE_NOTES])
  expect((await requestsOf(auditor.client, offeringId))[0].checklist_complete).toBe(false)
})

test('Reply is refused while any item is neither ticked nor commented, and only the offering’s staff comment and reply', async () => {
  const course = await createCourse()
  const { offeringId, coordinator, lecturer, outsider } = course
  const auditor = await createPerson('auditor')
  await mark(auditor, offeringId, TEACHING_PLAN, 'needs_fix', 'Upload the plan.')
  // Lab Exercises is off for this offering, so staff cannot upload to it and answer with a comment.
  await mark(auditor, offeringId, LAB_EXERCISES, 'needs_fix', 'This course has labs. Switch the section on.')
  const { id } = await requestIn(auditor, offeringId, 'draft')

  expect(await refusal(replyToAuditRequest(coordinator.client, id))).toEqual({ code: 'not_found', status: 404 })
  await sendAuditRequest(auditor.client, id)
  expect(await refusal(replyToAuditRequest(coordinator.client, id, 'Done.'))).toEqual({ code: 'checklist_incomplete', status: 409 })
  // Who may reply is decided before the checklist, so a reader who may not reply is told so while items are open.
  for (const client of [auditor.client, await signInAs('admin')]) {
    expect(await refusal(replyToAuditRequest(client, id))).toEqual({ code: 'forbidden', status: 403 })
  }

  for (const client of [outsider.client, auditor.client, (await signInAs('admin')), (await signInAs('root'))]) {
    expect((await comment(client, id, LAB_EXERCISES, 'Labs ran online.')).error?.code).toBe(PERMISSION_DENIED)
  }
  expect((await comment(lecturer.client, id, ATTENDANCE, 'Not an item.')).error?.code).toBe(PERMISSION_DENIED)
  for (const blank of [null, '', ' \n ']) {
    expect((await comment(lecturer.client, id, LAB_EXERCISES, blank)).error?.code).toBe(CHECK_VIOLATION)
  }
  expect((await comment(lecturer.client, id, LAB_EXERCISES, '  The labs were cancelled this semester.  ')).error).toBeNull()
  expect(await refusal(replyToAuditRequest(coordinator.client, id))).toEqual({ code: 'checklist_incomplete', status: 409 })

  await upload(lecturer.client, { offeringId, section: TEACHING_PLAN }, 'plan.pdf')
  const [ready] = await requestsOf(auditor.client, offeringId)
  expect(ready.checklist_complete).toBe(true)
  expect(ready.items.map(({ section, ticked, comment, commenter_name }) => ({ section, ticked, comment, commenter_name }))).toEqual([
    { section: TEACHING_PLAN, ticked: true, comment: null, commenter_name: null },
    { section: LAB_EXERCISES, ticked: false, comment: 'The labs were cancelled this semester.', commenter_name: 'Seam1 User' },
  ])
  expect(await refusal(replyToAuditRequest(outsider.client, id))).toEqual({ code: 'not_found', status: 404 })
  expect(await refusal(replyToAuditRequest(auditor.client, id))).toEqual({ code: 'forbidden', status: 403 })
  expect(await outboxOf(auditor)).toEqual([])
  expect((await requestIn(auditor, offeringId, 'sent')).id).toBe(id)
})

test('Reply notifies the auditor once and shows in the app, and the log holds the send, the comments and the reply', async () => {
  const course = await createCourse()
  const { offeringId, coordinator, lecturer, outsider } = course
  const auditor = await createPerson('auditor')
  await mark(auditor, offeringId, TEACHING_PLAN, 'needs_fix', 'Upload the plan.')
  await mark(auditor, offeringId, REPLACEMENT_NOTICES, 'needs_fix', 'Upload the notice for week 5.')
  const { id } = await requestIn(auditor, offeringId, 'draft')
  await sendAuditRequest(auditor.client, id)
  await upload(lecturer.client, { offeringId, section: TEACHING_PLAN }, 'plan.pdf')
  expect((await comment(lecturer.client, id, REPLACEMENT_NOTICES, 'No class was <i>replaced</i>.')).error).toBeNull()
  expect((await comment(lecturer.client, id, REPLACEMENT_NOTICES, 'No class was <i>replaced</i>.')).error).toBeNull()

  const message = 'All done. See the plan & the comment.\nThanks <b>Auditor</b>'
  const results = await Promise.all([replyToAuditRequest(coordinator.client, id, message), replyToAuditRequest(lecturer.client, id, 'A second click')])
  expect(results.map((result) => result.request)).toEqual([
    { id, state: 'replied' },
    { id, state: 'replied' },
  ])
  await replyToAuditRequest(coordinator.client, id, message)

  const sent = await outboxOf(auditor)
  expect(sent).toHaveLength(1)
  const [notification] = sent
  expect(notification.title).toMatch(/^Reply to your audit request for BITP-[0-9a-f-]+$/)
  expect(notification.body).toMatch(/^Seam1 User replied to your audit request for BITP-[0-9a-f-]+ Seam1 Course, \d{4}\/\d{4}-\d\. "/)
  expect(notification.link).toBe(`/course-files/${offeringId}#audit-request-${id}`)

  // Whichever click won, the request shows one reply, to the auditor and to staff.
  for (const client of [auditor.client, coordinator.client, lecturer.client]) {
    const [replied] = await requestsOf(client, offeringId)
    expect(replied).toMatchObject({ state: 'replied', replier_name: 'Seam1 User', notification_pending: false })
    expect([message, 'A second click']).toContain(replied.reply_message)
    expect(notification.body.endsWith(` "${replied.reply_message}"`)).toBe(true)
  }
  const [replied] = await requestsOf(auditor.client, offeringId)
  const replierId = replied.reply_message === message ? coordinator.id : lecturer.id
  expect(await requestActivity(lecturer.client, offeringId)).toEqual([
    { action: 'send', section: null, actor_id: auditor.id, audit_request_id: id, comment: null },
    { action: 'comment', section: REPLACEMENT_NOTICES, actor_id: lecturer.id, audit_request_id: id, comment: 'No class was <i>replaced</i>.' },
    { action: 'reply', section: null, actor_id: replierId, audit_request_id: id, comment: replied.reply_message },
  ])
  expect(await requestActivity(outsider.client, offeringId)).toEqual([])

  // A replied checklist no longer changes.
  expect((await comment(lecturer.client, id, REPLACEMENT_NOTICES, 'Later.')).error?.code).toBe(PERMISSION_DENIED)
})

test('the notifications and the app name the auditor, the commenter and the replier by their title and name', async () => {
  const chong = await createPerson('lecturer')
  const course = await createCourse({ lecturers: [chong] })
  const { offeringId, coordinator, lecturer: bala } = course
  const auditor = await createPerson('auditor')
  for (const [user, fullName, title] of [
    [coordinator, 'Zainab Audit', 'Dr.'],
    [bala, 'Bala Audit', 'Ts.'],
    [chong, 'Chong Audit', null],
    [auditor, 'Aminah Audit', 'Prof. Madya'],
  ] as const) {
    expect((await user.client.rpc('update_my_profile', { full_name: fullName, title })).error).toBeNull()
  }
  await mark(auditor, offeringId, TEACHING_PLAN, 'needs_fix', 'Upload the plan.')
  const { id } = await requestIn(auditor, offeringId, 'draft')

  await sendAuditRequest(auditor.client, id)
  expect((await comment(bala.client, id, TEACHING_PLAN, 'The plan is on its way.')).error).toBeNull()
  await replyToAuditRequest(coordinator.client, id)

  const sent = await fakePushOutbox(coordinator.token, bala.token, chong.token)
  expect(sent.map((notification) => notification.token).toSorted()).toEqual([coordinator.token, bala.token, chong.token].toSorted())
  for (const notification of sent) expect(notification.body).toMatch(/^Prof\. Madya Aminah Audit asks you to fix a section of the course file of /)
  const [reply] = await outboxOf(auditor)
  expect(reply.body).toMatch(/^Dr\. Zainab Audit replied to your audit request for /)
  const [shown] = await requestsOf(chong.client, offeringId)
  expect(shown).toMatchObject({ auditor_name: 'Prof. Madya Aminah Audit', replier_name: 'Dr. Zainab Audit' })
  expect(shown.items.map((item) => item.commenter_name)).toEqual(['Ts. Bala Audit'])
})

test('a Needs fix after the send or after the reply goes into a new request, and the earlier ones stay as they were', async () => {
  const course = await createCourse()
  const { offeringId, coordinator, lecturer } = course
  const auditor = await createPerson('auditor')
  await mark(auditor, offeringId, TEACHING_PLAN, 'needs_fix', 'Upload the plan.')
  const first = await requestIn(auditor, offeringId, 'draft')
  await sendAuditRequest(auditor.client, first.id)

  await mark(auditor, offeringId, ATTENDANCE, 'needs_fix', 'Upload the attendance.')
  const second = await requestIn(auditor, offeringId, 'draft')
  expect(second.id).not.toBe(first.id)
  expect(second.items.map((item) => item.section)).toEqual([ATTENDANCE])
  await sendAuditRequest(auditor.client, second.id)

  await upload(lecturer.client, { offeringId, section: TEACHING_PLAN }, 'plan.pdf')
  await replyToAuditRequest(coordinator.client, first.id)
  await mark(auditor, offeringId, TEACHING_PLAN, 'needs_fix', 'The plan is not signed.')
  const third = await requestIn(auditor, offeringId, 'draft')

  const requests = await requestsOf(auditor.client, offeringId)
  expect(requests.map(({ id, state, items }) => ({ id, state, sections: items.map((item) => item.section) }))).toEqual([
    { id: first.id, state: 'replied', sections: [TEACHING_PLAN] },
    { id: second.id, state: 'sent', sections: [ATTENDANCE] },
    { id: third.id, state: 'draft', sections: [TEACHING_PLAN] },
  ])
  expect(requests[0].items[0]).toMatchObject({ ticked: true, verdict: { comment: 'Upload the plan.' } })
  expect(requests[2].items[0]).toMatchObject({ ticked: false, verdict: { comment: 'The plan is not signed.' } })
  // The replied request keeps its tick as it was at the reply.
  const plans = await lecturer.client.from('files').select('id').eq('offering_id', offeringId).eq('section', TEACHING_PLAN)
  for (const file of plans.data!) await deleteFile(coordinator.client, file.id)
  expect(await ticks(lecturer.client, offeringId, first.id)).toEqual({ [TEACHING_PLAN]: true })
})

test('two auditors hold separate requests on the same course file', async () => {
  const course = await createCourse()
  const { offeringId, coordinator } = course
  const [first, second] = await Promise.all([createPerson('auditor'), createPerson('auditor')])
  await Promise.all([
    mark(first, offeringId, TEACHING_PLAN, 'needs_fix', 'First: upload the plan.'),
    mark(second, offeringId, TEACHING_PLAN, 'needs_fix', 'Second: upload the plan.'),
    mark(second, offeringId, ATTENDANCE, 'needs_fix', 'Second: upload the attendance.'),
  ])
  const firstDraft = await requestIn(first, offeringId, 'draft')
  const secondDraft = await requestIn(second, offeringId, 'draft')
  expect(firstDraft.items.map((item) => item.verdict.comment)).toEqual(['First: upload the plan.'])
  expect(secondDraft.items.map((item) => item.verdict.comment)).toEqual(['Second: upload the plan.', 'Second: upload the attendance.'])

  await sendAuditRequest(first.client, firstDraft.id)
  expect((await requestsOf(coordinator.client, offeringId)).map((request) => request.id)).toEqual([firstDraft.id])
  await sendAuditRequest(second.client, secondDraft.id)
  const both = (await requestsOf(coordinator.client, offeringId)).map(({ id, auditor_id }) => ({ id, auditor_id }))
  expect(both).toHaveLength(2)
  expect(both).toEqual(
    expect.arrayContaining([
      { id: firstDraft.id, auditor_id: first.id },
      { id: secondDraft.id, auditor_id: second.id },
    ]),
  )
  const notifications = await outboxOf(coordinator)
  expect(notifications).toHaveLength(2)
  expect(notifications.map((notification) => notification.body.match(/fix (\d) section/)?.[1] ?? notification.body.includes('fix a section'))).toEqual([true, '2'])
})

test('Needs fix marks made at the same time by one auditor share one draft', async () => {
  const course = await createCourse()
  const auditor = await createPerson('auditor')
  const sections = [TEACHING_PLAN, ATTENDANCE, REPLACEMENT_NOTICES, WEEK_12_MARKS, GRADE_LIST]
  await Promise.all(sections.map((section) => mark(auditor, course.offeringId, section, 'needs_fix', `Fix section ${section}.`)))

  const requests = await requestsOf(auditor.client, course.offeringId)
  expect(requests).toHaveLength(1)
  expect(requests[0].items.map((item) => item.section)).toEqual(sections)
})

test('a push failure leaves the step made and its notification owed, and a retry sends it once', async () => {
  const course = await createCourse()
  const { offeringId, coordinator, lecturer } = course
  const auditor = await createPerson('auditor')
  await mark(auditor, offeringId, ATTENDANCE, 'needs_fix', 'Upload the attendance.')
  const { id } = await requestIn(auditor, offeringId, 'draft')

  await setUndeliverable(lecturer.token, true)
  expect(await refusal(sendAuditRequest(auditor.client, id))).toEqual({ code: 'push_failed', status: 502 })
  expect(await requestsOf(coordinator.client, offeringId)).toMatchObject([{ id, state: 'sent', notification_pending: true }])
  expect(await outboxOf(coordinator)).toEqual([])
  await setUndeliverable(lecturer.token, false)
  await Promise.all([sendAuditRequest(auditor.client, id), sendAuditRequest(auditor.client, id)])
  await sendAuditRequest(auditor.client, id)
  expect(await outboxOf(coordinator)).toHaveLength(1)
  expect(await requestsOf(coordinator.client, offeringId)).toMatchObject([{ id, state: 'sent', notification_pending: false }])

  await upload(lecturer.client, { offeringId, section: ATTENDANCE }, 'attendance.pdf')
  await setUndeliverable(auditor.token, true)
  expect(await refusal(replyToAuditRequest(lecturer.client, id, 'Uploaded.'))).toEqual({ code: 'push_failed', status: 502 })
  expect(await requestsOf(auditor.client, offeringId)).toMatchObject([{ id, state: 'replied', reply_message: 'Uploaded.', notification_pending: true }])
  await setUndeliverable(auditor.token, false)
  await replyToAuditRequest(coordinator.client, id, 'A different message')
  await replyToAuditRequest(coordinator.client, id)
  const sent = await outboxOf(auditor)
  expect(sent).toHaveLength(1)
  expect(sent[0].body).toMatch(/ "Uploaded\."$/)
  expect((await requestActivity(adminClient(), offeringId)).map((row) => row.action)).toEqual(['send', 'reply'])
})

/** Two different semesters from pickSemester, earliest first. */
async function semestersInOrder(): Promise<[Semester, Semester]> {
  const first = await pickSemester()
  let second = await pickSemester()
  while (second.id === first.id) second = await pickSemester()
  return [first, second].toSorted((a, b) => a.start_year - b.start_year || a.number - b.number) as [Semester, Semester]
}

/** Offers the course again in the semester with the same coordinator, with the service role, and returns the offering's id. */
async function offerAgain(course: Course, semester: Semester) {
  const { data, error } = await adminClient().rpc('create_offering', {
    semester_id: semester.id,
    course_id: course.courseId,
    coordinator_id: course.coordinator.id,
    lecturer_ids: [],
  })
  if (error) throw error
  return data as string
}

/** Adds a program code with the service role, uploads its student timetable for the semester as the admin, and returns the code's id. */
async function programCodeWithTimetable(semester: Semester) {
  const { data, error } = await adminClient().from('program_codes').insert({ code: `1 BITS S1G1 ${randomUUID()}` }).select('id').single()
  if (error) throw error
  await uploadFile(await signInAs('admin'), { semesterId: semester.id, section: STUDENT_TIMETABLE, programCodeId: data.id }, pdf('students.pdf'))
  return data.id as string
}
