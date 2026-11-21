// Seam 1: a user asks for a password reset link on the forgot-password page, follows the link in the
// email, and sets a new password, the way the app does. Supabase Auth hands each email to the Send
// Email Hook, which sends it through the mail adapter, and the local stack's fake mailer records it
// in the fake_mail outbox. The stack runs no SMTP server, so Supabase Auth fails any email it would
// send through SMTP with HTTP 500.
import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, inject, test } from 'vitest'
import { adminClient, anonClient, createUser, fakeOutbox, signIn, signInAs, uniqueEmail } from './harness.ts'

/** The app's origin on the local stack, which is its site URL. The forgot-password page sends its own origin. */
const APP = 'http://localhost:5173'

/** Asks for a reset link as the forgot-password page does. */
function requestReset(email: string, redirectTo = APP) {
  return anonClient().auth.resetPasswordForEmail(email, { redirectTo })
}

/** The one reset email in the outbox for this address. */
async function resetEmail(email: string) {
  const sent = await fakeOutbox(email)
  expect(sent).toHaveLength(1)
  return sent[0]
}

/** The link in a reset email, read from its HTML as a mail client reads the href. */
function linkIn(html: string) {
  const href = /<a href="([^"]+)">/.exec(html)?.[1]
  if (!href) throw new Error(`The email has no link: ${html}`)
  return new URL(href.replaceAll('&amp;', '&'))
}

/** Uses the link's token as the reset page does, which signs a new client in. */
async function followLink(link: URL) {
  const client = anonClient()
  const result = await client.auth.verifyOtp({ token_hash: link.searchParams.get('token_hash') ?? '', type: 'recovery' })
  return { client, ...result }
}

async function readOwnFlag(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from('profiles').select('must_change_password').eq('id', userId).single()
  if (error) throw error
  return data.must_change_password
}

async function deactivate(userId: string) {
  const { error } = await adminClient().from('profiles').update({ active: false }).eq('id', userId)
  if (error) throw error
}

test('a reset email goes through the mail adapter, not SMTP, and its link lets the user set a new password and sign in with it', async () => {
  const user = await createUser({ roles: ['lecturer'] })

  const request = await requestReset(user.email)

  expect(request.error).toBeNull()
  const email = await resetEmail(user.email)
  expect(email).toMatchObject({ recipients: [user.email], subject: 'Reset your eCourseFile password' })
  const link = linkIn(email.html)
  expect(`${link.origin}${link.pathname}`).toBe(`${APP}/reset-password`)

  const followed = await followLink(link)
  expect(followed.error).toBeNull()
  expect(followed.data.user?.id).toBe(user.id)
  expect((await followed.client.auth.updateUser({ password: 'chosen-password' })).error).toBeNull()

  const signedIn = await signIn(user.email, 'chosen-password')
  // The user chose the password, so the must-change-password flag that their account started with is cleared.
  expect(await readOwnFlag(signedIn, user.id)).toBe(false)
  expect((await anonClient().auth.signInWithPassword({ email: user.email, password: user.password })).error).not.toBeNull()
  expect((await followLink(link)).data.session).toBeNull()
})

test('a reset link opens the app even when the request names another site', async () => {
  const user = await createUser()

  expect((await requestReset(user.email, 'https://attacker.example/steal')).error).toBeNull()

  expect(linkIn((await resetEmail(user.email)).html).origin).toBe(APP)
})

test('a deactivated user gets no reset email, and the answer is the same as for an active user or an unknown email', async () => {
  const [active, deactivated] = [await createUser(), await createUser()]
  await deactivate(deactivated.id)

  const answers = [await requestReset(active.email), await requestReset(deactivated.email), await requestReset(uniqueEmail('unknown'))]

  expect(answers[0]).toEqual({ data: {}, error: null })
  expect(answers[1]).toEqual(answers[0])
  expect(answers[2]).toEqual(answers[0])
  expect(await fakeOutbox(active.email)).toHaveLength(1)
  expect(await fakeOutbox(deactivated.email)).toEqual([])
})

test('a link sent before the user was deactivated cannot sign them in or set a password', async () => {
  const user = await createUser()
  expect((await requestReset(user.email)).error).toBeNull()
  const link = linkIn((await resetEmail(user.email)).html)

  await deactivate(user.id)
  const followed = await followLink(link)

  // The access token hook refuses a deactivated user a session, so the token signs nobody in.
  expect(followed.error?.status).toBe(403)
  expect(followed.data.session).toBeNull()
  expect((await followed.client.auth.updateUser({ password: 'chosen-password' })).error).not.toBeNull()
})

test("the reset email escapes HTML in the user's name", async () => {
  const user = await createUser()
  const { error } = await adminClient().from('profiles').update({ full_name: `<img src=x onerror="alert('x')"> & Co` }).eq('id', user.id)
  if (error) throw error

  expect((await requestReset(user.email)).error).toBeNull()

  const { html } = await resetEmail(user.email)
  expect(html).toContain('Hello &lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; Co,')
  expect(html).not.toContain('<img')
})

test('the reset email greets the user by their title and name', async () => {
  const user = await createUser({ fullName: 'Aisyah Reset' })
  const own = await signIn(user.email, user.password)
  expect((await own.rpc('update_my_profile', { full_name: 'Aisyah Reset', title: 'Dr.' })).error).toBeNull()

  expect((await requestReset(user.email)).error).toBeNull()

  expect((await resetEmail(user.email)).html).toContain('<p>Hello Dr. Aisyah Reset,</p>')
})

test('a sign-in link is refused, and no email is sent', async () => {
  const user = await createUser()

  const { error } = await anonClient().auth.signInWithOtp({ email: user.email, options: { shouldCreateUser: false } })

  expect(error?.status).toBe(403)
  expect(await fakeOutbox(user.email)).toEqual([])
})

test('a change of email is refused, no email is sent, and the email stays', async () => {
  const user = await createUser()
  const client = await signIn(user.email, user.password)
  const newEmail = uniqueEmail('changed')

  const { error } = await client.auth.updateUser({ email: newEmail })

  expect(error?.status).toBe(403)
  expect(await fakeOutbox(user.email)).toEqual([])
  expect(await fakeOutbox(newEmail)).toEqual([])
  expect((await adminClient().auth.admin.getUserById(user.id)).data.user?.email).toBe(user.email)
})

test('the Send Email Hook sends nothing for a call that Supabase Auth did not sign', async () => {
  const user = await createUser()
  const payload = JSON.stringify({
    user: { id: user.id, email: user.email },
    email_data: { email_action_type: 'recovery', token_hash: 'forged', redirect_to: APP },
  })
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
  expect(await fakeOutbox(user.email)).toEqual([])
})

test('clients can neither read nor write the fake outbox', async () => {
  for (const client of [anonClient(), await signInAs('admin')]) {
    const outbox = client.schema('fake_mail').from('outbox')
    expect((await outbox.select('id').limit(1)).error?.code).toBe('42501')
    expect((await outbox.insert({ recipients: ['someone@seam1.test'], subject: 'Hi', html: '<p>Hi</p>' })).error?.code).toBe('42501')
  }
})
