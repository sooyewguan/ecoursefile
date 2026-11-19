import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { GLOBAL_ROLES } from '../src/roles.ts'
import { roleEmail } from './global-setup.ts'
import { createDepartment, createUser, rolesOf, signInAs, userIdOf } from './harness.ts'

const STAFF_ROLES = ['lecturer', 'auditor', 'hod', 'dean', 'deputy_dean'] as const
const RLS_VIOLATION = '42501'

let root: SupabaseClient
let admin: SupabaseClient

beforeAll(async () => {
  root = await signInAs('root')
  admin = await signInAs('admin')
})

test('root reads every user and their roles', async () => {
  const { data, error } = await root
    .from('profiles')
    .select('email, user_roles(role)')
    .in('email', GLOBAL_ROLES.map(roleEmail))
    .order('email')

  expect(error).toBeNull()
  expect(data).toEqual(
    GLOBAL_ROLES.map((role) => ({ email: roleEmail(role), user_roles: [{ role }] })).toSorted((a, b) =>
      a.email.localeCompare(b.email),
    ),
  )
})

test('root grants admin to a user and revokes it', async () => {
  const user = await createUser({ roles: ['lecturer'] })

  expect((await root.from('user_roles').insert({ user_id: user.id, role: 'admin' })).error).toBeNull()
  expect(await rolesOf(root, user.id)).toEqual(['admin', 'lecturer'])

  expect((await root.from('user_roles').delete().match({ user_id: user.id, role: 'admin' })).error).toBeNull()
  expect(await rolesOf(root, user.id)).toEqual(['lecturer'])
})

test.each([...STAFF_ROLES, 'root'] as const)('root cannot grant %s', async (role) => {
  const user = await createUser({ departmentId: await createDepartment() })

  const { error } = await root.from('user_roles').insert({ user_id: user.id, role })

  expect(error?.code).toBe(RLS_VIOLATION)
  expect(await rolesOf(root, user.id)).toEqual([])
})

test('root cannot revoke a staff role', async () => {
  const user = await createUser({ roles: ['lecturer'] })

  await root.from('user_roles').delete().match({ user_id: user.id, role: 'lecturer' })

  expect(await rolesOf(root, user.id)).toEqual(['lecturer'])
})

test('root cannot edit a profile or deactivate anyone', async () => {
  const user = await createUser({ roles: ['lecturer'] })

  await root.from('profiles').update({ full_name: 'Renamed by root', active: false }).eq('id', user.id)

  const { data } = await root.from('profiles').select('full_name, active').eq('id', user.id)
  expect(data).toEqual([{ full_name: 'Seam1 User', active: true }])
})

test('admin gives one user every staff role and revokes them', async () => {
  const user = await createUser({ departmentId: await createDepartment() })

  const granted = await admin.from('user_roles').insert(STAFF_ROLES.map((role) => ({ user_id: user.id, role })))
  expect(granted.error).toBeNull()
  expect(await rolesOf(admin, user.id)).toEqual([...STAFF_ROLES].toSorted())

  expect((await admin.from('user_roles').delete().eq('user_id', user.id)).error).toBeNull()
  expect(await rolesOf(admin, user.id)).toEqual([])
})

test.each(['admin', 'root'] as const)('admin cannot grant %s', async (role) => {
  const user = await createUser()

  const { error } = await admin.from('user_roles').insert({ user_id: user.id, role })

  expect(error?.code).toBe(RLS_VIOLATION)
  expect(await rolesOf(admin, user.id)).toEqual([])
})

test('admin cannot revoke admin', async () => {
  const user = await createUser({ roles: ['admin'] })

  await admin.from('user_roles').delete().match({ user_id: user.id, role: 'admin' })

  expect(await rolesOf(admin, user.id)).toEqual(['admin'])
})

test('admin cannot change their own roles', async () => {
  const id = await userIdOf(admin)

  expect((await admin.from('user_roles').insert({ user_id: id, role: 'lecturer' })).error?.code).toBe(RLS_VIOLATION)
  await admin.from('user_roles').delete().match({ user_id: id, role: 'admin' })

  expect(await rolesOf(admin, id)).toEqual(['admin'])
})

test('admin cannot change the roles of a root user', async () => {
  const rootId = await userIdOf(root)

  const { error } = await admin.from('user_roles').insert({ user_id: rootId, role: 'lecturer' })

  expect(error?.code).toBe(RLS_VIOLATION)
  expect(await rolesOf(admin, rootId)).toEqual(['root'])
})

test.each(GLOBAL_ROLES)('the %s user cannot grant root', async (role) => {
  const client = await signInAs(role)
  const user = await createUser()

  const { error } = await client.from('user_roles').insert({ user_id: user.id, role: 'root' })

  expect(error?.code).toBe(RLS_VIOLATION)
})
