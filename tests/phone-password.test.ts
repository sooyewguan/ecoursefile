// Seam 1: every password change needs a TAC to the user's phone. The browser gets the TAC checked by
// the phone verifier, here the fake-sms function, and sends the ID token to the password function.
// The first time a user sets their password they register the phone. A user who forgot their
// password resets it signed out with a TAC to the same phone. Supabase Auth sends no email at all.
import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, inject, test } from 'vitest'
import {
  adminClient,
  anonClient,
  callAccounts,
  callPassword,
  createUser,
  setOwnPassword,
  signIn,
  signInAs,
  tacToken,
  uniqueEmail,
  uniquePhone,
} from './harness.ts'

async function profileOf(userId: string) {
  const { data, error } = await adminClient().from('profiles').select('phone, must_change_password').eq('id', userId).single()
  if (error) throw error
  return data as { phone: string | null; must_change_password: boolean }
}

/** Whether the password signs the user in. */
async function signsIn(email: string, password: string) {
  return (await anonClient().auth.signInWithPassword({ email, password })).error === null
}

/**
 * A user who signed in with their temporary password and registered a phone with a password of
 * their own, signed in again with it. A new password ends the user's earlier sessions.
 */
async function userWithPhone() {
  const user = await createUser({ roles: ['lecturer'] })
  const phone = uniquePhone()
  await setOwnPassword(await signIn(user.email, user.password), phone, 'own-password')
  return { ...user, phone, password: 'own-password', client: await signIn(user.email, 'own-password') }
}

test('a new password ends the sessions the user had, so none can be refreshed', async () => {
  const user = await createUser()
  const client = await signIn(user.email, user.password)

  await setOwnPassword(client, uniquePhone(), 'own-password')

  expect((await client.auth.refreshSession()).error).not.toBeNull()
})

async function fakeAccountExists(phone: string) {
  const { data, error } = await adminClient().schema('fake_sms').from('accounts').select('phone').eq('phone', phone)
  if (error) throw error
  return data.length === 1
}

test('Supabase Auth cannot change a password without a TAC, and the old password still works', async () => {
  const user = await createUser()
  const client = await signIn(user.email, user.password)

  const { error } = await client.auth.updateUser({ password: 'no-tac-password' })

  expect(error).not.toBeNull()
  expect(await signsIn(user.email, user.password)).toBe(true)
  expect(await signsIn(user.email, 'no-tac-password')).toBe(false)
  expect((await profileOf(user.id)).must_change_password).toBe(true)
})

test('the first new password registers the phone, clears the flag and signs in', async () => {
  const user = await createUser()
  const phone = uniquePhone()
  const client = await signIn(user.email, user.password)

  const result = await callPassword(client, { action: 'set-password', idToken: await tacToken(phone), password: 'own-password' })

  expect(result).toEqual({ status: 200, body: { phone } })
  expect(await profileOf(user.id)).toEqual({ phone, must_change_password: false })
  expect(await signsIn(user.email, 'own-password')).toBe(true)
  expect(await signsIn(user.email, user.password)).toBe(false)
  expect(await fakeAccountExists(phone)).toBe(true)
})

test('a user with a phone changes their password only with a TAC to that phone', async () => {
  const user = await userWithPhone()

  const other = await callPassword(user.client, { action: 'set-password', idToken: await tacToken(uniquePhone()), password: 'other-password' })
  expect(other.status).toBe(403)
  expect(other.body.code).toBe('wrong_phone')
  expect(await signsIn(user.email, 'other-password')).toBe(false)

  const own = await callPassword(user.client, { action: 'set-password', idToken: await tacToken(user.phone), password: 'newer-password' })
  expect(own.status).toBe(200)
  expect(await signsIn(user.email, 'newer-password')).toBe(true)
  expect((await profileOf(user.id)).phone).toBe(user.phone)
})

test('a phone that another account has is refused, and the password stays', async () => {
  const taken = await userWithPhone()
  const user = await createUser()
  const client = await signIn(user.email, user.password)

  const result = await callPassword(client, { action: 'set-password', idToken: await tacToken(taken.phone), password: 'own-password' })

  expect(result.status).toBe(409)
  expect(result.body.code).toBe('phone_in_use')
  expect(await profileOf(user.id)).toEqual({ phone: null, must_change_password: true })
  expect(await signsIn(user.email, user.password)).toBe(true)
})

test('a password that Supabase Auth refuses registers no phone', async () => {
  const user = await createUser()
  const client = await signIn(user.email, user.password)

  const result = await callPassword(client, { action: 'set-password', idToken: await tacToken(uniquePhone()), password: '123' })

  expect(result.status).toBe(400)
  expect(await profileOf(user.id)).toEqual({ phone: null, must_change_password: true })
})

test('a token that the verifier did not issue, or no token, is refused', async () => {
  const user = await createUser()
  const client = await signIn(user.email, user.password)

  const forged = await callPassword(client, { action: 'set-password', idToken: 'forged', password: 'own-password' })
  expect(forged.status).toBe(401)
  expect(forged.body.code).toBe('invalid_token')

  const missing = await callPassword(client, { action: 'set-password', password: 'own-password' })
  expect(missing.status).toBe(400)
  expect(await signsIn(user.email, user.password)).toBe(true)
})

test('the fake verifier refuses a wrong TAC, and a TAC used once', async () => {
  const client = anonClient()
  const sent = await client.functions.invoke('fake-sms', { body: { action: 'send', phone: uniquePhone() } })
  const { data } = await adminClient().schema('fake_sms').from('codes').select('code').eq('id', sent.data.verificationId).single()
  const confirm = (code: string) => client.functions.invoke('fake-sms', { body: { action: 'confirm', verificationId: sent.data.verificationId, code } })

  expect((await confirm(data!.code === '000000' ? '111111' : '000000')).error).not.toBeNull()
  expect((await confirm(data!.code)).error).toBeNull()
  expect((await confirm(data!.code)).error).not.toBeNull()
})

test('a signed-out user resets a forgotten password with a TAC to their phone, and signs in with it', async () => {
  const user = await userWithPhone()

  const result = await callPassword(anonClient(), { action: 'reset-password', idToken: await tacToken(user.phone), password: 'reset-password' })

  expect(result).toEqual({ status: 200, body: { email: user.email } })
  expect(await signsIn(user.email, 'reset-password')).toBe(true)
  expect(await signsIn(user.email, user.password)).toBe(false)
})

test('a reset clears the flag, since the user chose the password', async () => {
  const user = await userWithPhone()
  const admin = await signInAs('admin')
  expect((await callAccounts(admin, { action: 'reset-password', userId: user.id, temporaryPassword: 'admin-temporary' })).status).toBe(200)
  expect((await profileOf(user.id)).must_change_password).toBe(true)

  await callPassword(anonClient(), { action: 'reset-password', idToken: await tacToken(user.phone), password: 'reset-password' })

  expect((await profileOf(user.id)).must_change_password).toBe(false)
})

test('a reset for a phone with no account, or of a deactivated account, sets no password', async () => {
  const unknown = await callPassword(anonClient(), { action: 'reset-password', idToken: await tacToken(uniquePhone()), password: 'reset-password' })
  expect(unknown.status).toBe(404)
  expect(unknown.body.code).toBe('no_account')

  const user = await userWithPhone()
  await adminClient().from('profiles').update({ active: false }).eq('id', user.id)
  const deactivated = await callPassword(anonClient(), { action: 'reset-password', idToken: await tacToken(user.phone), password: 'reset-password' })
  expect(deactivated.status).toBe(404)
  await adminClient().from('profiles').update({ active: true }).eq('id', user.id)
  expect(await signsIn(user.email, user.password)).toBe(true)
})

test('a user deactivated while signed in cannot set a password', async () => {
  const user = await createUser()
  const client = await signIn(user.email, user.password)
  await adminClient().from('profiles').update({ active: false }).eq('id', user.id)

  const result = await callPassword(client, { action: 'set-password', idToken: await tacToken(uniquePhone()), password: 'own-password' })

  expect(result.status).toBe(403)
  expect((await profileOf(user.id)).phone).toBeNull()
})

test('a user changes their phone with their current password and a TAC to the new phone', async () => {
  const user = await userWithPhone()
  const newPhone = uniquePhone()

  const wrong = await callPassword(user.client, { action: 'change-phone', idToken: await tacToken(newPhone), password: 'not-my-password' })
  expect(wrong.status).toBe(403)
  expect(wrong.body.code).toBe('wrong_password')
  expect((await profileOf(user.id)).phone).toBe(user.phone)

  const changed = await callPassword(user.client, { action: 'change-phone', idToken: await tacToken(newPhone), password: user.password })
  expect(changed).toEqual({ status: 200, body: { phone: newPhone } })
  expect((await profileOf(user.id)).phone).toBe(newPhone)
  expect(await fakeAccountExists(user.phone)).toBe(false)

  // The old phone no longer resets the password, and the new one does.
  expect((await callPassword(anonClient(), { action: 'reset-password', idToken: await tacToken(user.phone), password: 'x-password' })).status).toBe(404)
  expect((await callPassword(anonClient(), { action: 'reset-password', idToken: await tacToken(newPhone), password: 'y-password' })).status).toBe(200)
})

test('a user cannot move to a phone that another account has', async () => {
  const taken = await userWithPhone()
  const user = await userWithPhone()

  const result = await callPassword(user.client, { action: 'change-phone', idToken: await tacToken(taken.phone), password: user.password })

  expect(result.status).toBe(409)
  expect((await profileOf(user.id)).phone).toBe(user.phone)
})

test('neither the user nor an admin writes a phone through the API', async () => {
  const user = await userWithPhone()
  const admin = await signInAs('admin')

  for (const client of [user.client, admin] as SupabaseClient[]) {
    await client.from('profiles').update({ phone: uniquePhone() }).eq('id', user.id)
  }

  expect((await profileOf(user.id)).phone).toBe(user.phone)
})

test('the user and admins read the phone, and other users do not', async () => {
  const user = await userWithPhone()

  expect((await user.client.from('profiles').select('phone').eq('id', user.id)).data).toEqual([{ phone: user.phone }])
  expect((await (await signInAs('admin')).from('profiles').select('phone').eq('id', user.id)).data).toEqual([{ phone: user.phone }])
  expect((await (await signInAs('lecturer')).from('profiles').select('phone').eq('id', user.id)).data).toEqual([])
})

test('an admin clears the phone of a user who lost it, who then registers a new phone after a reset', async () => {
  const user = await userWithPhone()
  const admin = await signInAs('admin')

  expect(await callAccounts(admin, { action: 'clear-phone', userId: user.id })).toEqual({ status: 200, body: { userId: user.id } })
  expect((await profileOf(user.id)).phone).toBeNull()
  expect(await fakeAccountExists(user.phone)).toBe(false)
  expect((await callPassword(anonClient(), { action: 'reset-password', idToken: await tacToken(user.phone), password: 'x-password' })).status).toBe(404)

  expect((await callAccounts(admin, { action: 'reset-password', userId: user.id, temporaryPassword: 'admin-temporary' })).status).toBe(200)
  const client = await signIn(user.email, 'admin-temporary')
  const newPhone = uniquePhone()
  await setOwnPassword(client, newPhone, 'fresh-password')
  expect(await profileOf(user.id)).toEqual({ phone: newPhone, must_change_password: false })
})

test('only someone who may manage the user clears their phone', async () => {
  const user = await userWithPhone()

  for (const role of ['lecturer', 'auditor'] as const) {
    const result = await callAccounts(await signInAs(role), { action: 'clear-phone', userId: user.id })
    expect(result.status).toBe(403)
  }
  const otherAdmin = await createUser({ roles: ['admin'] })
  expect((await callAccounts(await signInAs('admin'), { action: 'clear-phone', userId: otherAdmin.id })).status).toBe(403)
  expect((await profileOf(user.id)).phone).toBe(user.phone)
})

test('Supabase Auth sends no email: a reset link, a sign-in link and a change of email are refused', async () => {
  const user = await createUser()
  const client = await signIn(user.email, user.password)

  expect((await anonClient().auth.resetPasswordForEmail(user.email)).error?.status).toBe(403)
  expect((await anonClient().auth.signInWithOtp({ email: user.email, options: { shouldCreateUser: false } })).error?.status).toBe(403)
  expect((await client.auth.updateUser({ email: uniqueEmail('changed') })).error?.status).toBe(403)
  expect((await adminClient().auth.admin.getUserById(user.id)).data.user?.email).toBe(user.email)
})

test('the Send Email Hook answers 401 to a call that Supabase Auth did not sign', async () => {
  const user = await createUser()
  const payload = JSON.stringify({ user: { id: user.id, email: user.email }, email_data: { email_action_type: 'recovery', token_hash: 'forged' } })
  const signatures: Record<string, string>[] = [
    {},
    { 'webhook-id': 'msg_forged', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': `v1,${btoa('forged')}` },
  ]

  for (const headers of signatures) {
    const response = await fetch(`${inject('stack').url}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: payload,
    })
    expect(response.status).toBe(401)
  }
})

test('clients can neither read nor write the fake TACs or the password grants', async () => {
  for (const client of [anonClient(), await signInAs('admin')]) {
    expect((await client.schema('fake_sms').from('codes').select('id').limit(1)).error?.code).toBe('42501')
    expect((await client.schema('fake_sms').from('tokens').insert({ token: 'forged', phone: uniquePhone() })).error?.code).toBe('42501')
    expect((await client.from('password_change_grants').select('user_id').limit(1)).error?.code).toBe('42501')
    expect((await client.rpc('allow_password_change', { user_id: crypto.randomUUID() })).error).not.toBeNull()
  }
})
