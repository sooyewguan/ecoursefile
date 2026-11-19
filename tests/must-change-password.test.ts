import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { adminClient, signIn, signInAs, uniqueEmail } from './harness.ts'

/** Creates a user the way an admin will: through the auth admin API with a temporary password. */
async function createStaffUser() {
  const email = uniqueEmail('staff')
  const password = 'temporary-password'
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Seam1 Staff' },
  })
  if (error) throw error
  return { id: data.user.id, email, password }
}

async function readOwnFlag(client: SupabaseClient) {
  const { data, error } = await client.from('profiles').select('must_change_password').single()
  if (error) throw error
  return data.must_change_password
}

test('a new user has the flag set, and signing in does not clear it', async () => {
  const user = await createStaffUser()

  const client = await signIn(user.email, user.password)

  expect(await readOwnFlag(client)).toBe(true)
})

test('a user cannot clear their own flag by writing their profile', async () => {
  const user = await createStaffUser()
  const client = await signIn(user.email, user.password)

  await client.from('profiles').update({ must_change_password: false }).eq('id', user.id)

  expect(await readOwnFlag(client)).toBe(true)
})

test('setting a new password clears the flag', async () => {
  const user = await createStaffUser()
  const client = await signIn(user.email, user.password)

  const { error } = await client.auth.updateUser({ password: 'my-own-password' })
  expect(error).toBeNull()

  expect(await readOwnFlag(client)).toBe(false)
  expect(await readOwnFlag(await signIn(user.email, 'my-own-password'))).toBe(false)
})

test('a user cannot read another user profile', async () => {
  const other = await createStaffUser()
  const client = await signInAs('lecturer')

  const { data, error } = await client.from('profiles').select('id').eq('id', other.id)

  expect(error).toBeNull()
  expect(data).toEqual([])
})
