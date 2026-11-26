import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FormDialog } from '@/components/action-dialogs'
import { LoadError } from '@/components/page'
import { SectionStatusBadge } from '@/components/section-status'
import { Time } from '@/components/time'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '../auth-provider.tsx'
import { friendlyError } from '../errors.ts'
import { ADMIN_FILE_SECTIONS, SECTION_STATUS_LABELS, type SectionStatus, type Verdict } from '../sections.ts'
import { supabase } from '../supabase.ts'

type LatestVerdict = { verdict: Verdict; comment: string | null; auditor_name: string; created_at: string }

/**
 * A section's review: its status, and the latest verdict on it with its auditor, time and comment,
 * and for auditors the buttons that record a new one. status is the section's status, null while it
 * loads. When it is neither the verdict nor Missing, the section changed after the verdict, and the
 * card says so. A verdict never hides Missing, so Missing says nothing about a change. onRecorded runs
 * after a verdict is recorded, so the page can read the section's new status.
 */
export function SectionVerdict({
  offeringId,
  section,
  sectionTitle,
  status,
  onRecorded,
}: {
  offeringId: string
  section: number
  sectionTitle: string
  status: SectionStatus | null
  onRecorded: () => Promise<void>
}) {
  const auth = useAuth()
  const isAuditor = auth.kind === 'ready' && auth.roles.includes('auditor')
  /** Undefined while it loads, and null when the section has no verdict. */
  const [latest, setLatest] = useState<LatestVerdict | null | undefined>(undefined)
  const [loadFailed, setLoadFailed] = useState(false)
  const [recording, setRecording] = useState<Verdict | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('section_verdicts')
      .select('verdict, comment, auditor_name, created_at')
      .eq('offering_id', offeringId)
      .eq('section', section)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
      .overrideTypes<LatestVerdict | null, { merge: false }>()
    setLoadFailed(error !== null)
    setLatest(error ? null : data)
  }, [offeringId, section])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card aria-labelledby="review-heading" className="gap-3 px-4 py-4 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1.5">
          <h2 id="review-heading" className="font-semibold">
            Review
          </h2>
          {latest === undefined || !status ? (
            <Skeleton className="h-5 w-64 max-w-full" />
          ) : (
            <>
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <SectionStatusBadge status={status} adminUploads={ADMIN_FILE_SECTIONS.has(section)} />
                {latest ? (
                  <span>
                    {status !== latest.verdict && `${SECTION_STATUS_LABELS[latest.verdict]} by `}
                    {latest.auditor_name}, <Time value={latest.created_at} />
                    {status !== latest.verdict && status !== 'missing' && ', before the latest change'}
                  </span>
                ) : (
                  !loadFailed && <span>Not reviewed yet</span>
                )}
              </div>
              {latest?.comment && <p className="text-sm whitespace-pre-wrap">{latest.comment}</p>}
            </>
          )}
        </div>
        {isAuditor && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setRecording('verified')}>
              <CircleCheckIcon />
              Mark verified
            </Button>
            <Button variant="outline" onClick={() => setRecording('needs_fix')}>
              <CircleAlertIcon />
              Mark needs fix
            </Button>
          </div>
        )}
      </div>
      {loadFailed && <LoadError title="Couldn't load the review" onRetry={load} />}

      {recording && (
        <VerdictDialog
          offeringId={offeringId}
          section={section}
          sectionTitle={sectionTitle}
          verdict={recording}
          onClose={() => setRecording(null)}
          onRecorded={() => Promise.all([load(), onRecorded()])}
        />
      )}
    </Card>
  )
}

/**
 * Asks an auditor for the comment on a verdict and records it: a Needs fix needs one, and goes into
 * their draft audit request, and a Verified takes one if they like. onRecorded runs once the verdict
 * is recorded, so the page can show it, before the dialog closes.
 */
export function VerdictDialog({
  offeringId,
  section,
  sectionTitle,
  verdict,
  onClose,
  onRecorded,
}: {
  offeringId: string
  section: number
  sectionTitle: string
  verdict: Verdict
  onClose: () => void
  onRecorded: () => Promise<unknown>
}) {
  async function record(comment: string) {
    const { error } = await supabase.rpc('record_verdict', { offering_id: offeringId, section, verdict, comment })
    if (error) return friendlyError(error)
    await onRecorded()
    toast.success(verdict === 'verified' ? `Marked ${sectionTitle} verified` : `Marked ${sectionTitle} needs fix`)
    return null
  }

  return (
    <FormDialog
      title={`Mark ${sectionTitle} ${verdict === 'verified' ? 'verified' : 'needs fix'}`}
      description={verdict === 'needs_fix' ? 'It goes into your draft audit request.' : undefined}
      submitLabel={verdict === 'verified' ? 'Mark verified' : 'Mark needs fix'}
      onClose={onClose}
      onSubmit={(form) => record(String(form.get('comment')))}
    >
      <div className="grid gap-2">
        <Label htmlFor="verdict-comment">{verdict === 'verified' ? 'Comment (optional)' : 'Comment'}</Label>
        <Textarea id="verdict-comment" name="comment" rows={4} required={verdict === 'needs_fix'} />
      </div>
    </FormDialog>
  )
}
