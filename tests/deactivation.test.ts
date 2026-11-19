import { expect, test } from 'vitest'
import { anonClient, createUser, signIn, signInAs, userIdOf } from './harness.ts'

test('admin deactivates a user, who is refused at sign-in and keeps their name, until reactivated', async () => {
  const user = await createUser({ roles: ['lecturer'] })
  const session = await signIn(user.email, user.password)
  const admin = await signInAs('admin')

  expect((await admin.from('profiles').update({ active: false }).eq('id', user.id)).error).toBeNull()

  const refused = await anonClient().auth.signInWithPassword({ email: user.email, password: user.password })
  expect(refused.data.session).toBeNull()
  expect(refused.error?.status).toBe(403)
  const refresh = await session.auth.refreshSession()
  expect(refresh.data.session).toBeNull()
  expect(refresh.error?.status).toBe(403)
  expect((await admin.from('profiles').select('full_name, active').eq('id', user.id)).data).toEqual([
    { full_name: 'Seam1 User', active: false },
  ])

  expect((await admin.from('profiles').update({ active: true }).eq('id', user.id)).error).toBeNull()

  const back = await signIn(user.email, user.password)
  expect(await userIdOf(back)).toBe(user.id)
})

test('admin cannot deactivate another admin or themselves', async () => {
  const admin = await signInAs('admin')
  const otherAdmin = await createUser({ roles: ['admin'] })
  const self = await userIdOf(admin)

  await admin.from('profiles').update({ active: false }).in('id', [otherAdmin.id, self])

  const { data } = await admin.from('profiles').select('active').in('id', [otherAdmin.id, self])
  expect(data).toEqual([{ active: true }, { active: true }])
})
