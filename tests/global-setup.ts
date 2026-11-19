import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import type { TestProject } from 'vitest/node'
import { ensureUser } from '../scripts/ensure-user.ts'
import { GLOBAL_ROLES, type GlobalRole } from '../src/roles.ts'

export type Stack = { url: string; publishableKey: string; secretKey: string }

declare module 'vitest' {
  export interface ProvidedContext {
    stack: Stack
  }
}

export const TEST_DOMAIN = 'seam1.test'
export const TEST_PASSWORD = 'seam1-password'

export function roleEmail(role: GlobalRole) {
  return `${role}@${TEST_DOMAIN}`
}

export default async function setup(project: TestProject) {
  const stack = readStack()
  const admin = createClient(stack.url, stack.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  for (const role of GLOBAL_ROLES) {
    await ensureUser(admin, {
      email: roleEmail(role),
      password: TEST_PASSWORD,
      fullName: `Seam1 ${role}`,
      roles: [role],
      mustChangePassword: false,
    })
  }
  project.provide('stack', stack)
}

function readStack(): Stack {
  let output: string
  try {
    output = execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    throw new Error('Seam 1 tests need the local Supabase stack. Start it with `npx supabase start`.')
  }
  const status = JSON.parse(output)
  return { url: status.API_URL, publishableKey: status.PUBLISHABLE_KEY, secretKey: status.SECRET_KEY }
}
