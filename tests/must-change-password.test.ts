import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { adminClient, setOwnPassword, signIn, signInAs, uniqueEmail, uniquePhone } from './harness.ts'

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

test('a user cannot write their own flag, email or active state', async () => {
  const user = await createStaffUser()
  const client = await signIn(user.email, user.password)

  await client.from('profiles').update({ must_change_password: false }).eq('id', user.id)
  await client.from('profiles').update({ email: uniqueEmail('changed') }).eq('id', user.id)
  await client.from('profiles').update({ active: false }).eq('id', user.id)

  const { data } = await client.from('profiles').select('must_change_password, email, active').eq('id', user.id)
  expect(data).toEqual([{ must_change_password: true, email: user.email, active: true }])
})

test('an admin cannot write the flag or email of a user they manage', async () => {
  const user = await createStaffUser()
  const admin = await signInAs('admin')

  await admin.from('profiles').update({ must_change_password: false }).eq('id', user.id)
  await admin.from('profiles').update({ email: uniqueEmail('changed') }).eq('id', user.id)

  const { data } = await admin.from('profiles').select('must_change_password, email').eq('id', user.id)
  expect(data).toEqual([{ must_change_password: true, email: user.email }])
})

test('setting a new password clears the flag', async () => {
  const user = await createStaffUser()
  const client = await signIn(user.email, user.password)

  await setOwnPassword(client, uniquePhone(), 'my-own-password')

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
