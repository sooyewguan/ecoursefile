// Seam 1: the admin imports users from a CSV file through the accounts function, the way the Users
// page sends it.
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { MAX_IMPORT_ROWS, USER_IMPORT_TEMPLATE } from '../supabase/functions/_shared/user-import.ts'
import { adminClient, callAccounts, createDepartment, createUser, signIn, signInAs, uniqueEmail, userIdOf } from './harness.ts'

const HEADER = 'full_name,email,department,roles,temporary_password'

let admin: SupabaseClient

beforeAll(async () => {
  admin = await signInAs('admin')
})

function importUsers(client: SupabaseClient, csv: string) {
  return callAccounts(client, { action: 'import-users', csv })
}

/** A new department, with its id and code. */
async function department() {
  const id = await createDepartment()
  const { data, error } = await adminClient().from('departments').select('code, name').eq('id', id).single()
  if (error) throw error
  return { id, code: data.code as string, name: data.name as string }
}

/** A temporary password no other value in a test contains. */
function password(label: string) {
  return `${label}-${randomUUID()}`
}

/** The users with these emails as the admin reads them, sorted by email, each with their roles sorted. */
async function users(emails: string[]) {
  const { data, error } = await admin
    .from('profiles')
    .select('email, full_name, department_id, must_change_password, active, user_roles(role)')
    .in('email', emails)
  if (error) throw error
  return data
    .map(({ user_roles, ...profile }) => ({ ...profile, roles: user_roles.map((r: { role: string }) => r.role).toSorted() }))
    .toSorted((a, b) => a.email.localeCompare(b.email))
}

async function readOwnFlag(client: SupabaseClient) {
  const { data, error } = await client.from('profiles').select('must_change_password').eq('id', await userIdOf(client))
  if (error) throw error
  return data[0].must_change_password
}

test('valid rows of a mixed file become users who must change their password, and each invalid row is rejected with its reason', async () => {
  const dept = await department()
  const existing = await createUser()
  const email = Object.fromEntries(
    ['unknownCode', 'deptName', 'unknownRole', 'admin', 'root', 'twin', 'hodAlone', 'weak', 'noPassword', 'lecturer', 'hod'].map((label) => [label, uniqueEmail(label.toLowerCase())]),
  )
  const passwords = { lecturer: password('lecturer'), hod: password('hod') }
  const csv = [
    HEADER,
    `Unknown Code,${email.unknownCode},NO-SUCH-DEPT,lecturer,${password('row2')}`,
    `Department By Name,${email.deptName},${dept.name},lecturer,${password('row3')}`,
    `Unknown Role,${email.unknownRole},,lecturer;professor,${password('row4')}`,
    `Would Be Admin,${email.admin},,admin,${password('row5')}`,
    `Would Be Root,${email.root},,lecturer;root,${password('row6')}`,
    `First Twin,${email.twin},,lecturer,${password('row7')}`,
    `Existing User,${existing.email},,lecturer,${password('row8')}`,
    `Second Twin,${email.twin.toUpperCase()},,auditor,${password('row9')}`,
    `HoD Without Department,${email.hodAlone},,hod,${password('row10')}`,
    `Short Password,${email.weak},,lecturer,xyz`,
    `No Password,${email.noPassword},,lecturer,`,
    `Aisyah Lecturer,${email.lecturer},,lecturer,${passwords.lecturer}`,
    `Bala HoD,${email.hod},${dept.code},lecturer;hod;auditor,${passwords.hod}`,
  ].join('\n')

  const result = await importUsers(admin, csv)

  expect(result.status).toBe(200)
  expect(result.body.rows).toEqual([
    { row: 2, email: email.unknownCode, status: 'rejected', code: 'unknown_department', reason: expect.stringContaining('NO-SUCH-DEPT') },
    { row: 3, email: email.deptName, status: 'rejected', code: 'unknown_department', reason: expect.stringContaining(dept.name) },
    { row: 4, email: email.unknownRole, status: 'rejected', code: 'unknown_role', reason: expect.stringContaining('professor') },
    { row: 5, email: email.admin, status: 'rejected', code: 'forbidden', reason: expect.stringContaining('admin') },
    { row: 6, email: email.root, status: 'rejected', code: 'forbidden', reason: expect.stringContaining('root') },
    { row: 7, email: email.twin, status: 'rejected', code: 'duplicate_email', reason: expect.stringContaining('row 9') },
    { row: 8, email: existing.email, status: 'rejected', code: 'email_exists', reason: expect.stringMatching(/\S/) },
    { row: 9, email: email.twin.toUpperCase(), status: 'rejected', code: 'duplicate_email', reason: expect.stringContaining('row 7') },
    { row: 10, email: email.hodAlone, status: 'rejected', code: 'forbidden', reason: expect.stringContaining('department') },
    { row: 11, email: email.weak, status: 'rejected', code: 'invalid_request', reason: expect.stringContaining('Password') },
    { row: 12, email: email.noPassword, status: 'rejected', code: 'missing_value', reason: expect.stringContaining('temporary password') },
    { row: 13, email: email.lecturer, status: 'created', userId: expect.any(String) },
    { row: 14, email: email.hod, status: 'created', userId: expect.any(String) },
  ])
  expect(await users(Object.values(email))).toEqual(
    [
      { email: email.lecturer, full_name: 'Aisyah Lecturer', department_id: null, must_change_password: true, active: true, roles: ['lecturer'] },
      { email: email.hod, full_name: 'Bala HoD', department_id: dept.id, must_change_password: true, active: true, roles: ['auditor', 'hod', 'lecturer'] },
    ].toSorted((a, b) => a.email.localeCompare(b.email)),
  )
  expect(await users([existing.email])).toMatchObject([{ full_name: 'Seam1 User', roles: [] }])

  const lecturer = await signIn(email.lecturer, passwords.lecturer)
  expect(await readOwnFlag(lecturer)).toBe(true)
  expect((await lecturer.auth.updateUser({ password: 'my-own-password' })).error).toBeNull()
  expect(await readOwnFlag(lecturer)).toBe(false)
})

test('no response to an import holds a temporary password', async () => {
  const dept = await department()
  const rows = [
    ['Created User', uniqueEmail('created'), '', 'lecturer'],
    ['Unknown Role', uniqueEmail('role'), '', 'professor'],
    ['Unknown Department', uniqueEmail('dept'), 'NO-SUCH-DEPT', 'lecturer'],
    ['Admin Role', uniqueEmail('admin'), '', 'admin'],
    ['HoD Without Department', uniqueEmail('hod'), '', 'hod'],
    ['HoD', uniqueEmail('hod'), dept.code, 'hod'],
  ].map((cells) => [...cells, password('secret')])
  const csv = [HEADER, ...rows.map((cells) => cells.join(','))].join('\n')

  for (const attempt of [await importUsers(admin, csv), await importUsers(admin, csv)]) {
    expect(attempt.status).toBe(200)
    for (const cells of rows) expect(JSON.stringify(attempt.body)).not.toContain(cells[4])
  }
})

test('a file made from the template imports', async () => {
  const email = uniqueEmail('template')

  const result = await importUsers(admin, `${USER_IMPORT_TEMPLATE}Template User,${email},,lecturer,${password('template')}\r\n`)

  expect(result.body.rows).toEqual([{ row: 2, email, status: 'created', userId: expect.any(String) }])
})

test('a file may have a byte order mark, CRLF line ends, blank rows, quoted values, extra columns, and its columns in any order and case', async () => {
  // A code that the file must quote, and that the lookup of departments must quote too.
  const { data: dept, error } = await adminClient()
    .from('departments')
    .insert({ code: `D-${randomUUID()}, "Main" (KL) \\ 2`, name: 'Seam1 Department' })
    .select('id, code')
    .single()
  if (error) throw error
  const [tan, nur] = [uniqueEmail('tan'), uniqueEmail('nur')]
  const csv = [
    '\uFEFFEmail,ROLES, Temporary Password ,Notes,Full Name,department',
    `${tan},"Lecturer; HOD",${password('tan')},"Joined in 2020,\r\nfrom KL","Tan, Ah Kow","${dept.code.replaceAll('"', '""')}"`,
    '',
    ',,,,,',
    `  ${nur.toUpperCase()}  , deputy_dean ,${password('nur')},,"Nur ""Ina"" Ismail",`,
  ].join('\r\n')

  const result = await importUsers(admin, csv)

  expect(result.body.rows).toEqual([
    { row: 2, email: tan, status: 'created', userId: expect.any(String) },
    { row: 5, email: nur.toUpperCase(), status: 'created', userId: expect.any(String) },
  ])
  expect(await users([tan, nur])).toMatchObject(
    [
      { email: tan, full_name: 'Tan, Ah Kow', department_id: dept.id, roles: ['hod', 'lecturer'] },
      { email: nur, full_name: 'Nur "Ina" Ismail', department_id: null, roles: ['deputy_dean'] },
    ].toSorted((a, b) => a.email.localeCompare(b.email)),
  )
})

test('importing the same file again creates nobody twice and leaves the users it created as they are', async () => {
  const email = uniqueEmail('again')
  const first = password('first')
  const row = (temporaryPassword: string) => `${HEADER}\nAgain User,${email},,lecturer,${temporaryPassword}\n`

  expect((await importUsers(admin, row(first))).body.rows).toMatchObject([{ row: 2, status: 'created' }])
  expect((await importUsers(admin, row(first))).body.rows).toMatchObject([{ row: 2, status: 'rejected', code: 'email_exists' }])
  expect((await importUsers(admin, row(password('second')))).body.rows).toMatchObject([{ row: 2, status: 'rejected', code: 'email_exists' }])

  expect(await users([email])).toMatchObject([{ full_name: 'Again User', roles: ['lecturer'] }])
  await signIn(email, first)
})

test.each([
  ['root', 'admin'],
  ['lecturer', 'lecturer'],
] as const)('the %s user may not import users, and nothing is created', async (caller, role) => {
  const email = uniqueEmail('refused')

  const result = await importUsers(await signInAs(caller), `${HEADER}\nRefused User,${email},,${role},${password('refused')}`)

  expect(result).toMatchObject({ status: 403, body: { code: 'forbidden' } })
  expect(await users([email])).toEqual([])
})

test.each([
  ['has no roles column', /roles column/, (email: string) => `full_name,email,department,temporary_password\nNo Roles,${email},,temporary-password`],
  ['has two email columns', /email column/, (email: string) => `${HEADER},Email\nTwo Emails,${email},,lecturer,temporary-password,${email}`],
  ['has a header and no users', /no users/, () => `${HEADER}\r\n\r\n,,,,\r\n`],
  ['is empty', /empty/, () => ''],
  [
    'has a quote that is never closed',
    /quote on row 3/,
    (email: string) => `${HEADER}\nValid User,${email},,lecturer,temporary-password\n"Unclosed,other@seam1.test,,lecturer,temporary-password`,
  ],
])('a file that %s is refused as a whole, and nothing is created', async (_, says, csv) => {
  const email = uniqueEmail('whole-file')

  const result = await importUsers(admin, csv(email))

  expect(result).toMatchObject({ status: 400, body: { code: 'invalid_request', message: expect.stringMatching(says) } })
  expect(await users([email])).toEqual([])
})

test('a server error on one row rejects that row with internal_error, and the other rows are still added and reported', async () => {
  // A profile keeps the email its user was created with. Once the user's email moves, Supabase Auth
  // fails with HTTP 500 to add a new user with the old one, because the new profile repeats it.
  const moved = await createUser()
  const { error } = await adminClient().auth.admin.updateUserById(moved.id, { email: uniqueEmail('moved') })
  if (error) throw error
  const [before, after] = [uniqueEmail('before'), uniqueEmail('after')]
  const csv = [
    HEADER,
    `Before Row,${before},,lecturer,${password('before')}`,
    `Stale Email,${moved.email},,lecturer,${password('stale')}`,
    `After Row,${after},,lecturer,${password('after')}`,
  ].join('\n')

  const result = await importUsers(admin, csv)

  expect(result.status).toBe(200)
  expect(result.body.rows).toEqual([
    { row: 2, email: before, status: 'created', userId: expect.any(String) },
    { row: 3, email: moved.email, status: 'rejected', code: 'internal_error', reason: expect.stringMatching(/\S/) },
    { row: 4, email: after, status: 'created', userId: expect.any(String) },
  ])
  expect((await users([before, after])).map((user) => user.email)).toEqual([before, after].toSorted())
})

test(`a file with more than ${MAX_IMPORT_ROWS} users is refused as a whole with the limit in its message, and nothing is created`, async () => {
  const emails = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => uniqueEmail('limit'))
  const csv = [HEADER, ...emails.map((email) => `Limit User,${email},,lecturer,temporary-password`)].join('\n')

  const result = await importUsers(admin, csv)

  expect(result).toMatchObject({ status: 400, body: { code: 'invalid_request', message: expect.stringContaining(String(MAX_IMPORT_ROWS)) } })
  expect(await users([emails[0], emails[MAX_IMPORT_ROWS]])).toEqual([])
})

test(`a file with ${MAX_IMPORT_ROWS} users is read row by row`, async () => {
  const emails = Array.from({ length: MAX_IMPORT_ROWS }, () => uniqueEmail('limit'))
  // Rows without a temporary password are rejected without a call to Supabase Auth, so the test stays fast.
  const csv = [HEADER, ...emails.map((email) => `Limit User,${email},,lecturer,`)].join('\n')

  const result = await importUsers(admin, csv)

  expect(result.status).toBe(200)
  expect(result.body.rows).toHaveLength(MAX_IMPORT_ROWS)
  expect(result.body.rows.every((row: { code: string }) => row.code === 'missing_value')).toBe(true)
})

test('an import request without the file as text is refused', async () => {
  expect(await importUsers(admin, undefined as unknown as string)).toMatchObject({ status: 400, body: { code: 'invalid_request' } })
})
