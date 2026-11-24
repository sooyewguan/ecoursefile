import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import { UserFacingError } from './errors.ts'
import { readAll } from './reports.ts'

/** An audit request's state, in the order it goes through them. */
export type AuditRequestState = 'draft' | 'sent' | 'replied' | 'closed'

/**
 * What a send or reply gives back: the request as it is now, and how many browsers the step's
 * notification reached. notified is 0 while push is off and when no recipient has notifications on,
 * so nobody knows of the step until someone tells them. It is null while another call sends the
 * notification.
 */
export type StepResult = { request: { id: string; state: AuditRequestState }; notified: number | null }

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

async function callAuditRequests(client: SupabaseClient, body: Record<string, unknown>): Promise<StepResult> {
  const { data, error } = await client.functions.invoke('audit-requests', { body })
  if (!error) return data as StepResult
  if (error instanceof FunctionsHttpError) {
    const response: Response = error.context
    const payload = (await response.json().catch(() => null)) as { code?: string; message?: string } | null
    throw new AuditRequestError(payload?.code ?? 'internal_error', payload?.message ?? 'The request failed.', response.status)
  }
  throw error
}

/** A request in an inbox on Home, with the course file it is on. */
export type InboxRequest = {
  id: string
  round_number: number
  auditor_name: string
  sent_at: string
  replied_at: string | null
  replier_name: string | null
  reply_message: string | null
  items: { section: number; ticked: boolean; comment: string | null }[]
  offering: { id: string; course: { code: string; title: string }; semester: { code: string } }
}

const INBOX_SELECT =
  'id, round_number, auditor_name, sent_at, replied_at, replier_name, reply_message, items:audit_request_items(section, ticked, comment), offering:offerings!inner(id, course:courses(code, title), semester:semesters(code)'

/**
 * The sent requests on every course file the user teaches or coordinates, in every semester, oldest
 * first. Each waits for a reply from its staff, so it stays until one of them replies, also once
 * every section is fixed.
 */
export function requestsAwaitingReply(client: SupabaseClient, userId: string) {
  return readAll<InboxRequest>((from, to) =>
    client
      .from('audit_requests')
      .select(`${INBOX_SELECT}, staff:offering_lecturers!offering_lecturers_offering_id_fkey!inner(lecturer_id))`)
      .eq('state', 'sent')
      .eq('offering.staff.lecturer_id', userId)
      .order('sent_at')
      .order('id')
      .range(from, to)
      .overrideTypes<InboxRequest[], { merge: false }>(),
  )
}

/** The user's own replied requests, on every course file in every semester, oldest reply first. Each waits for them to review it and close it. */
export function repliesToReview(client: SupabaseClient, userId: string) {
  return readAll<InboxRequest>((from, to) =>
    client
      .from('audit_requests')
      .select(`${INBOX_SELECT})`)
      .eq('state', 'replied')
      .eq('auditor_id', userId)
      .order('replied_at')
      .order('id')
      .range(from, to)
      .overrideTypes<InboxRequest[], { merge: false }>(),
  )
}
