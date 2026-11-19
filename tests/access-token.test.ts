import { expect, test } from 'vitest'
import { accessTokenClaims, adminClient, anonClient, createUser, signIn } from './harness.ts'

test('the access token carries every global role the user holds', async () => {
  const user = await createUser({ roles: ['lecturer', 'auditor', 'dean'] })

  const client = await signIn(user.email, user.password)

  const { app_roles } = await accessTokenClaims(client)
  expect((app_roles as string[]).toSorted()).toEqual(['auditor', 'dean', 'lecturer'])
})

test('the access token of a user with no roles carries an empty role list', async () => {
  const user = await createUser()

  const client = await signIn(user.email, user.password)

  expect(await accessTokenClaims(client)).toMatchObject({ app_roles: [] })
})

test('an inactive user is refused at sign-in and at token refresh', async () => {
  const user = await createUser({ roles: ['lecturer'] })
  const client = await signIn(user.email, user.password)

  const { error } = await adminClient().from('profiles').update({ active: false }).eq('id', user.id)
  expect(error).toBeNull()

  const signInResult = await anonClient().auth.signInWithPassword({ email: user.email, password: user.password })
  expect(signInResult.data.session).toBeNull()
  expect(signInResult.error?.status).toBe(403)

  const refreshResult = await client.auth.refreshSession()
  expect(refreshResult.data.session).toBeNull()
  expect(refreshResult.error?.status).toBe(403)
})
