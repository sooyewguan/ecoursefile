import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, inject, test } from 'vitest'
import { signIn, uniqueEmail } from './harness.ts'

const execFileAsync = promisify(execFile)

function seedRoot(env: Record<string, string>) {
  return execFileAsync(process.execPath, ['scripts/seed-root.ts'], { env: { PATH: process.env.PATH, ...env } })
}

function rootConfig() {
  const { url, secretKey } = inject('stack')
  return {
    SUPABASE_URL: url,
    SUPABASE_SECRET_KEY: secretKey,
    ROOT_EMAIL: uniqueEmail('root'),
    ROOT_PASSWORD: 'root-seed-password',
    ROOT_NAME: 'Seam1 Root',
  }
}

test('seeding creates root from config, and seeding again changes nothing', async () => {
  const config = rootConfig()

  await seedRoot(config)
  await seedRoot(config)

  const root = await signIn(config.ROOT_EMAIL, config.ROOT_PASSWORD)
  const profiles = await root.from('profiles').select('email, full_name, must_change_password')
  expect(profiles.data).toEqual([{ email: config.ROOT_EMAIL, full_name: 'Seam1 Root', must_change_password: true }])
  expect((await root.from('user_roles').select('role')).data).toEqual([{ role: 'root' }])
})

test('seeding again after root sets their own password keeps that password', async () => {
  const config = rootConfig()
  await seedRoot(config)
  const root = await signIn(config.ROOT_EMAIL, config.ROOT_PASSWORD)
  expect((await root.auth.updateUser({ password: 'root-own-password' })).error).toBeNull()

  await seedRoot(config)

  const again = await signIn(config.ROOT_EMAIL, 'root-own-password')
  expect((await again.from('profiles').select('must_change_password')).data).toEqual([{ must_change_password: false }])
  expect((await again.from('user_roles').select('role')).data).toEqual([{ role: 'root' }])
})

test('seeding exits non-zero and names the variable when config is missing', async () => {
  const { ROOT_PASSWORD: _omitted, ...config } = rootConfig()

  await expect(seedRoot(config)).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining('ROOT_PASSWORD'),
  })
})
