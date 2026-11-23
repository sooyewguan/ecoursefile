import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'

/** A refusal from the password function: its error code, message and HTTP status. */
export class PasswordError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

/**
 * Sets a new password for the signed-in user, with the ID token of a TAC to their phone. A user
 * with no phone registers the token's phone. It ends the user's sessions, so the caller signs in again.
 */
export function setPassword(client: SupabaseClient, idToken: string, password: string) {
  return callPassword<{ phone: string }>(client, { action: 'set-password', idToken, password })
}

/** Moves the signed-in user to the token's phone, with their current password. */
export function changePhone(client: SupabaseClient, idToken: string, password: string) {
  return callPassword<{ phone: string }>(client, { action: 'change-phone', idToken, password })
}

/** Sets a new password for the account with the token's phone, signed out. Returns the account's email, to sign in with. */
export function resetPassword(client: SupabaseClient, idToken: string, password: string) {
  return callPassword<{ email: string }>(client, { action: 'reset-password', idToken, password })
}

async function callPassword<T>(client: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke('password', { body })
  if (!error) return data as T
  if (error instanceof FunctionsHttpError) {
    const response: Response = error.context
    const payload = (await response.json().catch(() => null)) as { code?: string; message?: string } | null
    throw new PasswordError(payload?.code ?? 'internal_error', payload?.message ?? 'The request failed.', response.status)
  }
  throw error
}
