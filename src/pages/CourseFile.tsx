import { ArrowLeftIcon, FileDownIcon, FolderOpenIcon, PowerIcon, PowerOffIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog, FormDialog } from '@/components/action-dialogs'
import { ActivityLog } from '@/components/activity-log'
import { AuditRequests } from '@/components/audit-requests'
import { LoadError, NotFound, PageHeader, RowActions, TableSkeleton } from '@/components/page'
import { SectionStatusBadge } from '@/components/section-status'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useAuth } from '../auth-provider.tsx'
import { friendlyError } from '../errors.ts'
import { SECTIONS, SECTIONS_WITH_PAGES, SWITCHABLE_SECTIONS, type SectionStatus } from '../sections.ts'
import { supabase } from '../supabase.ts'
import { compileManifest } from '../uploads.ts'

type Offering = {
  semester: { code: string }
  course: { code: string; title: string; department: { code: string; name: string } }
  /** The switchable sections that are on. */
  sections_on: number[]
  /** The reason for each switchable section whose setting differs from the course type, by section number. */
  section_reasons: Record<string, string>
  lecturers: { lecturer_id: string }[]
}

/** The page's data. An offering of null means it does not exist or the user may not read it. */
type PageData = { offering: Offering | null; statuses: { section: number; status: SectionStatus }[] }

/**
 * A switch the user is about to make. A section without a reason has its course type setting, so
 * switching it needs a reason. A section with one goes back to the course type setting.
 */
type Switching = { section: number; title: string; isOn: boolean; reason: string | undefined }

/** How far the compiled PDF has got: files is null until the manifest arrives, then the count of files and how many are downloaded. */
type Compiling = { files: { done: number; total: number } | null }

const SWITCHABLE: ReadonlySet<number> = new Set(SWITCHABLE_SECTIONS.map((section) => section.number))

/** Below sm the status moves into the section cell, so a phone has room for the section's name. */
const WIDE = 'hidden sm:table-cell'

/**
 * One offering's course file. The Sections tab has its audit requests and its 19 sections in the
 * fixed order, each with its status. The coordinator and lecturers switch sections 10 to 16 on or
 * off, with a reason when the setting differs from the course type. The Activity tab, at ?tab=activity,
 * has its activity log. Everyone who reads it downloads it as one compiled PDF.
 */
export function CourseFile() {
  const { offeringId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'activity' ? 'activity' : 'sections'
  const auth = useAuth()
  const [data, setData] = useState<PageData | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [switching, setSwitching] = useState<Switching | null>(null)
  const [compiling, setCompiling] = useState<Compiling | null>(null)

  const reload = useCallback(async () => {
    const [offering, statuses] = await Promise.all([
      supabase
        .from('offerings')
        .select(
          'semester:semesters(code), course:courses(code, title, department:departments(code, name)), sections_on, section_reasons, lecturers:offering_lecturers!offering_lecturers_offering_id_fkey(lecturer_id)',
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

  const backLink = (
    <Button asChild variant="outline">
      <Link to="/course-files">
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
  /** The table's columns: number, section, status, and the row menu for staff who switch sections. */
  const columns = canSwitch ? ['', '', WIDE, ''] : ['', '', WIDE]

  /** Switches the section as the user chose, reloads the page, and returns the error message or null. */
  async function switchSection(target: Switching, reason?: string) {
    const { error } = await supabase.rpc('switch_section', {
      offering_id: offeringId,
      section: target.section,
      is_on: target.isOn,
      reason,
    })
    await reload()
    if (error) return friendlyError(error)
    toast.success(`Switched ${target.title} ${target.isOn ? 'on' : 'off'}`)
    return null
  }

  /**
   * Compiles the course file into one PDF in the browser and saves it under fileName. pdf-lib loads
   * only now. The files download one at a time as the PDF takes them, and the status line counts them.
   */
  async function downloadCompiledPdf(fileName: string) {
    setCompiling({ files: null })
    try {
      const [manifest, { compile }] = await Promise.all([compileManifest(supabase, offeringId!), import('../pdf/compile.ts')])
      const total = manifest.sections.reduce((count, section) => count + section.files.length, 0)
      let done = 0
      setCompiling({ files: { done, total } })
      const bytes = await compile(manifest, async (url) => {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = new Uint8Array(await response.arrayBuffer())
        setCompiling({ files: { done: ++done, total } })
        return body
      })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      link.download = fileName
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
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
          description={`${offering.semester.code} · ${offering.course.department.code} ${offering.course.department.name}`}
          action={
            <div className="flex flex-wrap gap-2">
              {backLink}
              <Button disabled={compiling !== null} onClick={() => void downloadCompiledPdf(`${offering.course.code} ${offering.semester.code.replace('/', '-')}.pdf`)}>
                {compiling ? <Spinner /> : <FileDownIcon />}
                Download compiled PDF
              </Button>
            </div>
          }
        />
      ) : (
        <div aria-hidden="true" className="grid gap-2">
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="h-5 w-56 max-w-full" />
        </div>
      )}
      {compiling && (
        <p role="status" className="text-sm">
          {compiling.files
            ? `Compiling the PDF: ${compiling.files.done} of ${compiling.files.total} files downloaded. Keep this page open.`
            : 'Getting the list of files…'}
        </p>
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
              userId={userId}
              isStaff={canSwitch}
              statuses={new Map(data.statuses.map(({ section, status }) => [section, status]))}
            />
          )}

          <Card className="gap-0 overflow-hidden py-0">
            <Table aria-label="Sections">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-12 px-4 text-right">#</TableHead>
                  <TableHead className="px-4">Section</TableHead>
                  <TableHead className={cn('w-32 px-4', WIDE)}>Status</TableHead>
                  {canSwitch && (
                    <TableHead className="w-14 px-4">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
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
                    return (
                      <TableRow key={section} className="relative">
                        <TableCell className="text-muted-foreground px-4 py-3 align-top text-right tabular-nums">{section}</TableCell>
                        <TableCell className="px-4 py-3 whitespace-normal">
                          {SECTIONS_WITH_PAGES.has(section) ? (
                            <Link
                              to={`/course-files/${offeringId}/sections/${section}`}
                              className="font-medium after:absolute after:inset-0 hover:underline"
                            >
                              {title}
                            </Link>
                          ) : (
                            <span className="font-medium">{title}</span>
                          )}
                          <div className="mt-1 sm:hidden">
                            <SectionStatusBadge status={status} />
                          </div>
                          {reason && (
                            <p className="text-muted-foreground mt-0.5 text-sm">
                              Switched {isOn ? 'on' : 'off'}: {reason}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className={cn('px-4 py-3 align-top', WIDE)}>
                          <SectionStatusBadge status={status} />
                        </TableCell>
                        {canSwitch && (
                          <TableCell className={cn('px-4 py-2 text-right align-top', SWITCHABLE.has(section) && 'relative z-10')}>
                            {SWITCHABLE.has(section) && (
                              <RowActions label={`Actions for ${title}`}>
                                <DropdownMenuItem onSelect={() => setSwitching({ section, title, isOn: !isOn, reason })}>
                                  {isOn ? <PowerOffIcon /> : <PowerIcon />}
                                  Switch {isOn ? 'off' : 'on'}
                                </DropdownMenuItem>
                              </RowActions>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
        <TabsContent value="activity">
          <ActivityLog offeringId={offeringId!} />
        </TabsContent>
      </Tabs>

      {switching && !switching.reason && (
        <FormDialog
          title={`Switch ${switching.title} ${switching.isOn ? 'on' : 'off'}`}
          submitLabel={`Switch ${switching.isOn ? 'on' : 'off'}`}
          onClose={() => setSwitching(null)}
          onSubmit={(form) => switchSection(switching, String(form.get('reason')))}
        >
          <div className="grid gap-2">
            <Label htmlFor="switch-reason">Reason</Label>
            <Input id="switch-reason" name="reason" autoComplete="off" required />
          </div>
        </FormDialog>
      )}

      {switching?.reason && (
        <ConfirmDialog
          title={`Switch ${switching.title} ${switching.isOn ? 'on' : 'off'}?`}
          description={`This clears the reason "${switching.reason}".`}
          confirmLabel={`Switch ${switching.isOn ? 'on' : 'off'}`}
          onConfirm={() => switchSection(switching)}
          onClose={() => setSwitching(null)}
        />
      )}
    </div>
  )
}
