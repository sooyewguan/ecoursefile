import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { inject } from 'vitest'
import type { GlobalRole } from '../src/roles.ts'
import { roleEmail, TEST_DOMAIN, TEST_PASSWORD } from './global-setup.ts'

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } }

/** A client signed in as nobody, holding the publishable key like the browser does. */
export function anonClient() {
  const { url, publishableKey } = inject('stack')
  return createClient(url, publishableKey, clientOptions)
}

/** A service-role client that bypasses RLS, for arranging test data only. */
export function adminClient() {
  const { url, secretKey } = inject('stack')
  return createClient(url, secretKey, clientOptions)
}

export async function signIn(email: string, password: string) {
  const client = anonClient()
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return client
}

/** Signs in as the user seeded for this role. */
export function signInAs(role: GlobalRole) {
  return signIn(roleEmail(role), TEST_PASSWORD)
}

/** An email no earlier run has used, so tests that create users can rerun without a reset. */
export function uniqueEmail(label: string) {
  return `${label}-${randomUUID()}@${TEST_DOMAIN}`
}
