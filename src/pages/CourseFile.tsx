import { ArrowLeftIcon, CircleAlertIcon, CircleCheckIcon, FileDownIcon, FolderOpenIcon, MousePointerClickIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Outlet, useLocation, useMatch, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { ActivityLog } from '@/components/activity-log'
import { AuditRequests } from '@/components/audit-requests'
import type { CourseFileOutlet } from '@/components/course-file-outlet'
import { EmptyState, LoadError, NotFound, PageActions, PageHeader, TableCard, TableSkeleton } from '@/components/page'
import { SectionStatusBadge } from '@/components/section-status'
import { useSectionSwitch } from '@/components/section-switch'
import { VerdictDialog } from '@/components/section-verdict'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useAuth } from '../auth-provider.tsx'
import { cachedFile } from '../file-cache.ts'
import { courseFileProgress } from '../progress.ts'
import { saveFile } from '../save-file.ts'
import { SECTIONS, SECTIONS_WITH_PAGES, SWITCHABLE_SECTIONS, type SectionStatus, type Verdict } from '../sections.ts'
import { supabase } from '../supabase.ts'
import { compileManifest } from '../uploads.ts'

type Offering = {
  semester_id: string
  semester: { code: string }
  coordinator_id: string
  course: { code: string; title: string; department: { code: string; name: string } }
  /** The switchable sections that are on. */
  sections_on: number[]
  /** The reason for each switchable section whose setting differs from the course type, by section number. */
  section_reasons: Record<string, string>
  /** Every lecturer of the offering, the coordinator included, with their name and email. */
  lecturers: { lecturer_id: string; lecturer_name: string; lecturer_email: string }[]
}

/** The page's data. An offering of null means it does not exist or the user may not read it. */
type PageData = { offering: Offering | null; statuses: { section: number; status: SectionStatus; counts_toward_completeness: boolean }[] }

/** How far the compiled PDF has got: files is null until the manifest arrives, then the count of files and how many are downloaded. */
type Compiling = { files: { done: number; total: number } | null }

const SWITCHABLE: ReadonlySet<number> = new Set(SWITCHABLE_SECTIONS.map((section) => section.number))

/** The right column of a course file before any section is open. A phone shows only the list then. */
export function NoSectionChosen() {
  return <EmptyState icon={MousePointerClickIcon} title="No section open" description="Pick a section from the list to see its files and review." />
}

/**
 * One offering's course file. The Sections tab has its audit requests and its 19 sections in the
 * fixed order, each with its status, and how many are uploaded. A section opens in the column beside
 * the list, at its own address, and the list marks it. A phone shows the list or the open section. The coordinator and lecturers switch
 * sections 10 to 16 on or off, with a reason when the setting differs from the course type. The
 * Activity tab, at ?tab=activity, has its activity log. Everyone who reads it downloads it as one
 * compiled PDF.
 */
export function CourseFile() {
  const { offeringId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'activity' ? 'activity' : 'sections'
  const { pathname } = useLocation()
  /** The section open in the right column, or null when none is. */
  const sectionMatch = useMatch('/course-files/:offeringId/sections/:section')
  const openSection = sectionMatch ? Number(sectionMatch.params.section) : null
  const auth = useAuth()
  const [data, setData] = useState<PageData | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [compiling, setCompiling] = useState<Compiling | null>(null)
  /** The verdict an auditor is recording from the section table. */
  const [recording, setRecording] = useState<{ section: number; title: string; verdict: Verdict } | null>(null)
  /** Goes up with each verdict recorded here, so the audit requests load the auditor's draft again. */
  const [revision, setRevision] = useState(0)

  const reload = useCallback(async () => {
    const [offering, statuses] = await Promise.all([
      supabase
        .from('offerings')
        .select(
          'semester_id, semester:semesters(code), coordinator_id, course:courses(code, title, department:departments(code, name)), sections_on, section_reasons, lecturers:offering_lecturers!offering_lecturers_offering_id_fkey(lecturer_id, lecturer_name, lecturer_email)',
        )
        .eq('id', offeringId!)
        .maybeSingle()
        .overrideTypes<Offering | null, { merge: false }>(),
      supabase.rpc('section_statuses', { offering_id: offeringId }),
    ])
    setLoadFailed(Boolean(offering.error || statuses.error))
    if (!offering.error && !statuses.error) setData({ offering: offering.data, statuses: statuses.data })
  }, [offeringId])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Kept the same between renders, so an open section does not load again each time the list does. */
  const outlet = useMemo<CourseFileOutlet>(() => ({ refresh: reload }), [reload])

  const { request: requestSwitch, switching, dialog: switchDialog } = useSectionSwitch(offeringId!, reload)

  /** The course files of the course file's semester, which the user most likely came from. */
  const courseFiles = data?.offering ? `/course-files?semester=${data.offering.semester_id}` : '/course-files'
  const backLink = (
    <Button asChild variant="outline">
      <Link to={courseFiles}>
        <ArrowLeftIcon />
        All course files
      </Link>
    </Button>
  )

  if (loadFailed) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Course file" action={backLink} />
        <Card className="py-0">
          <LoadError title="Couldn't load this course file" onRetry={reload} />
        </Card>
      </div>
    )
  }

  if (data && !data.offering) {
    return <NotFound icon={FolderOpenIcon} title="Course file not found" backTo="/course-files" backLabel="All course files" />
  }

  const offering = data?.offering
  const sectionTitle = new Map<number, string>(SECTIONS.map((section) => [section.number, section.title]))
  const userId = auth.kind === 'ready' ? auth.profile.id : null
  const canSwitch = offering?.lecturers.some((lecturer) => lecturer.lecturer_id === userId) ?? false
  const isAuditor = auth.kind === 'ready' && auth.roles.includes('auditor')
  /** The list's columns: number, section with its status, the switch for staff, and an auditor's verdict buttons. */
  const columns = ['', '', ...(canSwitch ? [''] : []), ...(isAuditor ? [''] : [])]
  const progress = data && courseFileProgress(data.statuses)

  /**
   * Compiles the course file into one PDF in the browser and saves it under fileName. pdf-lib loads
   * only now. The files come one at a time as the PDF takes them, from the browser's copy of a file
   * opened before or else downloaded, and the button counts them.
   */
  async function downloadCompiledPdf(fileName: string) {
    setCompiling({ files: null })
    try {
      const [manifest, { compile }] = await Promise.all([compileManifest(supabase, offeringId!), import('../pdf/compile.ts')])
      const total = manifest.sections.reduce((count, section) => count + section.files.length, 0)
      let done = 0
      setCompiling({ files: { done, total } })
      const bytes = await compile(manifest, async (file) => {
        const blob = await cachedFile(file.id, async () => {
          const response = await fetch(file.url)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return new Blob([await response.arrayBuffer()], { type: 'application/pdf' })
        })
        setCompiling({ files: { done: ++done, total } })
        return new Uint8Array(await blob.arrayBuffer())
      })
      saveFile(new Blob([bytes], { type: 'application/pdf' }), fileName)
    } catch {
      toast.error("Couldn't compile the PDF. Try again.")
    } finally {
      setCompiling(null)
    }
  }

  return (
    <div className="grid gap-6">
      {offering ? (
        <PageHeader
          title={`${offering.course.code} ${offering.course.title}`}
          areaTo={courseFiles}
          namesPage={openSection === null}
          description={
            <>
              <span className="block">
                {offering.semester.code} · {offering.course.department.code} {offering.course.department.name}
              </span>
              <StaffLine coordinatorId={offering.coordinator_id} lecturers={offering.lecturers} />
            </>
          }
          action={
            <PageActions>
              {backLink}
              <Button disabled={compiling !== null} onClick={() => void downloadCompiledPdf(`${offering.course.code} ${offering.semester.code.replace('/', '-')}.pdf`)}>
                {compiling ? <Spinner /> : <FileDownIcon />}
                <span aria-live="polite">
                  {!compiling ? 'Download compiled PDF' : compiling.files ? `Compiling ${compiling.files.done}/${compiling.files.total}…` : 'Compiling…'}
                </span>
              </Button>
            </PageActions>
          }
        />
      ) : (
        <div aria-hidden="true" className="grid gap-2">
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="h-5 w-56 max-w-full" />
        </div>
      )}
      <Tabs value={tab} onValueChange={(value) => setSearchParams(value === 'activity' ? { tab: value } : {}, { replace: true })} className="gap-6">
        <TabsList>
          <TabsTrigger value="sections">Sections</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="sections" className="grid gap-6">
          {data && (
            <AuditRequests
              offeringId={offeringId!}
              courseCode={offering!.course.code}
              userId={userId}
              isStaff={canSwitch}
              staffEmails={offering!.lecturers.map((lecturer) => lecturer.lecturer_email)}
              statuses={new Map(data.statuses.map(({ section, status }) => [section, status]))}
              switchedOff={
                new Map(
                  SWITCHABLE_SECTIONS.filter((section) => !offering!.sections_on.includes(section.number)).map((section) => [
                    section.number,
                    offering!.section_reasons[section.number],
                  ]),
                )
              }
              onSwitchOn={(section) =>
                void requestSwitch({ section, title: sectionTitle.get(section)!, isOn: true, reason: offering!.section_reasons[section] })
              }
              revision={revision}
            />
          )}

          <section aria-labelledby="sections-heading" className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="sections-heading" className="text-lg font-semibold tracking-tight">
                Sections
              </h2>
              {progress ? (
                <p className="text-muted-foreground text-sm tabular-nums">
                  {progress.uploaded} of {progress.counted} uploaded
                  {progress.needsFix > 0 && ` · ${progress.needsFix} need${progress.needsFix === 1 ? 's' : ''} fix`}
                </p>
              ) : (
                <Skeleton className="h-5 w-40" />
              )}
            </div>
            <TableCard>
              <div className="grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                <div className={cn('lg:border-r', openSection !== null && 'max-lg:hidden')}>
                  <Table aria-labelledby="sections-heading">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 pr-0 pl-3 text-right">#</TableHead>
                        <TableHead className="px-3">Section</TableHead>
                        {canSwitch && <TableHead className="w-14 px-3">On</TableHead>}
                        {isAuditor && <TableHead className="w-20 px-3 text-right">Review</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!data ? (
                        <TableSkeleton columns={columns} rows={19} />
                      ) : (
                        data.statuses.map(({ section, status }) => {
                          const title = sectionTitle.get(section)!
                          const reason = offering?.section_reasons[section]
                          const isOn = offering?.sections_on.includes(section) ?? false
                          const isOpen = section === openSection
                          return (
                            <TableRow key={section} data-state={isOpen ? 'selected' : undefined} className="relative">
                              <TableCell className="text-muted-foreground py-3 pr-0 pl-3 align-top text-right tabular-nums">{section}</TableCell>
                              <TableCell className="px-3 py-3 whitespace-normal">
                                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                                  {SECTIONS_WITH_PAGES.has(section) ? (
                                    <Link
                                      to={`/course-files/${offeringId}/sections/${section}`}
                                      aria-current={isOpen ? 'page' : undefined}
                                      className="font-medium after:absolute after:inset-0 hover:underline"
                                    >
                                      {title}
                                    </Link>
                                  ) : (
                                    <span className="font-medium">{title}</span>
                                  )}
                                  <SectionStatusBadge status={status} />
                                </div>
                                {reason && (
                                  <p className="text-muted-foreground mt-0.5 text-sm">
                                    Switched {isOn ? 'on' : 'off'}: {reason}
                                  </p>
                                )}
                              </TableCell>
                              {canSwitch && (
                                <TableCell className="relative z-10 px-3 py-3 align-top">
                                  {SWITCHABLE.has(section) && (
                                    <Switch
                                      aria-label={`${title} on`}
                                      checked={isOn}
                                      disabled={switching !== null}
                                      onCheckedChange={(next) => void requestSwitch({ section, title, isOn: next, reason })}
                                    />
                                  )}
                                </TableCell>
                              )}
                              {isAuditor && (
                                <TableCell className="relative z-10 px-3 py-2 align-top">
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={`Mark ${title} verified`}
                                      title="Mark verified"
                                      onClick={() => setRecording({ section, title, verdict: 'verified' })}
                                    >
                                      <CircleCheckIcon className="text-emerald-600 dark:text-emerald-400" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={`Mark ${title} needs fix`}
                                      title="Mark needs fix"
                                      onClick={() => setRecording({ section, title, verdict: 'needs_fix' })}
                                    >
                                      <CircleAlertIcon className="text-amber-600 dark:text-amber-400" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          )
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className={cn('min-w-0 p-4 md:p-6', openSection === null && 'max-lg:hidden')}>
                  <Outlet key={pathname} context={outlet} />
                </div>
              </div>
            </TableCard>
          </section>
        </TabsContent>
        <TabsContent value="activity">
          <ActivityLog offeringId={offeringId!} />
        </TabsContent>
      </Tabs>

      {switchDialog}
      {recording && (
        <VerdictDialog
          offeringId={offeringId!}
          section={recording.section}
          sectionTitle={recording.title}
          verdict={recording.verdict}
          onClose={() => setRecording(null)}
          onRecorded={async () => {
            await reload()
            setRevision((count) => count + 1)
          }}
        />
      )}
    </div>
  )
}

/**
 * The course file's coordinator, then its other lecturers by name, each with their title and a link
 * that emails them, so whoever reads the course file can reach the people who keep it.
 */
function StaffLine({ coordinatorId, lecturers }: { coordinatorId: string; lecturers: Offering['lecturers'] }) {
  const coordinator = lecturers.find((lecturer) => lecturer.lecturer_id === coordinatorId)
  const others = lecturers.filter((lecturer) => lecturer !== coordinator).toSorted((a, b) => a.lecturer_name.localeCompare(b.lecturer_name))
  const person = (lecturer: Offering['lecturers'][number]) => (
    <a key={lecturer.lecturer_id} href={`mailto:${lecturer.lecturer_email}`} title={lecturer.lecturer_email} className="text-foreground underline-offset-4 hover:underline">
      {lecturer.lecturer_name}
    </a>
  )
  return (
    <span className="mt-1 block">
      {coordinator && <>Coordinator {person(coordinator)}</>}
      {coordinator && others.length > 0 && ' · '}
      {others.length > 0 && (
        <>
          {others.length === 1 ? 'Lecturer' : 'Lecturers'}{' '}
          {others.map((lecturer, index) => (
            <span key={lecturer.lecturer_id}>
              {index > 0 && ', '}
              {person(lecturer)}
            </span>
          ))}
        </>
      )}
    </span>
  )
}
