// Seam 1: a user changes their own name and title with update_my_profile, as the My profile page
// does, and an admin sets a user's title on the profile, as the Users page does. display_name, the
// title and the full name, is how everyone else sees the person.
import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { adminClient, anonClient, createDepartment, createUser, signIn, signInAs } from './harness.ts'

const PERMISSION_DENIED = '42501'
const CHECK_VIOLATION = '23514'
const STRING_TOO_LONG = '22001'

type User = { id: string; client: SupabaseClient }

/** A new lecturer with a department, signed in. */
async function createLecturer(): Promise<User> {
  const user = await createUser({ roles: ['lecturer'], departmentId: await createDepartment() })
  return { id: user.id, client: await signIn(user.email, user.password) }
}

function updateMyProfile(client: SupabaseClient, fullName: string | null, title: string | null) {
  return client.rpc('update_my_profile', { full_name: fullName, title })
}

/** The user's profile as they read it themselves. */
async function ownProfile(user: User) {
  const { data, error } = await user.client.from('profiles').select('full_name, title, display_name, department_id, active').eq('id', user.id).single()
  if (error) throw error
  return data
}

test('a user changes their own name and title, both trimmed, and is shown by their title and name', async () => {
  const user = await createLecturer()

  expect((await updateMyProfile(user.client, '  Aisyah Rahman  ', '  Dr.  ')).error).toBeNull()

  expect(await ownProfile(user)).toMatchObject({ full_name: 'Aisyah Rahman', title: 'Dr.', display_name: 'Dr. Aisyah Rahman' })
})

test.each([['   '], [''], [null]])('a title of %j clears the title, and the user is shown by their name alone', async (title) => {
  const user = await createLecturer()
  expect((await updateMyProfile(user.client, 'Aisyah Rahman', 'Prof. Madya')).error).toBeNull()

  expect((await updateMyProfile(user.client, 'Aisyah Rahman', title)).error).toBeNull()

  expect(await ownProfile(user)).toMatchObject({ full_name: 'Aisyah Rahman', title: null, display_name: 'Aisyah Rahman' })
})

test.each([['   '], [''], [null]])('a name of %j is refused, and the profile stays as it was', async (fullName) => {
  const user = await createLecturer()
  expect((await updateMyProfile(user.client, 'Aisyah Rahman', 'Ts.')).error).toBeNull()

  const { error } = await updateMyProfile(user.client, fullName, 'Dr.')

  expect(error?.code).toBe(CHECK_VIOLATION)
  expect(await ownProfile(user)).toMatchObject({ full_name: 'Aisyah Rahman', title: 'Ts.' })
})

test('a name of 200 characters and a title of 40 are kept, and one character more is refused', async () => {
  const user = await createLecturer()
  const [name, title] = ['n'.repeat(200), 't'.repeat(40)]

  expect((await updateMyProfile(user.client, name, title)).error).toBeNull()
  expect((await updateMyProfile(user.client, `${name}n`, title)).error?.code).toBe(STRING_TOO_LONG)
  expect((await updateMyProfile(user.client, name, `${title}t`)).error?.code).toBe(STRING_TOO_LONG)

  expect(await ownProfile(user)).toMatchObject({ full_name: name, title })
})

test("the call changes only the caller's name and title, not their department, active state or anyone else's profile", async () => {
  const [user, other] = await Promise.all([createLecturer(), createLecturer()])
  const before = { user: await ownProfile(user), other: await ownProfile(other) }

  expect((await updateMyProfile(user.client, 'Aisyah Rahman', 'Dr.')).error).toBeNull()
  const withMore = await user.client.rpc('update_my_profile', { full_name: 'Bala', title: 'Ts.', department_id: null, active: false })

  expect(withMore.error).not.toBeNull()
  expect(await ownProfile(user)).toEqual({
    full_name: 'Aisyah Rahman',
    title: 'Dr.',
    display_name: 'Dr. Aisyah Rahman',
    department_id: before.user.department_id,
    active: true,
  })
  expect(await ownProfile(other)).toEqual(before.other)
})

test('a user still cannot write their own profile row', async () => {
  const user = await createLecturer()
  const before = await ownProfile(user)

  await user.client.from('profiles').update({ full_name: 'Written Directly', title: 'Dr.' }).eq('id', user.id)
  await user.client.from('profiles').update({ department_id: await createDepartment(), active: false }).eq('id', user.id)

  expect(await ownProfile(user)).toEqual(before)
})

test('a signed-out visitor cannot call update_my_profile', async () => {
  expect((await updateMyProfile(anonClient(), 'Nobody', null)).error?.code).toBe(PERMISSION_DENIED)
})

test('an admin sets and clears the title of a user they manage, and a title must be trimmed, not empty and at most 40 characters', async () => {
  const user = await createLecturer()
  const admin = await signInAs('admin')
  const setTitle = (title: string | null) => admin.from('profiles').update({ title }).eq('id', user.id)

  expect((await setTitle('Ts.')).error).toBeNull()
  expect(await ownProfile(user)).toMatchObject({ title: 'Ts.', display_name: 'Ts. Seam1 User' })

  for (const title of [' Dr.', 'Dr. ', '', 't'.repeat(41)]) {
    expect((await setTitle(title)).error?.code).toBe(CHECK_VIOLATION)
  }
  expect(await ownProfile(user)).toMatchObject({ title: 'Ts.' })

  expect((await setTitle(null)).error).toBeNull()
  expect(await ownProfile(user)).toMatchObject({ title: null, display_name: 'Seam1 User' })
})

test('root cannot set the title of an admin, and a lecturer cannot set the title of another user', async () => {
  const otherAdmin = await createUser({ roles: ['admin'] })
  const other = await createLecturer()

  await (await signInAs('root')).from('profiles').update({ title: 'Dr.' }).eq('id', otherAdmin.id)
  await (await signInAs('lecturer')).from('profiles').update({ title: 'Dr.' }).eq('id', other.id)

  const { data, error } = await adminClient().from('profiles').select('title').in('id', [otherAdmin.id, other.id])
  expect(error).toBeNull()
  expect(data).toEqual([{ title: null }, { title: null }])
})
