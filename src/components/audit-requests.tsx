import { BellOffIcon, CircleCheckIcon, CircleIcon, MailIcon, MessageSquareIcon, ReplyIcon, SendIcon, UploadIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog, FormDialog } from '@/components/action-dialogs'
import { ErrorAlert } from '@/components/notice'
import { LoadError } from '@/components/page'
import { SectionStatusBadge } from '@/components/section-status'
import { Time } from '@/components/time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { cn, plural } from '@/lib/utils'
import { AuditRequestError, replyToAuditRequest, sendAuditRequest, type AuditRequestState, type StepResult } from '../audit-requests.ts'
import { friendlyError } from '../errors.ts'
import { PUSH_ADAPTER } from '../firebase.ts'
import { sectionName, SECTIONS_WITH_PAGES, type SectionStatus } from '../sections.ts'
import { supabase } from '../supabase.ts'

/** One flagged section: the auditor's comment from the Needs fix verdict, whether it is ticked, and a staff comment. */
type RequestItem = {
  section: number
  ticked: boolean
  comment: string | null
  commenter_name: string | null
  verdict: { comment: string }
}

type AuditRequest = {
  id: string
  state: AuditRequestState
  auditor_id: string
  auditor_name: string
  auditor_email: string
  sent_at: string | null
  replied_at: string | null
  replier_name: string | null
  reply_message: string | null
  checklist_complete: boolean
  notification_pending: boolean
  /** How many browsers the latest step's notification reached, once it has gone. */
  notified_browsers: number | null
  items: RequestItem[]
}

const SELECT =
  'id, state, auditor_id, auditor_name, auditor_email, sent_at, replied_at, replier_name, reply_message, checklist_complete, notification_pending, notified_browsers, items:audit_request_items(section, ticked, comment, commenter_name, verdict:section_verdicts(comment))'

/** A mailto link to these addresses, with a subject. */
function mailto(emails: string[], subject: string) {
  return `mailto:${emails.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}`
}

/** An item that staff are commenting on. */
type Commenting = { request: AuditRequest; item: RequestItem }

/**
 * The audit requests of a course file that the user reads: an auditor's own draft, which they
 * send, and every sent request, whose flagged sections are a checklist for the offering's staff.
 * isStaff is whether the user is the coordinator or a lecturer of the offering, who comment on
 * items and reply. statuses is each section's status, which a draft shows beside its sections.
 * staffEmails are the coordinator's and lecturers' emails, for an auditor to tell them of a request
 * that notified nobody, and courseCode names the course file in that email. A request's
 * notification links to #audit-request-<id>, so the page scrolls to that request and marks it once
 * the requests load.
 */
export function AuditRequests({
  offeringId,
  courseCode,
  userId,
  isStaff,
  staffEmails,
  statuses,
}: {
  offeringId: string
  courseCode: string
  userId: string | null
  isStaff: boolean
  staffEmails: string[]
  statuses: Map<number, SectionStatus>
}) {
  const { hash } = useLocation()
  /** Null while they load. */
  const [requests, setRequests] = useState<AuditRequest[] | null>(null)
  const loaded = requests !== null
  const [loadFailed, setLoadFailed] = useState(false)
  /** Why the last notification failed to go, shown above the requests, where the request offers to send it again. */
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState<AuditRequest | null>(null)
  const [replying, setReplying] = useState<AuditRequest | null>(null)
  const [commenting, setCommenting] = useState<Commenting | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('audit_requests')
      .select(SELECT)
      .eq('offering_id', offeringId)
      .order('sent_at', { ascending: false, nullsFirst: true })
      .overrideTypes<AuditRequest[], { merge: false }>()
    setLoadFailed(error !== null)
    setError(null)
    // A draft has no send time, so the user's draft comes first, then the latest sent.
    if (data) setRequests(data.map((request) => ({ ...request, items: request.items.toSorted((a, b) => a.section - b.section) })))
  }, [offeringId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (loaded && hash) document.getElementById(hash.slice(1))?.scrollIntoView()
  }, [loaded, hash])

  /** Makes a step again to send its notification, which is all it does to a request past that step. */
  async function retryNotification(request: AuditRequest) {
    setRetrying(request.id)
    const failure = await (request.state === 'sent' ? sendAuditRequest(supabase, request.id) : replyToAuditRequest(supabase, request.id)).then(
      () => null,
      (failure: unknown) => friendlyError(failure),
    )
    // load clears the error, so the failure shows once the list is fresh.
    await load()
    setError(failure)
    setRetrying(null)
  }

  /**
   * Runs a step, reloads, and returns the error message for its dialog, or null to close it. A step
   * whose notification failed is made all the same, so its dialog closes, and the error shows above the
   * requests, where the request offers to send the notification again. A step whose notification
   * reached nobody says so, as its request does, since nobody knows of it until someone tells them.
   */
  async function step(run: () => Promise<StepResult>, success: string, unnoticed: string) {
    const outcome = await run().then(
      (result) => ({ result }),
      (failure: unknown) => ({ failure }),
    )
    await load()
    if (!('failure' in outcome)) {
      if (outcome.result.notified === 0) toast.warning(`${success}. ${unnoticed}`)
      else toast.success(success)
    } else if (outcome.failure instanceof AuditRequestError && outcome.failure.code === 'push_failed') setError(outcome.failure.message)
    else return friendlyError(outcome.failure)
    return null
  }

  if (loadFailed) {
    return (
      <Card className="py-0">
        <LoadError title="Couldn't load the audit requests" onRetry={load} />
      </Card>
    )
  }
  if (!error && (!requests || requests.length === 0)) return null

  return (
    <section aria-label="Audit requests" className="grid gap-3">
      <h2 className="text-lg font-semibold tracking-tight">Audit requests</h2>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      {requests?.map((request) => {
        const own = request.auditor_id === userId
        const canReply = isStaff && request.state === 'sent'
        /** Whether the user made the latest step, so it is theirs to pass on when its notification did not reach anyone. */
        const madeStep = (request.state === 'sent' && own) || (request.state === 'replied' && isStaff)
        const notice = !madeStep ? null : request.notification_pending ? (
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <BellOffIcon className="size-4 shrink-0" />
              {request.state === 'sent' ? 'The notification to the coordinator and lecturers has not gone yet.' : 'The notification to the auditor has not gone yet.'}
            </span>
            <Button variant="outline" size="sm" disabled={retrying === request.id} onClick={() => void retryNotification(request)}>
              {retrying === request.id ? <Spinner /> : <SendIcon />}
              Send the notification again
            </Button>
          </div>
        ) : request.notified_browsers === 0 ? (
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <BellOffIcon className="size-4 shrink-0" />
              {request.state === 'sent'
                ? 'Nobody was notified of this request. Tell the coordinator and lecturers it is waiting for them.'
                : `Nobody was notified of this reply. Tell ${request.auditor_name} it is ready.`}
            </span>
            <Button asChild variant="outline" size="sm">
              {request.state === 'sent' ? (
                <a href={mailto(staffEmails, `Audit request on the course file of ${courseCode}`)}>
                  <MailIcon />
                  Email them
                </a>
              ) : (
                <a href={mailto([request.auditor_email], `Reply to your audit request on the course file of ${courseCode}`)}>
                  <MailIcon />
                  Email {request.auditor_name}
                </a>
              )}
            </Button>
          </div>
        ) : null
        return (
          <Card
            key={request.id}
            id={`audit-request-${request.id}`}
            aria-label={request.state === 'draft' ? 'Your draft audit request' : `Audit request from ${request.auditor_name}`}
            className={cn('scroll-mt-20 gap-4 px-4 py-4 md:px-6', hash === `#audit-request-${request.id}` && 'ring-primary/50 ring-2')}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid min-w-0 gap-1">
                <h3 className="font-semibold">{request.state === 'draft' ? 'Your draft audit request' : `Audit request from ${request.auditor_name}`}</h3>
                <p className="text-muted-foreground text-sm">
                  {request.state === 'draft'
                    ? `${plural(request.items.length, 'section')} · Not sent yet`
                    : <>Sent <Time value={request.sent_at!} /></>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {request.state === 'draft' ? (
                  <Button onClick={() => setSending(request)}>
                    <SendIcon />
                    Send to staff
                  </Button>
                ) : (
                  <Badge variant={request.state === 'replied' ? 'secondary' : 'outline'}>{request.state === 'replied' ? 'Replied' : 'Waiting for reply'}</Badge>
                )}
              </div>
            </div>
            {notice}

            <ul className="grid gap-3">
              {request.items.map((item) => (
                <ChecklistItem
                  key={item.section}
                  offeringId={offeringId}
                  item={item}
                  draftStatus={request.state === 'draft' ? statuses.get(item.section) : undefined}
                  onComment={canReply ? () => setCommenting({ request, item }) : undefined}
                />
              ))}
            </ul>

            {canReply && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {/* Until every section is answered the button stays focusable, and says why it does nothing. */}
                <Button
                  aria-disabled={!request.checklist_complete}
                  aria-describedby={`answered-${request.id}`}
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  onClick={() => request.checklist_complete && setReplying(request)}
                >
                  <ReplyIcon />
                  Reply to auditor
                </Button>
                <span id={`answered-${request.id}`} className="text-muted-foreground text-sm tabular-nums">
                  {request.items.filter((item) => item.ticked || item.comment).length} of {request.items.length} answered
                </span>
              </div>
            )}
            {request.state === 'replied' && (
              <div className="bg-muted/50 grid gap-1 rounded-lg border px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  Reply from {request.replier_name}, <Time value={request.replied_at!} />
                </span>
                <p className="whitespace-pre-wrap">{request.reply_message ?? 'No message.'}</p>
              </div>
            )}
          </Card>
        )
      })}

      {sending && (
        <ConfirmDialog
          title="Send this audit request?"
          description={
            PUSH_ADAPTER
              ? 'It waits for the coordinator and lecturers on their Home page, with your comments, and goes to each browser where they turned notifications on.'
              : 'It waits for the coordinator and lecturers on their Home page, with your comments. Notifications are off, so nobody is notified. Tell them it is waiting.'
          }
          confirmLabel="Send to staff"
          onClose={() => setSending(null)}
          onConfirm={() =>
            step(() => sendAuditRequest(supabase, sending.id), 'Sent to staff', 'Nobody was notified, so tell the coordinator and lecturers it is waiting.')
          }
        />
      )}

      {replying && (
        <FormDialog
          title="Reply to the auditor"
          description={
            PUSH_ADAPTER
              ? `Your reply waits for ${replying.auditor_name} on their Home page, and goes to each browser where they turned notifications on.`
              : `Your reply waits for ${replying.auditor_name} on their Home page. Notifications are off, so nobody is notified. Tell them it is ready.`
          }
          submitLabel="Send reply"
          onClose={() => setReplying(null)}
          onSubmit={(form) =>
            step(
              () => replyToAuditRequest(supabase, replying.id, String(form.get('message'))),
              'Reply sent',
              `Nobody was notified, so tell ${replying.auditor_name} it is ready.`,
            )
          }
        >
          <div className="grid gap-2">
            <Label htmlFor="reply-message">Message (optional)</Label>
            <Textarea id="reply-message" name="message" rows={4} />
          </div>
        </FormDialog>
      )}

      {commenting && (
        <FormDialog
          title={`Comment on ${sectionName(commenting.item.section)}`}
          description="Say why this section can't be fixed."
          submitLabel="Save comment"
          onClose={() => setCommenting(null)}
          onSubmit={async (form) => {
            const { error } = await supabase.rpc('comment_on_audit_item', {
              request_id: commenting.request.id,
              section: commenting.item.section,
              comment: String(form.get('comment')),
            })
            await load()
            if (error) return friendlyError(error)
            toast.success('Comment saved')
            return null
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="item-comment">Comment</Label>
            <Textarea id="item-comment" name="comment" rows={4} required defaultValue={commenting.item.comment ?? ''} />
          </div>
        </FormDialog>
      )}
    </section>
  )
}

/**
 * One flagged section: ticked, answered by a comment, or waiting. A draft's item shows the section's
 * status now instead, since a draft has no ticks. onComment is set for staff who may comment.
 */
function ChecklistItem({
  offeringId,
  item,
  draftStatus,
  onComment,
}: {
  offeringId: string
  item: RequestItem
  draftStatus: SectionStatus | undefined
  onComment?: () => void
}) {
  const name = sectionName(item.section)
  const [Icon, label, tone] = item.ticked
    ? [CircleCheckIcon, 'Ticked: it has a new file', 'text-success']
    : item.comment
      ? [MessageSquareIcon, 'Answered with a comment', 'text-foreground']
      : [CircleIcon, 'Not answered yet', 'text-muted-foreground']
  return (
    <li className={cn('grid gap-x-3 gap-y-1', !draftStatus && 'grid-cols-[1.25rem_1fr]')}>
      {!draftStatus && <Icon aria-hidden="true" className={cn('mt-0.5 size-5', tone)} />}
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {SECTIONS_WITH_PAGES.has(item.section) ? (
            <Link to={`/course-files/${offeringId}/sections/${item.section}`} className="font-medium hover:underline">
              {name}
            </Link>
          ) : (
            <span className="font-medium">{name}</span>
          )}
          {draftStatus ? <SectionStatusBadge status={draftStatus} /> : <span className="text-muted-foreground text-xs">{label}</span>}
        </div>
        <p className="text-sm whitespace-pre-wrap">{item.verdict.comment}</p>
        {item.comment && (
          <p className="text-muted-foreground border-l-2 pl-3 text-sm whitespace-pre-wrap">
            {item.commenter_name}: {item.comment}
          </p>
        )}
        {onComment && (
          <div className="flex flex-wrap gap-2">
            {!item.ticked && SECTIONS_WITH_PAGES.has(item.section) && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/course-files/${offeringId}/sections/${item.section}`}>
                  <UploadIcon />
                  Upload fix
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onComment}>
              <MessageSquareIcon />
              {item.comment ? 'Edit comment' : 'Comment'}
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}
