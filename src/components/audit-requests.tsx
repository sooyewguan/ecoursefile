import { CircleCheckIcon, CircleIcon, MailWarningIcon, MessageSquareIcon, ReplyIcon, SendIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ConfirmDialog, FormDialog } from '@/components/action-dialogs'
import { ErrorAlert } from '@/components/notice'
import { SectionStatusBadge } from '@/components/section-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { cn, plural } from '@/lib/utils'
import { AuditRequestError, replyToAuditRequest, sendAuditRequest, type AuditRequestState } from '../audit-requests.ts'
import { SECTIONS, SECTIONS_WITH_PAGES, type SectionStatus } from '../sections.ts'
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
  sent_at: string | null
  replied_at: string | null
  replier_name: string | null
  reply_message: string | null
  checklist_complete: boolean
  email_pending: boolean
  items: RequestItem[]
}

const SELECT =
  'id, state, auditor_id, auditor_name, sent_at, replied_at, replier_name, reply_message, checklist_complete, email_pending, items:audit_request_items(section, ticked, comment, commenter_name, verdict:section_verdicts(comment))'

/** An item that staff are commenting on. */
type Commenting = { request: AuditRequest; item: RequestItem }

/**
 * The audit requests of a course file that the user reads: an auditor's own draft, which they
 * send, and every sent request, whose flagged sections are a checklist for the offering's staff.
 * isStaff is whether the user is the coordinator or a lecturer of the offering, who comment on
 * items and reply. statuses is each section's status, which a draft shows beside its sections.
 */
export function AuditRequests({ offeringId, userId, isStaff, statuses }: { offeringId: string; userId: string | null; isStaff: boolean; statuses: Map<number, SectionStatus> }) {
  /** Null while they load. */
  const [requests, setRequests] = useState<AuditRequest[] | null>(null)
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
    setError(error?.message ?? null)
    // A draft has no send time, so the user's draft comes first, then the latest sent.
    if (data) setRequests(data.map((request) => ({ ...request, items: request.items.toSorted((a, b) => a.section - b.section) })))
  }, [offeringId])

  useEffect(() => {
    void load()
  }, [load])

  /** Makes a step again to send its email, which is all it does to a request past that step. */
  async function retryEmail(request: AuditRequest) {
    setRetrying(request.id)
    const failure = await (request.state === 'sent' ? sendAuditRequest(supabase, request.id) : replyToAuditRequest(supabase, request.id)).then(
      () => null,
      (failure: unknown) => (failure instanceof Error ? failure.message : String(failure)),
    )
    // load clears the error, so the failure shows once the list is fresh.
    await load()
    setError(failure)
    setRetrying(null)
  }

  /**
   * Runs a step, reloads, and returns the error message for its dialog, or null to close it. A step
   * whose email failed is made all the same, so its dialog closes, and the error shows above the
   * requests, where the request offers to send the email again.
   */
  async function step(run: () => Promise<unknown>) {
    const failure = await run().then(
      () => null,
      (failure: unknown) => failure,
    )
    await load()
    if (failure instanceof AuditRequestError && failure.code === 'mail_failed') setError(failure.message)
    else if (failure) return failure instanceof Error ? failure.message : String(failure)
    return null
  }

  if (!error && (!requests || requests.length === 0)) return null

  return (
    <section aria-label="Audit requests" className="grid gap-3">
      <h2 className="text-lg font-semibold tracking-tight">Audit requests</h2>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      {requests?.map((request) => {
        const own = request.auditor_id === userId
        const canReply = isStaff && request.state === 'sent'
        const retry =
          request.email_pending && ((request.state === 'sent' && own) || (request.state === 'replied' && isStaff)) ? (
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span className="flex items-center gap-2">
                <MailWarningIcon className="size-4 shrink-0" />
                {request.state === 'sent' ? 'The email to the coordinator and lecturers has not gone yet.' : 'The email to the auditor has not gone yet.'}
              </span>
              <Button variant="outline" size="sm" disabled={retrying === request.id} onClick={() => void retryEmail(request)}>
                {retrying === request.id ? <Spinner /> : <SendIcon />}
                Send the email again
              </Button>
            </div>
          ) : null
        return (
          <Card key={request.id} aria-label={request.state === 'draft' ? 'Your draft audit request' : `Audit request from ${request.auditor_name}`} className="gap-4 px-4 py-4 md:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid min-w-0 gap-1">
                <h3 className="font-semibold">{request.state === 'draft' ? 'Your draft audit request' : `Audit request from ${request.auditor_name}`}</h3>
                <p className="text-muted-foreground text-sm">
                  {request.state === 'draft'
                    ? `${plural(request.items.length, 'section')} marked Needs fix. Staff see it, and get one email that lists them, once you send it.`
                    : `Sent ${new Date(request.sent_at!).toLocaleString()}`}
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
            {retry}

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
                <Button disabled={!request.checklist_complete} onClick={() => setReplying(request)}>
                  <ReplyIcon />
                  Reply to auditor
                </Button>
                {!request.checklist_complete && (
                  <span className="text-muted-foreground text-sm">A section ticks itself when it gets a new file. Comment on any you cannot fix, then reply.</span>
                )}
              </div>
            )}
            {request.state === 'replied' && (
              <div className="bg-muted/50 grid gap-1 rounded-lg border px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  Reply from {request.replier_name}, {new Date(request.replied_at!).toLocaleString()}
                </span>
                <p className="whitespace-pre-wrap wrap-anywhere">{request.reply_message ?? 'No message.'}</p>
              </div>
            )}
          </Card>
        )
      })}

      {sending && (
        <ConfirmDialog
          title="Send this audit request?"
          description={`The coordinator and lecturers get one email that lists ${sending.items.length === 1 ? 'this section' : `these ${sending.items.length} sections`} with your comments. A Needs fix you mark after this goes into a new request.`}
          confirmLabel="Send to staff"
          onClose={() => setSending(null)}
          onConfirm={() => step(() => sendAuditRequest(supabase, sending.id))}
        />
      )}

      {replying && (
        <FormDialog
          title="Reply to the auditor"
          description={`${replying.auditor_name} gets an email with your message and how each section was answered.`}
          submitLabel="Send reply"
          onClose={() => setReplying(null)}
          onSubmit={(form) => step(() => replyToAuditRequest(supabase, replying.id, String(form.get('message'))))}
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
          description="Say why this section cannot be fixed. The auditor sees your comment, and the item counts as answered."
          submitLabel="Save comment"
          onClose={() => setCommenting(null)}
          onSubmit={async (form) => {
            const { error } = await supabase.rpc('comment_on_audit_item', {
              request_id: commenting.request.id,
              section: commenting.item.section,
              comment: String(form.get('comment')),
            })
            await load()
            return error?.message ?? null
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
    ? [CircleCheckIcon, 'Ticked: it has a new file', 'text-emerald-600 dark:text-emerald-400']
    : item.comment
      ? [MessageSquareIcon, 'Answered with a comment', 'text-foreground']
      : [CircleIcon, 'Not answered yet', 'text-muted-foreground']
  return (
    <li className={cn('grid gap-x-3 gap-y-1', !draftStatus && 'grid-cols-[1.25rem_1fr]')}>
      {!draftStatus && <Icon aria-label={label} className={cn('mt-0.5 size-5', tone)} />}
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
        <p className="text-sm whitespace-pre-wrap wrap-anywhere">{item.verdict.comment}</p>
        {item.comment && (
          <p className="text-muted-foreground border-l-2 pl-3 text-sm whitespace-pre-wrap wrap-anywhere">
            {item.commenter_name}: {item.comment}
          </p>
        )}
        {onComment && (
          <div>
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

function sectionName(section: number) {
  return `${section} ${SECTIONS.find((s) => s.number === section)!.title}`
}
