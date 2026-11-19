import { expect, test } from 'vitest'
import { anonClient, uniqueEmail } from './harness.ts'

test('self sign-up is refused, and the email cannot sign in afterwards', async () => {
  const email = uniqueEmail('visitor')
  const password = 'visitor-password'

  const signUp = await anonClient().auth.signUp({ email, password })
  expect(signUp.error?.code).toBe('signup_disabled')

  const signIn = await anonClient().auth.signInWithPassword({ email, password })
  expect(signIn.error?.code).toBe('invalid_credentials')
})
