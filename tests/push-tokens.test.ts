// Seam 1: each browser where a user turned push notifications on registers its FCM token, and the
// audit-requests function sends to every token of a step's recipients. The fake push service
// stands in for FCM.
import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { sendAuditRequest } from '../src/audit-requests.ts'
import { adminClient, anonClient, createOffering, createUser, fakePushOutbox, registerPushToken, signIn } from './harness.ts'

async function person(role: 'lecturer' | 'auditor') {
  const user = await createUser({ roles: [role] })
  return { id: user.id, client: await signIn(user.email, user.password) }
}

async function tokensOf(userId: string) {
  const { data, error } = await adminClient().from('push_tokens').select('token').eq('user_id', userId).order('token')
  if (error) throw error
  return data.map(({ token }) => token)
}

/** A sent request from a new auditor to an offering with this coordinator and no other lecturer. */
async function sendRequestTo(coordinatorId: string) {
  const offering = await createOffering({ coordinatorId })
  const auditor = await person('auditor')
  const marked = await auditor.client.rpc('record_verdict', { offering_id: offering.id, section: 2, verdict: 'needs_fix', comment: 'Upload the plan.' })
  if (marked.error) throw marked.error
  const { data, error } = await auditor.client.from('audit_requests').select('id').eq('offering_id', offering.id).single()
  if (error) throw error
  await sendAuditRequest(auditor.client, data.id)
}

test('a user registers a token for each browser and reads only their own', async () => {
  const user = await person('lecturer')
  const other = await person('lecturer')
  const tokens = [await registerPushToken(user.client), await registerPushToken(user.client)]
  await registerPushToken(other.client)

  expect(await tokensOf(user.id)).toEqual(tokens.toSorted())
  const { data } = await user.client.from('push_tokens').select('token, user_id')
  expect(data?.map((row) => row.user_id)).toEqual([user.id, user.id])
})

test('a browser that another user signs in on moves its token to them', async () => {
  const first = await person('lecturer')
  const second = await person('lecturer')
  const token = await registerPushToken(first.client)

  expect((await second.client.rpc('register_push_token', { token })).error).toBeNull()

  expect(await tokensOf(first.id)).toEqual([])
  expect(await tokensOf(second.id)).toEqual([token])
})

test('a user removes their own token, and not another user\'s', async () => {
  const user = await person('lecturer')
  const other = await person('lecturer')
  const own = await registerPushToken(user.client)
  const theirs = await registerPushToken(other.client)

  await user.client.rpc('unregister_push_token', { token: own })
  await user.client.rpc('unregister_push_token', { token: theirs })

  expect(await tokensOf(user.id)).toEqual([])
  expect(await tokensOf(other.id)).toEqual([theirs])
})

test('clients write tokens only through the RPCs, and a signed-out client not at all', async () => {
  const user = await person('lecturer')
  const other = await person('lecturer')
  const theirs = await registerPushToken(other.client)

  expect((await user.client.from('push_tokens').insert({ token: `fake-${randomUUID()}`, user_id: user.id })).error?.code).toBe('42501')
  expect((await user.client.from('push_tokens').update({ user_id: user.id }).eq('token', theirs)).error?.code).toBe('42501')
  expect((await user.client.from('push_tokens').delete().eq('token', theirs)).error?.code).toBe('42501')
  expect((await anonClient().rpc('register_push_token', { token: `fake-${randomUUID()}` })).error).not.toBeNull()
  expect(await tokensOf(other.id)).toEqual([theirs])
})

test('a notification goes to every browser of the recipient, and a token FCM no longer knows is removed', async () => {
  const coordinator = await person('lecturer')
  const [phone, laptop, gone] = [await registerPushToken(coordinator.client), await registerPushToken(coordinator.client), await registerPushToken(coordinator.client)]
  const { error } = await adminClient().schema('fake_push').from('unregistered').insert({ token: gone })
  if (error) throw error

  await sendRequestTo(coordinator.id)

  expect((await fakePushOutbox(phone, laptop, gone)).map(({ token }) => token).toSorted()).toEqual([phone, laptop].toSorted())
  expect(await tokensOf(coordinator.id)).toEqual([phone, laptop].toSorted())
})

test('a recipient with no browser gets nothing, and the step counts as notified', async () => {
  const coordinator = await person('lecturer')

  await sendRequestTo(coordinator.id)

  const { data } = await coordinator.client.from('audit_requests').select('state, notification_pending')
  expect(data).toEqual([{ state: 'sent', notification_pending: false }])
})

test('clients can neither read nor write the fake push outbox', async () => {
  const user = await person('lecturer')
  const outbox = user.client.schema('fake_push').from('outbox')
  expect((await outbox.select('id').limit(1)).error?.code).toBe('42501')
  expect((await outbox.insert({ token: 'x', title: 'Hi', body: 'Hi', link: '/' })).error?.code).toBe('42501')
})
