import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import { inject } from 'vitest'
import type { GlobalRole } from '../src/roles.ts'
import { deleteSharedFile } from '../src/uploads.ts'
import { roleEmail, TEST_DOMAIN, TEST_PASSWORD } from './global-setup.ts'

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } }

/** A client signed in as nobody, holding the publishable key like the browser does. */
export function anonClient() {
  const { url, publishableKey } = inject('stack')
  return createClient(url, publishableKey, clientOptions)
}

/** A service-role client that bypasses RLS, for arranging test data only. */
export function adminClient() {
  const { url, secretKey } = inject('stack')
  return createClient(url, secretKey, clientOptions)
}

export async function signIn(email: string, password: string) {
  const client = anonClient()
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return client
}

/** Signs in as the user seeded for this role. */
export function signInAs(role: GlobalRole) {
  return signIn(roleEmail(role), TEST_PASSWORD)
}

/** An email no earlier run has used, so tests that create users can rerun without a reset. */
export function uniqueEmail(label: string) {
  return `${label}-${randomUUID()}@${TEST_DOMAIN}`
}

/**
 * Creates a user with the service role, as a test arrangement, and returns their id and
 * credentials. The email is a new one, and the name Seam1 User, unless the test gives its own.
 */
export async function createUser(options: { roles?: GlobalRole[]; departmentId?: string; email?: string; fullName?: string } = {}) {
  const admin = adminClient()
  const email = options.email ?? uniqueEmail('user')
  const password = 'temporary-password'
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: options.fullName ?? 'Seam1 User' },
  })
  if (error) throw error
  const id = data.user.id
  if (options.departmentId) {
    const { error: departmentError } = await admin.from('profiles').update({ department_id: options.departmentId }).eq('id', id)
    if (departmentError) throw departmentError
  }
  if (options.roles?.length) {
    const { error: rolesError } = await admin.from('user_roles').insert(options.roles.map((role) => ({ user_id: id, role })))
    if (rolesError) throw rolesError
  }
  return { id, email, password }
}

export async function userIdOf(client: SupabaseClient) {
  const { data } = await client.auth.getSession()
  if (!data.session) throw new Error('The client has no session')
  return data.session.user.id
}

/** The claims of the client's current access token, decoded the way any reader of the JWT would. */
export async function accessTokenClaims(client: SupabaseClient): Promise<Record<string, unknown>> {
  const { data } = await client.auth.getSession()
  if (!data.session) throw new Error('The client has no session')
  return JSON.parse(Buffer.from(data.session.access_token.split('.')[1], 'base64url').toString())
}

/** Adds a department with the service role, as a test arrangement, and returns its id. */
export async function createDepartment() {
  const { data, error } = await adminClient()
    .from('departments')
    .insert({ code: `D-${randomUUID()}`, name: 'Seam1 Department' })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

/** The user's roles as this client reads them, sorted. */
export async function rolesOf(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from('user_roles').select('role').eq('user_id', userId)
  if (error) throw error
  return data.map((row: { role: GlobalRole }) => row.role).toSorted()
}

/** Calls the accounts Edge Function as this client, the way the app does, and returns the HTTP status and JSON body. */
export async function callAccounts(client: SupabaseClient, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const { data, error } = await client.functions.invoke('accounts', { body })
  if (!error) return { status: 200, body: data }
  if (error instanceof FunctionsHttpError) {
    const response: Response = error.context
    return { status: response.status, body: await response.json() }
  }
  throw error
}

/**
 * The first start year of the semesters that pickSemester leaves to the report tests. A report sums
 * every offering of its semester, so no other test's offering may share a semester with them.
 */
const REPORT_START_YEAR = 2800

/**
 * The first start year of the semesters that pickSemester leaves to the tests of shared files. An
 * upload of a semester's calendar or letter changes sections 1 and 3 of every offering in the
 * semester, so no other test's offering may share a semester with those tests.
 */
const SHARED_FILE_START_YEAR = 2900

/** A whole number from 0 to below the limit. */
function randomBelow(limit: number) {
  return Math.floor(Math.random() * limit)
}

/**
 * A semester with a random start year from 2000 to 2799, and the given number if there is one,
 * else a random number: new, inserted by the client (by default the service role), or the existing
 * one when an earlier test or run took the code. There are only 2,400 such codes, and semesters
 * with offerings are never deleted, so a test cannot count on a semester of its own.
 */
export function pickSemester(client: SupabaseClient = adminClient(), number?: number) {
  return semesterWithCode({ start_year: 2000 + randomBelow(REPORT_START_YEAR - 2000), number: number ?? 1 + randomBelow(3) }, client)
}

/**
 * A semester for report tests that has no offerings yet: a random one of the 300 codes with start
 * years 2800 to 2899, which no other helper returns. The tests never delete offerings, so each semester
 * that a test fills is used up, and a database that has used them all needs a reset.
 */
export async function emptyReportSemester() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const semester = await semesterWithCode({
      start_year: REPORT_START_YEAR + randomBelow(SHARED_FILE_START_YEAR - REPORT_START_YEAR),
      number: 1 + randomBelow(3),
    })
    const { count, error } = await adminClient().from('offerings').select('id', { count: 'exact', head: true }).eq('semester_id', semester.id)
    if (error) throw error
    if (count === 0) return semester
  }
  throw new Error('No report test semester is left without offerings. Reset the database with `npx supabase db reset`.')
}

/**
 * A semester for tests of shared files: a random one of the 300 codes from start year 2900 on,
 * which pickSemester never returns, with the calendar and letter that an earlier test or run left
 * deleted by the admin. Only tests in one file upload calendars and letters, and they run one after
 * another, so the semester stays without them until the test uploads one.
 */
export async function semesterWithoutSharedFiles() {
  const semester = await semesterWithCode({ start_year: SHARED_FILE_START_YEAR + randomBelow(3000 - SHARED_FILE_START_YEAR), number: 1 + randomBelow(3) })
  const { data, error } = await adminClient().from('files').select('id').eq('semester_id', semester.id)
  if (error) throw error
  const admin = await signInAs('admin')
  for (const file of data) await deleteSharedFile(admin, file.id)
  return semester
}

/** The semester with this code: inserted by the client, or the existing one when the code is taken. */
async function semesterWithCode(code: { start_year: number; number: number }, client: SupabaseClient = adminClient()) {
  const inserted = await client.from('semesters').insert(code).select('id, start_year, number, code').single()
  if (!inserted.error) return inserted.data
  if (inserted.error.code !== '23505') throw inserted.error
  const { data, error } = await adminClient().from('semesters').select('id, start_year, number, code').match(code).single()
  if (error) throw error
  return data
}

/**
 * Offers a new course in the semester, by default one from pickSemester, with the service role, as
 * a test arrangement. The course type has sectionsOn on, by default sections 10 and 12. The course
 * belongs to departmentId, by default a new department.
 */
export async function createOffering(options: {
  coordinatorId: string
  lecturerIds?: string[]
  sectionsOn?: number[]
  semester?: { id: string; code: string }
  departmentId?: string
}) {
  const service = adminClient()
  const semester = options.semester ?? (await pickSemester())
  const courseType = await service
    .from('course_types')
    .insert({ name: `Type-${randomUUID()}`, sections_on: options.sectionsOn ?? [10, 12] })
    .select('id')
    .single()
  if (courseType.error) throw courseType.error
  const course = await service
    .from('courses')
    .insert({ code: `BITP-${randomUUID()}`, title: 'Seam1 Course', department_id: options.departmentId ?? (await createDepartment()), course_type_id: courseType.data.id })
    .select('id, code, title')
    .single()
  if (course.error) throw course.error
  const { data: id, error } = await service.rpc('create_offering', {
    semester_id: semester.id,
    course_id: course.data.id,
    coordinator_id: options.coordinatorId,
    lecturer_ids: options.lecturerIds ?? [],
  })
  if (error) throw error
  return { id: id as string, semesterCode: semester.code, course: course.data as { id: string; code: string; title: string } }
}

/** The items in the fake storage library whose path starts with the folder, sorted by path. */
export async function fakeStoreItems(folder: string) {
  const { data, error } = await adminClient()
    .schema('fake_storage')
    .from('items')
    .select('id, path, size, mime_type')
    .like('path', `${folder}/%`)
    .order('path')
  if (error) throw error
  return data as { id: string; path: string; size: number; mime_type: string }[]
}

/** Registers a push token for the signed-in user, as the app does when they turn notifications on, and returns it. */
export async function registerPushToken(client: SupabaseClient) {
  const token = `fake-${randomUUID()}`
  const { error } = await client.rpc('register_push_token', { token })
  if (error) throw error
  return token
}

/** The notifications in the fake push outbox that went to these tokens, oldest first. */
export async function fakePushOutbox(...tokens: string[]) {
  const { data, error } = await adminClient()
    .schema('fake_push')
    .from('outbox')
    .select('token, title, body, link')
    .in('token', tokens)
    .order('sent_at')
  if (error) throw error
  return data as { token: string; title: string; body: string; link: string }[]
}

/**
 * An appointment letter as a PDF with only a permissions password: viewers open it without asking
 * for one, but printing, copying and editing need the owner password. pdf-lib refuses to load it.
 * Made with pypdf 6.17, PdfWriter.encrypt(user_password='', owner_password='owner', algorithm='AES-256').
 */
export function protectedPdf(name: string) {
  return new File([readFileSync(new URL('fixtures/permissions-password.pdf', import.meta.url))], name, { type: 'application/pdf' })
}
