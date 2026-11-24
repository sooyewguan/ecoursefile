import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { sizedPdf } from '../src/pdf/fixtures.ts'
import { deleteSharedFile, replaceSharedFile, uploadFile, type SharedSlot } from '../src/uploads.ts'
import { adminClient, createOffering, createUser, fakeStoreItems, pickSemester, protectedPdf, signIn, signInAs } from './harness.ts'

// Replacing works the same for every shared file the admin keeps. These tests replace student
// timetables of new program codes, which link only into the offerings that tick them, so they
// change no other test's course file.

const STUDENT_TIMETABLE = 5

type Semester = { id: string; code: string }

let admin: SupabaseClient
let auditor: SupabaseClient

beforeAll(async () => {
  admin = await signInAs('admin')
  auditor = await signInAs('auditor')
})

function pdf(name: string) {
  return new File([sizedPdf(1024)], name, { type: 'application/pdf' })
}

/** A new program code, an offering of the semester that ticks it, and its timetable's slot. */
async function tickedProgramCode(semester: Semester) {
  const { data, error } = await adminClient().from('program_codes').insert({ code: `1 BITS S1G1 ${randomUUID()}` }).select('id, code').single()
  if (error) throw error
  const user = await createUser({ roles: ['lecturer'] })
  const coordinator = await signIn(user.email, user.password)
  const offering = await createOffering({ coordinatorId: user.id, semester })
  const slot: SharedSlot = { semesterId: semester.id, section: STUDENT_TIMETABLE, programCodeId: data.id }
  return { programCode: data as { id: string; code: string }, offering, coordinator, slot }
}

/** The timetables of the program code for the semester, as the admin reads them. */
async function timetablesOf(semester: Semester, programCodeId: string) {
  const { data, error } = await admin.from('files').select('id, name, storage_item_id').eq('semester_id', semester.id).eq('program_code_id', programCodeId)
  if (error) throw error
  return data
}

async function sectionStatus(offeringId: string) {
  const { data, error } = await auditor.rpc('section_statuses', { offering_id: offeringId })
  if (error) throw error
  return data.find((row: { section: number }) => row.section === STUDENT_TIMETABLE)?.status
}

test('replacing a shared file leaves the new file in its place, and sets its section back to Pending review where an auditor had verified it', async () => {
  const semester = await pickSemester()
  const { offering, coordinator, slot, programCode } = await tickedProgramCode(semester)
  const old = await uploadFile(admin, slot, pdf('old.pdf'))
  const ticked = await coordinator.rpc('tick_program_code', { offering_id: offering.id, program_code_id: programCode.id, ticked: true })
  expect(ticked.error).toBeNull()
  const verdict = await auditor.rpc('record_verdict', { offering_id: offering.id, section: STUDENT_TIMETABLE, verdict: 'verified', comment: null })
  expect(verdict.error).toBeNull()
  expect(await sectionStatus(offering.id)).toBe('verified')

  const replaced = await replaceSharedFile(admin, slot, old.id, pdf('new.pdf'))

  expect(await timetablesOf(semester, programCode.id)).toEqual([{ id: replaced.id, name: 'new.pdf', storage_item_id: replaced.storage_item_id }])
  expect(await sectionStatus(offering.id)).toBe('pending_review')
  const stored = await fakeStoreItems(`eCourseFile/${semester.code.replace('/', '-')}/_shared/05 Student Timetable/${programCode.id} ${programCode.code}`)
  expect(stored.map((item) => item.id)).toEqual([replaced.storage_item_id])
  // The verdict stays in the course file's record.
  const { data: verdicts } = await auditor.from('section_verdicts').select('verdict').eq('offering_id', offering.id).eq('section', STUDENT_TIMETABLE)
  expect(verdicts).toEqual([{ verdict: 'verified' }])
})

test('a new file that cannot be stored is refused before the old file is deleted', async () => {
  const semester = await pickSemester()
  const { slot, programCode } = await tickedProgramCode(semester)
  const old = await uploadFile(admin, slot, pdf('old.pdf'))

  await expect(replaceSharedFile(admin, slot, old.id, protectedPdf('protected.pdf'))).rejects.toMatchObject({ code: 'unreadable_pdf' })
  await expect(replaceSharedFile(admin, slot, old.id, new File(['not a pdf'], 'notes.txt', { type: 'text/plain' }))).rejects.toMatchObject({ code: 'not_pdf' })
  await expect(replaceSharedFile(admin, slot, old.id, new File([sizedPdf(1024)], 'timetable', { type: 'application/pdf' }))).rejects.toMatchObject({ code: 'not_pdf' })

  expect((await timetablesOf(semester, programCode.id)).map((file) => file.id)).toEqual([old.id])
})

test('replacing again once the old file is gone uploads the new file', async () => {
  const semester = await pickSemester()
  const { slot, programCode } = await tickedProgramCode(semester)
  const old = await uploadFile(admin, slot, pdf('old.pdf'))
  // As if the first try deleted the old file and then lost the upload.
  await deleteSharedFile(admin, old.id)

  const replaced = await replaceSharedFile(admin, slot, old.id, pdf('new.pdf'))

  expect((await timetablesOf(semester, programCode.id)).map((file) => file.id)).toEqual([replaced.id])
})

test.each(['lecturer', 'auditor'] as const)('the %s user cannot replace a student timetable', async (role) => {
  const semester = await pickSemester()
  const { slot, programCode } = await tickedProgramCode(semester)
  const old = await uploadFile(admin, slot, pdf('old.pdf'))
  const client = await signInAs(role)

  await expect(replaceSharedFile(client, slot, old.id, pdf('new.pdf'))).rejects.toMatchObject({ status: expect.any(Number) })

  expect((await timetablesOf(semester, programCode.id)).map((file) => file.id)).toEqual([old.id])
})
