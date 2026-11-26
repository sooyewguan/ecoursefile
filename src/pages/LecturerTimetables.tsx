import { ArrowLeftIcon, FileTextIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { DeleteSharedFileDialog, type LinkedSharedFile } from '@/components/delete-shared-file-dialog'
import { FileLink, FileMenuItems } from '@/components/file-link'
import { LoadError, NotFound, PageActions, PageHeader, RowActions, TableCard, TableSkeleton } from '@/components/page'
import { SectionPager } from '@/components/section-pager'
import { SectionStatusBadge } from '@/components/section-status'
import { SectionVerdict } from '@/components/section-verdict'
import { Time } from '@/components/time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatSize } from '../format.ts'
import { useAuth } from '../auth-provider.tsx'
import { friendlyError } from '../errors.ts'
import { LECTURER_FILE_SECTION, type SectionStatus } from '../sections.ts'
import { supabase } from '../supabase.ts'
import { uploadFile } from '../uploads.ts'

const SECTION = LECTURER_FILE_SECTION

/** A lecturer's timetable for the semester, and the offerings whose course files link it. */
type Timetable = LinkedSharedFile & { lecturer_id: string; size: number; uploaded_at: string }

type Offering = {
  semester_id: string
  coordinator_id: string
  semester: { code: string }
  course: { code: string; title: string }
  /** Every lecturer of the offering, the coordinator included. */
  lecturers: { lecturer_id: string; lecturer_name: string }[]
  /** The timetables of the offering's lecturers. */
  linked_files: Timetable[]
}

/** The page's data. An offering of null means it does not exist or the user may not read it. */
type PageData = { offering: Offering | null; status: SectionStatus | null }

/** Below md the upload time moves into the timetable cell, and below sm the timetable into the lecturer cell, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'
const SMALL = 'hidden sm:table-cell'

/** The table's columns: lecturer, timetable, uploaded, and the row menu of each timetable. */
const COLUMNS = ['', SMALL, WIDE, '']

/**
 * Section 4 of a course file: one row per lecturer of the offering, the coordinator first, with
 * the timetable they uploaded for the semester. Each lecturer uploads and deletes only their own.
 * It shows in every course file they teach in the semester, and the section is Missing until every
 * lecturer of the offering has one.
 */
export function LecturerTimetables() {
  const offeringId = useParams().offeringId!
  const auth = useAuth()
  const userId = auth.kind === 'ready' ? auth.profile.id : null
  const [data, setData] = useState<PageData | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<Timetable | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    const [offering, statuses] = await Promise.all([
      supabase
        .from('offerings')
        .select(
          'semester_id, coordinator_id, semester:semesters(code), course:courses(code, title), lecturers:offering_lecturers!offering_lecturers_offering_id_fkey(lecturer_id, lecturer_name), linked_files(id, lecturer_id, name, size, uploaded_at, linked_offerings(id, course:courses(code, title)))',
        )
        .eq('id', offeringId)
        .eq('linked_files.section', SECTION.number)
        .maybeSingle()
        .overrideTypes<Offering | null, { merge: false }>(),
      supabase.rpc('section_statuses', { offering_id: offeringId }),
    ])
    const failed = Boolean(offering.error ?? statuses.error)
    setLoadFailed(failed)
    if (failed) return
    const status = (statuses.data as { section: number; status: SectionStatus }[]).find((row) => row.section === SECTION.number)
    setData({ offering: offering.data, status: status?.status ?? null })
  }, [offeringId])

  useEffect(() => {
    void reload()
  }, [reload])

  const backLink = (
    <Button asChild variant="outline">
      <Link to={`/course-files/${offeringId}`}>
        <ArrowLeftIcon />
        Course file
      </Link>
    </Button>
  )

  if (data && !data.offering) {
    return <NotFound icon={FileTextIcon} title="Section not found" backTo="/course-files" backLabel="All course files" />
  }

  if (loadFailed) {
    return (
      <div className="grid gap-6">
        <PageHeader title={SECTION.title} action={backLink} />
        <Card className="py-0">
          <LoadError title="Couldn't load the timetables" onRetry={reload} />
        </Card>
      </div>
    )
  }

  const offering = data?.offering
  const isCoordinator = (lecturerId: string) => lecturerId === offering?.coordinator_id
  const lecturers = (offering?.lecturers ?? []).toSorted(
    (a, b) => Number(isCoordinator(b.lecturer_id)) - Number(isCoordinator(a.lecturer_id)) || a.lecturer_name.localeCompare(b.lecturer_name),
  )
  /** Whether the user teaches the offering and has no timetable for its semester yet. */
  const canUpload =
    lecturers.some((lecturer) => lecturer.lecturer_id === userId) && !offering?.linked_files.some((file) => file.lecturer_id === userId)

  /** Uploads the picked PDF as the user's timetable for the semester, then reports the outcome. */
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !offering) return
    setUploading(true)
    try {
      await uploadFile(supabase, { semesterId: offering.semester_id, section: SECTION.number }, file)
      await reload()
      toast.success('Uploaded your timetable')
    } catch (error) {
      await reload()
      toast.error(friendlyError(error))
    }
    setUploading(false)
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={SECTION.title}
        parent={offering && { title: `${offering.course.code} ${offering.course.title}`, to: `/course-files/${offeringId}` }}
        areaTo={offering && `/course-files?semester=${offering.semester_id}`}
        description={
          offering ? `Section ${SECTION.number} · ${offering.course.code} ${offering.course.title} · ${offering.semester.code}` : `Section ${SECTION.number}`
        }
        action={
          <PageActions>
            {backLink}
            {canUpload && (
              <Button onClick={() => picker.current?.click()} disabled={uploading}>
                {uploading ? <Spinner /> : <UploadIcon />}
                Upload your timetable
              </Button>
            )}
          </PageActions>
        }
      />
      <input ref={picker} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void upload(event)} />

      <TableCard>
        <Table aria-label="Lecturer timetables">
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Lecturer</TableHead>
              <TableHead className={cn('px-4', SMALL)}>Timetable</TableHead>
              <TableHead className={cn('w-48 px-4', WIDE)}>Uploaded</TableHead>
              <TableHead className="w-14 px-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!offering ? (
              <TableSkeleton columns={COLUMNS} />
            ) : (
              lecturers.map((lecturer) => {
                const timetable = offering.linked_files.find((file) => file.lecturer_id === lecturer.lecturer_id)
                const uploadedAt = timetable && <Time value={timetable.uploaded_at} />
                const isOwn = lecturer.lecturer_id === userId
                const file = timetable ? (
                  <div className="grid gap-0.5">
                    <FileLink file={timetable} />
                    <span className="text-muted-foreground text-xs">
                      {formatSize(timetable.size)}
                      <span className="md:hidden"> · {uploadedAt}</span>
                    </span>
                  </div>
                ) : (
                  <SectionStatusBadge status="missing" />
                )
                return (
                  <TableRow key={lecturer.lecturer_id}>
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <div className="grid justify-items-start gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{lecturer.lecturer_name}</span>
                          {isCoordinator(lecturer.lecturer_id) && <Badge variant="secondary">Coordinator</Badge>}
                          {isOwn && <Badge variant="outline">You</Badge>}
                        </div>
                        <div className="sm:hidden">{file}</div>
                      </div>
                    </TableCell>
                    <TableCell className={cn('px-4 py-3 whitespace-normal', SMALL)}>{file}</TableCell>
                    <TableCell className={cn('px-4 py-3', WIDE)}>{uploadedAt}</TableCell>
                    <TableCell className="px-4 py-2 text-right">
                      {timetable && (
                        <RowActions label={isOwn ? 'Actions for your timetable' : `Actions for the timetable of ${lecturer.lecturer_name}`}>
                          <FileMenuItems file={timetable} />
                          {isOwn && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(timetable)}>
                                <Trash2Icon />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </RowActions>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </TableCard>

      <SectionVerdict offeringId={offeringId} section={SECTION.number} sectionTitle={SECTION.title} status={data?.status ?? null} onRecorded={reload} />
      <SectionPager offeringId={offeringId} section={SECTION.number} />

      {deleting && offering && (
        <DeleteSharedFileDialog
          file={deleting}
          title="your timetable"
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            await reload()
            toast.success(`Deleted ${deleting.name}`)
          }}
        />
      )}
    </div>
  )
}
