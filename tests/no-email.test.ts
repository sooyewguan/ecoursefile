// Seam 1: eCourseFile sends no email. Supabase Auth hands each email it would send to the Send Email
// Hook, which refuses it, so no reset link, sign-in link or change of email goes out. An admin
// resets a forgotten password.
import { expect, inject, test } from 'vitest'
import { adminClient, anonClient, createUser, signIn, uniqueEmail } from './harness.ts'

test('Supabase Auth sends no email: a reset link, a sign-in link and a change of email are refused', async () => {
  const user = await createUser()
  const client = await signIn(user.email, user.password)

  const reset = await anonClient().auth.resetPasswordForEmail(user.email)
  expect(reset.error?.status).toBe(403)
  expect(reset.error?.message).toBe('eCourseFile sends no email. Ask an admin to reset your password.')
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
