import { expect, test } from 'vitest'
import { GLOBAL_ROLES } from '../src/roles.ts'
import { roleEmail } from './global-setup.ts'
import { signInAs, userIdOf } from './harness.ts'

test.each(GLOBAL_ROLES)('the seeded %s user signs in and reads their own profile and role', async (role) => {
  const client = await signInAs(role)
  const id = await userIdOf(client)

  const profiles = await client.from('profiles').select('email, must_change_password').eq('id', id)
  expect(profiles.error).toBeNull()
  expect(profiles.data).toEqual([{ email: roleEmail(role), must_change_password: false }])

  const roles = await client.from('user_roles').select('role').eq('user_id', id)
  expect(roles.error).toBeNull()
  expect(roles.data).toEqual([{ role }])
})

const STAFF_ROLES = GLOBAL_ROLES.filter((role) => role !== 'root' && role !== 'admin')

test.each(STAFF_ROLES)('the seeded %s user reads no other profile or role rows', async (role) => {
  const client = await signInAs(role)

  expect((await client.from('profiles').select('email')).data).toEqual([{ email: roleEmail(role) }])
  expect((await client.from('user_roles').select('role')).data).toEqual([{ role }])
})

test('after signing out, a client reads no profile or role rows', async () => {
  const client = await signInAs('admin')
  expect((await client.from('profiles').select('id')).data).not.toEqual([])

  const { error } = await client.auth.signOut()
  expect(error).toBeNull()

  expect((await client.from('profiles').select('id')).data).toEqual([])
  expect((await client.from('user_roles').select('role')).data).toEqual([])
})
