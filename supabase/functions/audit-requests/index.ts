// Sends audit requests and replies to them. The auditor who drafted a request sends it, which emails
// the offering's coordinator and lecturers every flagged section with its comment. The offering's
// staff reply once every checklist item is ticked or commented, which emails the auditor. The
// send_audit_request and reply_to_audit_request RPCs make each step as the caller, and decide who may.
//
// Each step commits first, and its email goes after. audit_request_emails records the email's
// delivery, and a call claims it before it sends, so two calls never send it at once. A step made
// again, by a retry or a second click, changes nothing, and sends the email only while it is still
// owed. So a mail failure leaves the step made and its email owed, the caller is told, and a retry
// sends the email once.
import { escapeHtml } from '../_shared/html.ts'
import { invalid, isRecord, isUuid, Refusal, rest, SERVICE, serveJson } from '../_shared/http.ts'
import { mailerFromEnv, type Mail } from '../_shared/mail.ts'
import { SECTIONS } from '../_shared/sections.ts'

/** A state that owes an email: a sent request owes staff the request, and a replied one owes the auditor the reply. */
type Step = 'sent' | 'replied'

type AuditRequest = { id: string; state: 'draft' | Step }

type AuditRequestsRequest = { action: 'send'; requestId: string } | { action: 'reply'; requestId: string; message: string | null }

type Person = { full_name: string; email: string; active: boolean }

/** A request as the emails need it, read with the service role. EMAIL_SELECT selects it. */
type EmailSource = {
  state: Step
  reply_message: string | null
  auditor: Person
  replier: { full_name: string } | null
  offering: {
    coordinator_id: string
    semester: { code: string }
    course: { code: string; title: string }
    lecturers: { lecturer: Person & { id: string } }[]
  }
  items: { section: number; ticked: boolean; comment: string | null; verdict: { comment: string } }[]
}

const EMAIL_SELECT = [
  'state',
  'reply_message',
  'auditor:profiles!audit_requests_auditor_id_fkey(full_name,email,active)',
  'replier:profiles!audit_requests_replied_by_fkey(full_name)',
  'offering:offerings(coordinator_id,semester:semesters(code),course:courses(code,title),lecturers:offering_lecturers!offering_lecturers_offering_id_fkey(lecturer:profiles(id,full_name,email,active)))',
  'items:audit_request_items(section,ticked,comment,verdict:section_verdicts(comment))',
].join(',')

const MAIL_FAILED: Record<Step, string> = {
  sent: 'The request is sent, but its email to the coordinator and lecturers could not be sent. Send it again to retry the email.',
  replied: 'The reply is recorded, but its email to the auditor could not be sent. Reply again to retry the email.',
}

const mailer = mailerFromEnv()

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

async function send(requestId: string, caller: string) {
  await findRequest(requestId, caller)
  const request = await rest<AuditRequest>('POST', '/rpc/send_audit_request', { request_id: requestId }, caller)
  if (request.state === 'sent') await deliver(request.id, 'sent')
  return { request: { id: request.id, state: request.state } }
}

async function reply(requestId: string, message: string | null, caller: string) {
  const found = await findRequest(requestId, caller)
  if (found.state === 'sent' && !found.checklist_complete) {
    throw new Refusal(409, 'checklist_incomplete', 'Tick or comment on every item of the checklist before you reply.')
  }
  const request = await rest<AuditRequest>('POST', '/rpc/reply_to_audit_request', { request_id: requestId, message }, caller)
  if (request.state === 'replied') await deliver(request.id, 'replied')
  return { request: { id: request.id, state: request.state } }
}

/** The request as the caller reads it. A draft is its auditor's alone, so nobody else finds one. */
async function findRequest(requestId: string, caller: string) {
  const [found] = await rest<{ state: AuditRequest['state']; checklist_complete: boolean }[]>(
    'GET',
    `/audit_requests?id=eq.${requestId}&select=state,checklist_complete`,
    undefined,
    caller,
  )
  if (!found) throw new Refusal(404, 'not_found', 'This audit request does not exist, or you cannot see it.')
  return found
}

/**
 * Sends the email that the request owes for reaching the step, unless it is delivered or another
 * call is sending it. If it cannot be sent, the claim goes, so a retry sends it.
 */
async function deliver(requestId: string, step: Step) {
  const claimed = await rest<boolean | null>('POST', '/rpc/claim_audit_email', { request_id: requestId, state: step }, SERVICE)
  if (!claimed) return
  const delivery = `/audit_request_emails?request_id=eq.${requestId}&state=eq.${step}`
  try {
    const [source] = await rest<EmailSource[]>('GET', `/audit_requests?id=eq.${requestId}&select=${EMAIL_SELECT}`, undefined, SERVICE)
    const mail = step === 'sent' ? requestEmail(source) : replyEmail(source)
    if (mail.to.length > 0) await mailer.send(mail)
  } catch (error) {
    console.error(error)
    await rest('PATCH', delivery, { claimed_at: null }, SERVICE)
    throw new Refusal(502, 'mail_failed', MAIL_FAILED[step])
  }
  await rest('PATCH', delivery, { delivered_at: new Date().toISOString() }, SERVICE)
}

/**
 * The request's email to the coordinator and every lecturer of the offering, once each, the
 * coordinator first. Deactivated staff cannot sign in to fix anything, so they get no email.
 */
function requestEmail({ auditor, offering, items }: EmailSource): Mail {
  const staff = offering.lecturers
    .map(({ lecturer }) => lecturer)
    .filter((lecturer) => lecturer.active)
    .toSorted((a, b) => Number(b.id === offering.coordinator_id) - Number(a.id === offering.coordinator_id) || a.full_name.localeCompare(b.full_name))
  const flagged = sorted(items)
  return {
    to: [...new Set(staff.map((lecturer) => lecturer.email))],
    subject: `Audit request for ${courseOf(offering)}`,
    html: [
      '<p>Hello,</p>',
      `<p>${escapeHtml(auditor.full_name)} audited the course file of ${escapeHtml(courseOf(offering))} and asks you to fix ${flagged.length === 1 ? 'this section' : `these ${flagged.length} sections`}:</p>`,
      `<ul>${flagged.map((item) => `<li><strong>${sectionName(item.section)}</strong>: ${paragraph(item.verdict.comment)}</li>`).join('')}</ul>`,
      '<p>Open the course file in eCourseFile, where these sections are your checklist. A section ticks itself when it gets a new file. Comment on any section you cannot fix. Once every section is ticked or commented, any of you can reply to the auditor.</p>',
    ].join('\n'),
  }
}

/** The reply's email to the auditor, with the checklist as staff replied. A deactivated auditor gets none. */
function replyEmail({ auditor, replier, reply_message, offering, items }: EmailSource): Mail {
  return {
    to: auditor.active ? [auditor.email] : [],
    subject: `Reply to your audit request for ${courseOf(offering)}`,
    html: [
      `<p>Hello ${escapeHtml(auditor.full_name)},</p>`,
      `<p>${escapeHtml(replier!.full_name)} replied to your audit request for ${escapeHtml(courseOf(offering))}.</p>`,
      ...(reply_message ? [`<blockquote>${paragraph(reply_message)}</blockquote>`] : []),
      `<ul>${sorted(items)
        .map((item) => {
          const answers = [...(item.ticked ? ['It has a new file.'] : []), ...(item.comment ? [`Comment: ${paragraph(item.comment)}`] : [])]
          return `<li><strong>${sectionName(item.section)}</strong>: ${answers.join(' ')}</li>`
        })
        .join('')}</ul>`,
      '<p>Open the course file in eCourseFile to check these sections again.</p>',
    ].join('\n'),
  }
}

function courseOf({ course, semester }: EmailSource['offering']) {
  return `${course.code} ${course.title}, ${semester.code}`
}

function sectionName(section: number) {
  return escapeHtml(`${section} ${SECTIONS.find((s) => s.number === section)!.title}`)
}

function sorted(items: EmailSource['items']) {
  return items.toSorted((a, b) => a.section - b.section)
}

/** Text that a user wrote, escaped, with its line breaks kept. */
function paragraph(text: string) {
  return escapeHtml(text).replaceAll('\n', '<br>')
}
