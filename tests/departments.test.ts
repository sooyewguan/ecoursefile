import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { createDepartment, createUser, rolesOf, signInAs } from './harness.ts'

const RLS_VIOLATION = '42501'
const UNIQUE_VIOLATION = '23505'

let admin: SupabaseClient

beforeAll(async () => {
  admin = await signInAs('admin')
})

function newCode() {
  return `D-${crypto.randomUUID()}`
}

test('admin adds, renames and deletes a department', async () => {
  const code = newCode()

  const created = await admin.from('departments').insert({ code, name: 'Software Engineering' }).select('id').single()
  expect(created.error).toBeNull()
  const id = created.data!.id

  expect((await admin.from('departments').update({ name: 'Software Engineering and AI' }).eq('id', id)).error).toBeNull()
  expect((await admin.from('departments').select('code, name').eq('id', id)).data).toEqual([
    { code, name: 'Software Engineering and AI' },
  ])

  expect((await admin.from('departments').delete().eq('id', id)).error).toBeNull()
  expect((await admin.from('departments').select('id').eq('id', id)).data).toEqual([])
})

test('a department code that another department has in a different case is taken', async () => {
  const code = newCode()
  expect((await admin.from('departments').insert({ code, name: 'First' })).error).toBeNull()

  const { error } = await admin.from('departments').insert({ code: code.toLowerCase(), name: 'Second' })

  expect(error?.code).toBe(UNIQUE_VIOLATION)
})

test.each(['lecturer', 'root'] as const)('the %s user reads departments but cannot change them', async (role) => {
  const client = await signInAs(role)
  const id = await createDepartment()

  expect((await client.from('departments').insert({ code: newCode(), name: 'Refused' })).error?.code).toBe(RLS_VIOLATION)
  await client.from('departments').update({ name: 'Renamed' }).eq('id', id)
  await client.from('departments').delete().eq('id', id)

  expect((await client.from('departments').select('name').eq('id', id)).data).toEqual([{ name: 'Seam1 Department' }])
})

test('a department that a user belongs to cannot be deleted', async () => {
  const id = await createDepartment()
  await createUser({ departmentId: id })

  const { error } = await admin.from('departments').delete().eq('id', id)

  expect(error).not.toBeNull()
  expect((await admin.from('departments').select('id').eq('id', id)).data).toEqual([{ id }])
})

test('admin links two HoDs to one department', async () => {
  const departmentId = await createDepartment()
  const first = await createUser()
  const second = await createUser()

  for (const user of [first, second]) {
    expect((await admin.from('profiles').update({ department_id: departmentId }).eq('id', user.id)).error).toBeNull()
    expect((await admin.from('user_roles').insert({ user_id: user.id, role: 'hod' })).error).toBeNull()
  }

  const { data } = await admin.from('profiles').select('id, user_roles(role)').eq('department_id', departmentId).order('id')
  expect(data).toEqual(
    [first.id, second.id].toSorted().map((id) => ({ id, user_roles: [{ role: 'hod' }] })),
  )
})

test('granting HoD to a user with no department is refused', async () => {
  const user = await createUser()

  const { error } = await admin.from('user_roles').insert({ user_id: user.id, role: 'hod' })

  expect(error?.code).toBe(RLS_VIOLATION)
  expect(await rolesOf(admin, user.id)).toEqual([])
})

test("an HoD's department cannot be cleared", async () => {
  const departmentId = await createDepartment()
  const user = await createUser({ departmentId, roles: ['hod'] })

  const { error } = await admin.from('profiles').update({ department_id: null }).eq('id', user.id)

  expect(error?.code).toBe(RLS_VIOLATION)
  expect((await admin.from('profiles').select('department_id').eq('id', user.id)).data).toEqual([
    { department_id: departmentId },
  ])
})
