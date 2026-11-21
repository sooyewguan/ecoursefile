import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import type { GlobalRole } from '../src/roles.ts'
import {
  anonClient,
  callAccounts,
  createDepartment,
  createUser,
  rolesOf,
  signIn,
  signInAs,
  uniqueEmail,
  userIdOf,
} from './harness.ts'

let root: SupabaseClient
let admin: SupabaseClient

beforeAll(async () => {
  root = await signInAs('root')
  admin = await signInAs('admin')
})

function createUserRequest(roles: GlobalRole[], departmentId: string | null = null) {
  return {
    action: 'create-user',
    email: uniqueEmail('created'),
    fullName: 'Created User',
    departmentId,
    roles,
    temporaryPassword: 'temporary-password-1',
  }
}

async function profileByEmail(email: string) {
  const { data, error } = await admin
    .from('profiles')
    .select('full_name, department_id, must_change_password, active')
    .eq('email', email)
  if (error) throw error
  return data
}

async function readOwnFlag(client: SupabaseClient) {
  const { data, error } = await client.from('profiles').select('must_change_password').eq('id', await userIdOf(client))
  if (error) throw error
  return data[0].must_change_password
}

test('admin creates a user, who must change the temporary password at first sign-in', async () => {
  const departmentId = await createDepartment()
  const request = createUserRequest(['lecturer', 'hod'], departmentId)

  const created = await callAccounts(admin, request)

  expect(created.status).toBe(200)
  expect(await profileByEmail(request.email)).toEqual([
    { full_name: 'Created User', department_id: departmentId, must_change_password: true, active: true },
  ])
  expect(await rolesOf(admin, created.body.userId)).toEqual(['hod', 'lecturer'])

  const user = await signIn(request.email, request.temporaryPassword)
  expect(await readOwnFlag(user)).toBe(true)
  expect((await user.auth.updateUser({ password: 'my-own-password' })).error).toBeNull()
  expect(await readOwnFlag(user)).toBe(false)
})

test.each([
  ['lecturer', ['lecturer']],
  ['admin', ['admin']],
  ['root', ['lecturer']],
  ['root', []],
] as const)('the %s user creating a user with roles %j is forbidden', async (caller, roles) => {
  const client = caller === 'root' ? root : caller === 'admin' ? admin : await signInAs(caller)
  const request = createUserRequest([...roles])

  const result = await callAccounts(client, request)

  expect(result).toMatchObject({ status: 403, body: { code: 'forbidden' } })
  expect(await profileByEmail(request.email)).toEqual([])
})

test('root creates an admin', async () => {
  const request = createUserRequest(['admin'])

  const created = await callAccounts(root, request)

  expect(created.status).toBe(200)
  expect(await rolesOf(root, created.body.userId)).toEqual(['admin'])
  expect(await profileByEmail(request.email)).toEqual([
    { full_name: 'Created User', department_id: null, must_change_password: true, active: true },
  ])
})

test('a refused role grant leaves no account behind', async () => {
  const request = createUserRequest(['hod'])

  const result = await callAccounts(admin, request)

  expect(result).toMatchObject({ status: 403, body: { code: 'forbidden' } })
  expect(await profileByEmail(request.email)).toEqual([])
  const signInResult = await anonClient().auth.signInWithPassword({ email: request.email, password: request.temporaryPassword })
  expect(signInResult.error?.code).toBe('invalid_credentials')
})

test('creating a user with an email already in use is refused', async () => {
  const existing = await createUser()

  const result = await callAccounts(admin, { ...createUserRequest(['lecturer']), email: existing.email })

  expect(result).toMatchObject({ status: 409, body: { code: 'email_exists' } })
})

test.each([
  { action: 'create-user', email: 'no-name@seam1.test', roles: ['lecturer'], temporaryPassword: 'temporary-password-1' },
  { action: 'reset-password', userId: 'not-a-uuid', temporaryPassword: 'temporary-password-1' },
  { action: 'delete-everyone' },
])('a malformed request is refused: %j', async (body) => {
  expect(await callAccounts(admin, body)).toMatchObject({ status: 400, body: { code: 'invalid_request' } })
})

test('a request without a signed-in user is refused', async () => {
  const result = await callAccounts(anonClient(), createUserRequest(['lecturer']))

  expect(result.status).toBe(401)
})

test('admin reset sets the flag again, and the new temporary password works', async () => {
  const user = await createUser({ roles: ['lecturer'] })
  const own = await signIn(user.email, user.password)
  expect((await own.auth.updateUser({ password: 'my-own-password' })).error).toBeNull()
  expect(await readOwnFlag(own)).toBe(false)

  const result = await callAccounts(admin, {
    action: 'reset-password',
    userId: user.id,
    temporaryPassword: 'temporary-password-2',
  })

  expect(result.status).toBe(200)
  expect(await readOwnFlag(await signIn(user.email, 'temporary-password-2'))).toBe(true)
  const oldPassword = await anonClient().auth.signInWithPassword({ email: user.email, password: 'my-own-password' })
  expect(oldPassword.error?.code).toBe('invalid_credentials')
})

test('root cannot reset a password', async () => {
  const user = await createUser({ roles: ['lecturer'] })

  const result = await callAccounts(root, { action: 'reset-password', userId: user.id, temporaryPassword: 'root-chose-this' })

  expect(result).toMatchObject({ status: 403, body: { code: 'forbidden' } })
  await signIn(user.email, user.password)
})

test('admin cannot reset the password of root, another admin or their own', async () => {
  const otherAdmin = await createUser({ roles: ['admin'] })

  for (const userId of [await userIdOf(root), otherAdmin.id, await userIdOf(admin)]) {
    const result = await callAccounts(admin, { action: 'reset-password', userId, temporaryPassword: 'admin-chose-this' })
    expect(result).toMatchObject({ status: 403, body: { code: 'forbidden' } })
  }
  await signIn(otherAdmin.email, otherAdmin.password)
  await signInAs('root')
})
