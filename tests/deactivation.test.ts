import { expect, test } from 'vitest'
import { sizedPdf } from '../src/pdf/fixtures.ts'
import { fetchFile, uploadFile } from '../src/uploads.ts'
import { adminClient, anonClient, createOffering, createUser, signIn, signInAs, userIdOf } from './harness.ts'

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

test('a lecturer deactivated while signed in reads and changes nothing with the session they hold, until reactivated', async () => {
  const lecturer = await createUser({ roles: ['lecturer'] })
  const session = await signIn(lecturer.email, lecturer.password)
  const offering = await createOffering({ coordinatorId: lecturer.id })
  const teachingPlan = { offeringId: offering.id, section: 2 }
  const pdf = () => new File([sizedPdf(1024)], 'Teaching Plan.pdf', { type: 'application/pdf' })
  const uploaded = await uploadFile(session, teachingPlan, pdf())
  const readsOffering = async () => (await session.from('offerings').select('id').eq('id', offering.id)).data
  expect(await readsOffering()).toEqual([{ id: offering.id }])
  const admin = await signInAs('admin')

  expect((await admin.from('profiles').update({ active: false }).eq('id', lecturer.id)).error).toBeNull()

  expect(await readsOffering()).toEqual([])
  expect((await session.from('files').select('id').eq('offering_id', offering.id)).data).toEqual([])
  expect((await session.from('offering_lecturers').select('lecturer_id').eq('offering_id', offering.id)).data).toEqual([])
  expect((await session.from('semesters').select('id').limit(1)).data).toEqual([])
  expect((await session.rpc('section_statuses', { offering_id: offering.id })).data).toEqual([])
  expect((await session.rpc('course_file_activity', { offering_id: offering.id })).error?.code).toBe('42501')
  await expect(uploadFile(session, teachingPlan, pdf())).rejects.toMatchObject({ status: 403 })
  await expect(fetchFile(session, uploaded.id)).rejects.toMatchObject({ status: 404 })
  expect((await session.rpc('switch_section', { offering_id: offering.id, section: 12, is_on: false, reason: 'Gone' })).error?.code).toBe('42501')
  expect((await session.rpc('update_my_profile', { full_name: 'Renamed', title: null })).error?.code).toBe('42501')
  expect((await adminClient().from('files').select('id').eq('offering_id', offering.id)).data).toEqual([{ id: uploaded.id }])
  expect((await admin.from('profiles').select('full_name').eq('id', lecturer.id)).data).toEqual([{ full_name: 'Seam1 User' }])

  expect((await admin.from('profiles').update({ active: true }).eq('id', lecturer.id)).error).toBeNull()

  expect(await readsOffering()).toEqual([{ id: offering.id }])
})
