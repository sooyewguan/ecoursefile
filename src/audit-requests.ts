import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import { UserFacingError } from './errors.ts'

/** An audit request's state, in the order it goes through them. */
export type AuditRequestState = 'draft' | 'sent' | 'replied'

/** A refused send or reply: the audit-requests function's error code, message and HTTP status. */
export class AuditRequestError extends UserFacingError {}

/**
 * Sends the caller's draft request, which notifies the offering's coordinator and lecturers by push.
 * Sending a sent request again changes nothing, and sends its notification only if it has not gone yet.
 */
export function sendAuditRequest(client: SupabaseClient, requestId: string) {
  return callAuditRequests(client, { action: 'send', requestId })
}

/**
 * Replies to a sent request, with an optional message, which notifies the auditor by push. Every
 * checklist item must be ticked or commented. Replying again changes nothing, and sends the reply's
 * notification only if it has not gone yet.
 */
export function replyToAuditRequest(client: SupabaseClient, requestId: string, message?: string) {
  return callAuditRequests(client, { action: 'reply', requestId, message: message ?? null })
}

async function callAuditRequests(client: SupabaseClient, body: Record<string, unknown>) {
  const { data, error } = await client.functions.invoke('audit-requests', { body })
  if (!error) return data as { request: { id: string; state: AuditRequestState } }
  if (error instanceof FunctionsHttpError) {
    const response: Response = error.context
    const payload = (await response.json().catch(() => null)) as { code?: string; message?: string } | null
    throw new AuditRequestError(payload?.code ?? 'internal_error', payload?.message ?? 'The request failed.', response.status)
  }
  throw error
}
