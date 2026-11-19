import { randomUUID } from 'node:crypto'
import { createClient, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
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

/** Creates a user with the service role, as a test arrangement, and returns their id and credentials. */
export async function createUser(options: { roles?: GlobalRole[]; departmentId?: string } = {}) {
  const admin = adminClient()
  const email = uniqueEmail('user')
  const password = 'temporary-password'
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Seam1 User' },
  })
  if (error) throw error
  const id = data.user.id
  if (options.departmentId) {
    const { error: departmentError } = await admin.from('profiles').update({ department_id: options.departmentId }).eq('id', id)
    if (departmentError) throw departmentError
  }
  if (options.roles?.length) {
    const { error: rolesError } = await admin.from('user_roles').insert(options.roles.map((role) => ({ user_id: id, role })))
    if (rolesError) throw rolesError
  }
  return { id, email, password }
}

export async function userIdOf(client: SupabaseClient) {
  const { data } = await client.auth.getSession()
  if (!data.session) throw new Error('The client has no session')
  return data.session.user.id
}

/** The claims of the client's current access token, decoded the way any reader of the JWT would. */
export async function accessTokenClaims(client: SupabaseClient): Promise<Record<string, unknown>> {
  const { data } = await client.auth.getSession()
  if (!data.session) throw new Error('The client has no session')
  return JSON.parse(Buffer.from(data.session.access_token.split('.')[1], 'base64url').toString())
}

/** Adds a department with the service role, as a test arrangement, and returns its id. */
export async function createDepartment() {
  const { data, error } = await adminClient()
    .from('departments')
    .insert({ code: `D-${randomUUID()}`, name: 'Seam1 Department' })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

/** The user's roles as this client reads them, sorted. */
export async function rolesOf(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from('user_roles').select('role').eq('user_id', userId)
  if (error) throw error
  return data.map((row: { role: GlobalRole }) => row.role).toSorted()
}

/** Calls the accounts Edge Function as this client, the way the app does, and returns the HTTP status and JSON body. */
export async function callAccounts(client: SupabaseClient, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const { data, error } = await client.functions.invoke('accounts', { body })
  if (!error) return { status: 200, body: data }
  if (error instanceof FunctionsHttpError) {
    const response: Response = error.context
    return { status: response.status, body: await response.json() }
  }
  throw error
}
