import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { FormDialog } from '@/components/action-dialogs'
import { ErrorAlert } from '@/components/notice'
import { SectionStatusBadge } from '@/components/section-status'
import { Time } from '@/components/time'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '../auth-provider.tsx'
import type { SectionStatus, Verdict } from '../sections.ts'
import { supabase } from '../supabase.ts'

type LatestVerdict = { verdict: Verdict; comment: string | null; auditor_name: string; created_at: string }

/**
 * The latest verdict on a section of a course file, with its auditor, time and comment, and for
 * auditors the buttons that record a new one. Staff see it only once there is one. status is the
 * section's status. When it is neither the verdict nor Missing, the section changed after the
 * verdict, and the card says so. A verdict never hides Missing, so Missing says nothing about a
 * change. onRecorded runs after a verdict is recorded, so the page can read the section's new status.
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
  const [error, setError] = useState<string | null>(null)
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
    setError(error?.message ?? null)
    setLatest(error ? null : data)
  }, [offeringId, section])

  useEffect(() => {
    void load()
  }, [load])

  async function record(verdict: Verdict, comment: string) {
    const { error } = await supabase.rpc('record_verdict', { offering_id: offeringId, section, verdict, comment })
    if (error) return error.message
    await Promise.all([load(), onRecorded()])
    return null
  }

  if (!isAuditor && !latest && !error) return null

  return (
    <Card aria-label="Auditor verdict" className="gap-3 px-4 py-4 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1.5">
          <h2 className="text-sm font-semibold">Auditor verdict</h2>
          {latest === undefined ? (
            <Skeleton className="h-5 w-64 max-w-full" />
          ) : latest ? (
            <>
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <SectionStatusBadge status={latest.verdict} />
                <span>
                  {latest.auditor_name}, <Time value={latest.created_at} />
                </span>
                {status && status !== latest.verdict && status !== 'missing' && <span>Given before the latest change to this section</span>}
              </div>
              {latest.comment && <p className="text-sm whitespace-pre-wrap">{latest.comment}</p>}
            </>
          ) : (
            !error && <p className="text-muted-foreground text-sm">No verdict yet.</p>
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
      {error && <ErrorAlert>{error}</ErrorAlert>}

      {recording && (
        <FormDialog
          title={recording === 'verified' ? `Mark ${sectionTitle} verified` : `${sectionTitle} needs fix`}
          description={
            recording === 'verified'
              ? 'The section shows as Verified until its files change. Staff see your comment on this page.'
              : 'Say what the coordinator and lecturers must fix. They see your comment on this page. The section goes into your draft audit request, which emails them once you send it from the course file page.'
          }
          submitLabel={recording === 'verified' ? 'Mark verified' : 'Mark needs fix'}
          onClose={() => setRecording(null)}
          onSubmit={(form) => record(recording, String(form.get('comment')))}
        >
          <div className="grid gap-2">
            <Label htmlFor="verdict-comment">{recording === 'verified' ? 'Comment (optional)' : 'Comment'}</Label>
            <Textarea id="verdict-comment" name="comment" rows={4} required={recording === 'needs_fix'} />
          </div>
        </FormDialog>
      )}
    </Card>
  )
}
