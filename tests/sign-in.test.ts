import { expect, test } from 'vitest'
import { GLOBAL_ROLES } from '../src/roles.ts'
import { roleEmail } from './global-setup.ts'
import { signInAs } from './harness.ts'

test.each(GLOBAL_ROLES)('the seeded %s user signs in and reads only their own profile and role', async (role) => {
  const client = await signInAs(role)

  const profiles = await client.from('profiles').select('email, must_change_password')
  expect(profiles.error).toBeNull()
  expect(profiles.data).toEqual([{ email: roleEmail(role), must_change_password: false }])

  const roles = await client.from('user_roles').select('role')
  expect(roles.error).toBeNull()
  expect(roles.data).toEqual([{ role }])
})

test('after signing out, a client reads no profile or role rows', async () => {
  const client = await signInAs('root')
  expect((await client.from('profiles').select('id')).data).toHaveLength(1)

  const { error } = await client.auth.signOut()
  expect(error).toBeNull()

  expect((await client.from('profiles').select('id')).data).toEqual([])
  expect((await client.from('user_roles').select('role')).data).toEqual([])
})
