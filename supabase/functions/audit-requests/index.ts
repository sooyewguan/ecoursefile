// Sends audit requests and replies to them. The auditor who drafted a request sends it, which
// notifies the offering's coordinator and lecturers by push. The offering's staff reply once every
// checklist item is ticked or commented, which notifies the auditor. The send_audit_request and
// reply_to_audit_request RPCs make each step and decide who may. Clients cannot call them, so this
// function calls them with the service role and the caller's id, and no step happens without its
// notification.
//
// Each step commits first, and its notification goes after. audit_request_notifications records the
// notification's delivery and how many browsers it reached, and a call claims it before it sends,
// so two calls never send it at once. A step made again, by a retry or a second click, changes
// nothing, and sends the notification only while it is still owed. So a push failure leaves the
// step made and its notification owed, the caller is told, and a retry sends the notification once.
// Each step answers with the number of browsers its notification reached, so the app tells the
// caller when it reached nobody.
import { callerUser, inList, invalid, isRecord, isUuid, Refusal, rest, SERVICE, serveJson } from '../_shared/http.ts'
import { pusherFromEnv, type PushMessage } from '../_shared/push.ts'

/** A state that owes a notification: a sent request owes staff the request, and a replied one owes the auditor the reply. */
type Step = 'sent' | 'replied'

type AuditRequest = { id: string; state: 'draft' | Step | 'closed' }

/**
 * What a step answers: the request as it is now, and how many browsers the notification of the step
 * reached. notified is null while another call sends it, and when the request is past the step.
 */
type StepResult = { request: AuditRequest; notified: number | null }

type AuditRequestsRequest = { action: 'send'; requestId: string } | { action: 'reply'; requestId: string; message: string | null }

/** display_name is how a notification names a person, with their title. */
type Person = { id: string; display_name: string; active: boolean }

/** A request as the notifications need it, read with the service role. NOTIFICATION_SELECT selects it. */
type NotificationSource = {
  state: Step
  reply_message: string | null
  auditor: Person
  replier: { display_name: string } | null
  offering: {
    id: string
    semester: { code: string }
    course: { code: string; title: string }
    lecturers: { lecturer: Person }[]
  }
  items: { section: number }[]
}

const NOTIFICATION_SELECT = [
  'state',
  'reply_message',
  'auditor:profiles!audit_requests_auditor_id_fkey(id,display_name,active)',
  'replier:profiles!audit_requests_replied_by_fkey(display_name)',
  'offering:offerings(id,semester:semesters(code),course:courses(code,title),lecturers:offering_lecturers!offering_lecturers_offering_id_fkey(lecturer:profiles(id,display_name,active)))',
  'items:audit_request_items(section)',
].join(',')

const PUSH_FAILED: Record<Step, string> = {
  sent: 'The request is sent, but its notification to the coordinator and lecturers could not be sent. Send it again to retry the notification.',
  replied: 'The reply is recorded, but its notification to the auditor could not be sent. Reply again to retry the notification.',
}

/** The longest reply message that a notification quotes in full. */
const QUOTE_LENGTH = 200

const pusher = pusherFromEnv()

serveJson(async (body, caller) => {
  const request = parseRequest(body)
  switch (request.action) {
    case 'send':
      return send(request.requestId, caller)
    case 'reply':
      return reply(request.requestId, request.message, caller)
  }
})

function parseRequest(body: unknown): AuditRequestsRequest {
  const input: Record<string, unknown> = isRecord(body) ? body : {}
  const { action, requestId, message = null } = input
  if (action === 'send' && isUuid(requestId)) return { action, requestId }
  if (action === 'reply' && isUuid(requestId) && (message === null || typeof message === 'string')) return { action, requestId, message }
  throw invalid('action must be send, with requestId, or reply, with requestId and an optional message.')
}

async function send(requestId: string, caller: string): Promise<StepResult> {
  await findRequest(requestId, caller)
  const request = await rest<AuditRequest>(
    'POST',
    '/rpc/send_audit_request',
    { request_id: requestId, actor_id: (await callerUser(caller)).id },
    SERVICE,
  )
  return { request: { id: request.id, state: request.state }, notified: request.state === 'sent' ? await deliver(request.id, 'sent') : null }
}

/**
 * The RPC decides who may reply before it looks at the checklist, and returns a sent request
 * unchanged while an item is neither ticked nor commented. A closed request owes no notification.
 */
async function reply(requestId: string, message: string | null, caller: string): Promise<StepResult> {
  await findRequest(requestId, caller)
  const request = await rest<AuditRequest>(
    'POST',
    '/rpc/reply_to_audit_request',
    { request_id: requestId, actor_id: (await callerUser(caller)).id, message },
    SERVICE,
  )
  if (request.state === 'sent') throw new Refusal(409, 'checklist_incomplete', 'Tick or comment on every item of the checklist before you reply.')
  return { request: { id: request.id, state: request.state }, notified: request.state === 'replied' ? await deliver(request.id, 'replied') : null }
}

/** Refuses a request that the caller cannot read. A draft is its auditor's alone, so nobody else finds one. */
async function findRequest(requestId: string, caller: string) {
  const [found] = await rest<unknown[]>('GET', `/audit_requests?id=eq.${requestId}&select=id`, undefined, caller)
  if (!found) throw new Refusal(404, 'not_found', 'This audit request does not exist, or you cannot see it.')
}

/**
 * Sends the notification that the request owes for reaching the step, unless it is delivered or
 * another call is sending it, and returns how many browsers it reached: now, or when it was
 * delivered before, or null while another call sends it. If it cannot be sent, the claim goes, so a
 * retry sends it.
 */
async function deliver(requestId: string, step: Step): Promise<number | null> {
  const delivery = `/audit_request_notifications?request_id=eq.${requestId}&state=eq.${step}`
  const claimed = await rest<boolean | null>('POST', '/rpc/claim_audit_notification', { request_id: requestId, state: step }, SERVICE)
  if (!claimed) {
    const [delivered] = await rest<{ reached: number | null }[]>('GET', `${delivery}&delivered_at=not.is.null&select=reached`, undefined, SERVICE)
    return delivered?.reached ?? null
  }
  let reached: number
  try {
    const [source] = await rest<NotificationSource[]>('GET', `/audit_requests?id=eq.${requestId}&select=${NOTIFICATION_SELECT}`, undefined, SERVICE)
    const { to, message } = step === 'sent' ? requestNotification(source) : replyNotification(source)
    reached = await push(to, { ...message, link: `/course-files/${source.offering.id}#audit-request-${requestId}` })
  } catch (error) {
    console.error(error)
    await rest('PATCH', delivery, { claimed_at: null }, SERVICE)
    throw new Refusal(502, 'push_failed', PUSH_FAILED[step])
  }
  await rest('PATCH', delivery, { delivered_at: new Date().toISOString(), reached }, SERVICE)
  return reached
}

/**
 * Sends the notification to every browser where a recipient turned notifications on, removes the
 * tokens that the push service no longer knows, and returns how many browsers it reached. A
 * recipient with no browser gets nothing, and so does everyone while the site has no push. They
 * read the request in the app.
 */
async function push(userIds: string[], message: PushMessage) {
  if (!pusher || userIds.length === 0) return 0
  const tokens = await rest<{ token: string }[]>('GET', `/push_tokens?select=token&user_id=${inList(userIds)}`, undefined, SERVICE)
  const { stale } = await pusher.send(tokens.map(({ token }) => token), message)
  if (stale.length > 0) await rest('DELETE', `/push_tokens?token=${inList(stale)}`, undefined, SERVICE)
  return tokens.length - stale.length
}

/**
 * The request's notification to the coordinator and every lecturer of the offering, once each.
 * Deactivated staff cannot sign in to fix anything, so they get none.
 */
function requestNotification({ auditor, offering, items }: NotificationSource) {
  const staff = offering.lecturers.map(({ lecturer }) => lecturer).filter((lecturer) => lecturer.active)
  const count = items.length === 1 ? 'a section' : `${items.length} sections`
  return {
    to: [...new Set(staff.map((lecturer) => lecturer.id))],
    message: {
      title: `Audit request for ${offering.course.code}`,
      body: `${auditor.display_name} asks you to fix ${count} of the course file of ${courseOf(offering)}.`,
    },
  }
}

/** The reply's notification to the auditor, with the reply's message. A deactivated auditor gets none. */
function replyNotification({ auditor, replier, reply_message, offering }: NotificationSource) {
  const quote = reply_message && reply_message.length > QUOTE_LENGTH ? `${reply_message.slice(0, QUOTE_LENGTH - 1)}…` : reply_message
  return {
    to: auditor.active ? [auditor.id] : [],
    message: {
      title: `Reply to your audit request for ${offering.course.code}`,
      body: `${replier!.display_name} replied to your audit request for ${courseOf(offering)}.${quote ? ` "${quote}"` : ''}`,
    },
  }
}

function courseOf({ course, semester }: NotificationSource['offering']) {
  return `${course.code} ${course.title}, ${semester.code}`
}
