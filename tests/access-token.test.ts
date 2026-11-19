import { expect, test } from 'vitest'
import { accessTokenClaims, createUser, signIn } from './harness.ts'

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
