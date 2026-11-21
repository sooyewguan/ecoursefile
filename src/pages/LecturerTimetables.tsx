import { ArrowLeftIcon, FileTextIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useParams } from 'react-router'
import { DeleteSharedFileDialog, type LinkedSharedFile } from '@/components/delete-shared-file-dialog'
import { NoticeAlert, type Notice } from '@/components/notice'
import { PageHeader, RowActions, TableEmpty, TableSkeleton } from '@/components/page'
import { SectionStatusBadge } from '@/components/section-status'
import { SectionVerdict } from '@/components/section-verdict'
import { Time } from '@/components/time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn, formatSize } from '@/lib/utils'
import { useAuth } from '../auth-provider.tsx'
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

/** Below md the upload time moves into the timetable cell, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'

/** The table's columns: lecturer, timetable, uploaded, and the row menu of the user's own timetable. */
const COLUMNS = ['', '', WIDE, '']

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
  const [notice, setNotice] = useState<Notice | null>(null)
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
    const error = offering.error ?? statuses.error
    if (error) {
      setNotice({ tone: 'error', text: error.message })
      return
    }
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
    return (
      <div className="grid gap-6">
        <PageHeader title={SECTION.title} description="Open a section from its course file." action={backLink} />
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableBody>
              <TableEmpty
                columns={1}
                icon={FileTextIcon}
                title="Section not found"
                description="It does not exist, or you do not have access to its course file."
              />
            </TableBody>
          </Table>
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
    setNotice(null)
    try {
      await uploadFile(supabase, { semesterId: offering.semester_id, section: SECTION.number }, file)
      await reload()
      setNotice({ tone: 'success', text: `Uploaded ${file.name} as your timetable for ${offering.semester.code}.` })
    } catch (error) {
      await reload()
      setNotice({ tone: 'error', text: `${file.name} was not uploaded. ${error instanceof Error ? error.message : String(error)}` })
    }
    setUploading(false)
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={SECTION.title}
        description={
          offering ? `Section ${SECTION.number} · ${offering.course.code} ${offering.course.title} · ${offering.semester.code}` : `Section ${SECTION.number}`
        }
        action={
          <div className="flex flex-wrap gap-2">
            {backLink}
            {canUpload && (
              <Button onClick={() => picker.current?.click()} disabled={uploading}>
                {uploading ? <Spinner /> : <UploadIcon />}
                Upload your timetable
              </Button>
            )}
          </div>
        }
      />
      <input ref={picker} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void upload(event)} />

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {data?.status && <SectionStatusBadge status={data.status} />}
        <span>
          Each lecturer uploads their own timetable, one PDF of up to 20 MB per semester. It shows in every course file they teach that semester. This
          section is Missing until every lecturer of this offering has one.
        </span>
      </div>
      <SectionVerdict offeringId={offeringId} section={SECTION.number} sectionTitle={SECTION.title} status={data?.status ?? null} onRecorded={reload} />
      {notice && <NoticeAlert notice={notice} />}

      <Card className="gap-0 overflow-hidden py-0">
        <Table aria-label="Lecturer timetables">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-4">Lecturer</TableHead>
              <TableHead className="px-4">Timetable</TableHead>
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
                return (
                  <TableRow key={lecturer.lecturer_id}>
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{lecturer.lecturer_name}</span>
                        {isCoordinator(lecturer.lecturer_id) && <Badge variant="secondary">Coordinator</Badge>}
                        {isOwn && <Badge variant="outline">You</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 whitespace-normal">
                      {timetable ? (
                        <div className="grid gap-0.5">
                          <span>{timetable.name}</span>
                          <span className="text-muted-foreground text-xs">{formatSize(timetable.size)}</span>
                          <span className="text-muted-foreground text-xs md:hidden">{uploadedAt}</span>
                        </div>
                      ) : (
                        <SectionStatusBadge status="missing" />
                      )}
                    </TableCell>
                    <TableCell className={cn('px-4 py-3', WIDE)}>{uploadedAt}</TableCell>
                    <TableCell className="px-4 py-2 text-right">
                      {isOwn && timetable && (
                        <RowActions label="Actions for your timetable">
                          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(timetable)}>
                            <Trash2Icon />
                            Delete
                          </DropdownMenuItem>
                        </RowActions>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {deleting && offering && (
        <DeleteSharedFileDialog
          file={deleting}
          section={SECTION}
          subject={`Your timetable for ${offering.semester.code}`}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            await reload()
            setNotice({ tone: 'success', text: `Deleted ${deleting.name}.` })
          }}
        />
      )}
    </div>
  )
}
