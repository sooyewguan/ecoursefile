import { ArrowLeftIcon, BookOpenIcon, CalendarRangeIcon, CopyIcon, FileTextIcon, FolderOpenIcon, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon, UploadIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog, FormDialog } from '@/components/action-dialogs'
import { Combobox, type ComboboxOption } from '@/components/combobox'
import { CopyOfferingsDialog, CopyResults, type CopyOutcome, type SemesterRef } from '@/components/copy-offerings'
import { DeleteSharedFileDialog, type LinkedSharedFile } from '@/components/delete-shared-file-dialog'
import { FileLink, FileMenuItems } from '@/components/file-link'
import { FieldError } from '@/components/form-errors'
import { StaffNames, type StaffMember } from '@/components/identity'
import { ReplaceSharedFileDialog } from '@/components/replace-shared-file-dialog'
import { LoadError, NotFound, PageHeader, RowActions, TableCard, TableEmpty, TableLoadError, TableSkeleton } from '@/components/page'
import { Pager, usePagedList } from '@/components/paged-list'
import { SectionStatusBadge } from '@/components/section-status'
import { Time } from '@/components/time'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { friendlyError } from '../errors.ts'
import { containsFilter } from '../paging.ts'
import { PROGRAM_CODE_FILE_SECTION, SEMESTER_FILE_SECTIONS } from '../sections.ts'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'
import { uploadFile, type SharedSlot } from '../uploads.ts'

/**
 * An offering and its lecturers, the coordinator among them, by the names the app shows, and whether
 * each one's account is active. While its course file is not in use, its course can change and it
 * can be deleted.
 */
type Offering = {
  id: string
  coordinator_id: string
  in_use: boolean
  course: { id: string; code: string; title: string }
  lecturers: { lecturer_id: string; lecturer_name: string; profile: { active: boolean } }[]
}

/** One of the semester's shared files, and the offerings whose course files link it. */
type SharedFile = LinkedSharedFile & { section: number; uploaded_at: string; uploader_name: string }

/** A program code, and its student timetable for the semester, or null while it is missing. */
type StudentTimetable = { program_code_id: string; code: string; missing: boolean; file: SharedFile | null }

/**
 * A lecturer who teaches in the semester, by the course codes of their offerings there, and their
 * timetable for the semester, or null while it is missing. With no courses, the lecturer no longer
 * teaches there, and the timetable is deletable here, since no course file links it.
 */
type LecturerTimetable = {
  lecturer_id: string
  display_name: string
  email: string
  active: boolean
  courses: string[]
  missing: boolean
  file: (SharedFile & { deletable: boolean }) | null
}

/** The dialog that is open, and the offering or shared file it acts on. title names the shared file. */
type OpenDialog =
  | { kind: 'add' }
  | { kind: 'copy' }
  | { kind: 'edit'; offering: Offering }
  | { kind: 'delete'; offering: Offering }
  | { kind: 'delete-shared'; file: SharedFile; title: string }
  | { kind: 'replace-shared'; file: SharedFile; title: string; slot: SharedSlot }

const STUDENT_TIMETABLE = PROGRAM_CODE_FILE_SECTION

/** How many options a picker shows for a search. */
const PICKER_LIMIT = 20

/** Below md the coordinator and lecturers move into the course cell, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'

/** The offerings table's columns: course, coordinator, other lecturers and the row menu. */
const OFFERING_COLUMNS = ['', WIDE, WIDE, '']

/** The shared files table's columns: section and file, uploaded, and the upload button or row menu. */
const SHARED_COLUMNS = ['', WIDE, '']

/**
 * One semester: its offerings, with their coordinators and lecturers, a page at a time; the
 * Academic Calendar and Appointment Letter that every course file of the semester links; every
 * lecturer who teaches in the semester with their timetable or Missing, and each timetable whose
 * lecturer no longer teaches there; and every program code with its Student Timetable or Missing,
 * which every course file that ticks the code links. Missing rows come first, and each list counts
 * them. Each file opens in a new tab.
 */
export function Semester() {
  const semesterId = useParams().semesterId!
  /** Undefined while it loads, and null when no semester has the id in the address. */
  const [semester, setSemester] = useState<SemesterRef | null | undefined>(undefined)
  const [sharedFiles, setSharedFiles] = useState<SharedFile[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  /** What the last copy into a semester did, until dismissed, and the semester it copied into. */
  const [copied, setCopied] = useState<{ semesterId: string; outcome: CopyOutcome } | null>(null)
  /** The key of the shared file that is uploading, as keyOf gives it. */
  const [uploading, setUploading] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  /** Where the file picked next goes. */
  const picking = useRef<SharedSlot | null>(null)
  /** How many lecturers who teach in the semester, and how many program codes, have no timetable for it. */
  const [missing, setMissing] = useState<{ lecturers: number | null; programCodes: number | null }>({ lecturers: null, programCodes: null })

  const offerings = usePagedList((range, search) => {
    let query = supabase
      .from('offerings')
      .select(
        'id, coordinator_id, in_use, course:courses!inner(id, code, title), lecturers:offering_lecturers!offering_lecturers_offering_id_fkey(lecturer_id, lecturer_name, profile:profiles!offering_lecturers_lecturer_id_fkey(active))',
        { count: 'exact' },
      )
      .eq('semester_id', semesterId)
    const filter = containsFilter(['code', 'title'], search)
    if (filter) query = query.or(filter, { referencedTable: 'course' })
    return query.order('course(code)').range(range.from, range.to).overrideTypes<Offering[], { merge: false }>()
  }, semesterId)

  /** One page of an outstanding list, its missing rows first, with how many rows that match the search miss their file. */
  async function outstandingPage<Row>(
    list: 'semester_lecturer_timetables' | 'semester_student_timetables',
    order: string,
    searchColumns: string[],
    range: { from: number; to: number },
    search: string,
  ): Promise<{ data: Row[] | null; count: number | null; error: unknown; missing: number | null }> {
    const filter = containsFilter(searchColumns, search)
    const matching = (head: boolean) => {
      const query = supabase.rpc(list, { semester_id: semesterId }, { count: 'exact', head })
      return filter ? query.or(filter) : query
    }
    const [page, missing] = await Promise.all([
      matching(false).order('missing', { ascending: false }).order(order).range(range.from, range.to),
      matching(true).eq('missing', true),
    ])
    return { data: page.data as Row[] | null, count: page.count, error: page.error, missing: missing.error ? null : missing.count }
  }

  const lecturerTimetables = usePagedList(async (range, search) => {
    const page = await outstandingPage<LecturerTimetable>('semester_lecturer_timetables', 'full_name', ['display_name', 'email'], range, search)
    setMissing((counts) => ({ ...counts, lecturers: page.missing }))
    return page
  }, semesterId)

  const studentTimetables = usePagedList(async (range, search) => {
    const page = await outstandingPage<StudentTimetable>('semester_student_timetables', 'code', ['code'], range, search)
    setMissing((counts) => ({ ...counts, programCodes: page.missing }))
    return page
  }, semesterId)

  const reload = useCallback(async () => {
    const [found, files] = await Promise.all([
      supabase.from('semesters').select('id, code, start_year, number').eq('id', semesterId).maybeSingle(),
      supabase
        .from('files')
        .select('id, section, name, uploaded_at, uploader_name, linked_offerings(id, course:courses(code, title))')
        .eq('semester_id', semesterId)
        .in(
          'section',
          SEMESTER_FILE_SECTIONS.map((section) => section.number),
        )
        .overrideTypes<SharedFile[], { merge: false }>(),
    ])
    setLoadFailed(Boolean(found.error || files.error))
    if (found.error || files.error) return
    setSemester(found.data)
    setSharedFiles(files.data)
  }, [semesterId])

  useEffect(() => {
    void reload()
  }, [reload])

  const backLink = (
    <Button asChild variant="outline">
      <Link to="/semesters">
        <ArrowLeftIcon />
        All semesters
      </Link>
    </Button>
  )

  if (semester === null) {
    return <NotFound icon={CalendarRangeIcon} title="Semester not found" backTo="/semesters" backLabel="All semesters" />
  }

  if (loadFailed) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Semester" action={backLink} />
        <Card className="py-0">
          <LoadError title="Couldn't load this semester" onRetry={reload} />
        </Card>
      </div>
    )
  }

  /** Reloads the offerings, and the lecturer timetables, whose course files follow the offerings' lecturers. */
  function reloadOfferings() {
    offerings.retry()
    lecturerTimetables.retry()
  }

  /** Runs one write to an offering, reloads the offerings, and returns why it failed, or shows success and returns null. */
  async function write(request: PromiseLike<{ error: unknown }>, success: string) {
    const { error } = await request
    reloadOfferings()
    if (error) return friendlyError(error, { codes: { [UNIQUE_VIOLATION]: 'This course is already offered in this semester.' } })
    toast.success(success)
    return null
  }

  /** Changes the offering's course when another is chosen, then sets its staff. A refused course change changes nothing. */
  async function edit(offering: Offering, { coordinatorId, lecturerIds }: Staff, course: ComboboxOption) {
    if (course.value !== offering.course.id) {
      const { error } = await supabase.from('offerings').update({ course_id: course.value }).eq('id', offering.id)
      if (error) return { error }
    }
    return supabase.rpc('set_offering_lecturers', { offering_id: offering.id, coordinator_id: coordinatorId, lecturer_ids: lecturerIds })
  }

  async function remove(offering: Offering) {
    const { code } = offering.course
    const { error } = await supabase.from('offerings').delete().eq('id', offering.id)
    reloadOfferings()
    if (error) return friendlyError(error, { codes: { '23503': `The course file of ${code} is in use now, so the offering stays.` } })
    toast.success(`Deleted ${code}`)
    return null
  }

  function close() {
    setDialog(null)
  }

  function pick(target: SharedSlot) {
    picking.current = target
    picker.current?.click()
  }

  /** Reloads every list of shared files: the calendar and letter, and both timetable lists. */
  async function reloadSharedFiles() {
    studentTimetables.retry()
    lecturerTimetables.retry()
    await reload()
  }

  /** Uploads the picked PDF as the semester's file of the section, or a program code's timetable, then reports the outcome. */
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    const target = picking.current
    if (!file || !target) return
    setUploading(keyOf(target))
    try {
      await uploadFile(supabase, target, file)
      toast.success(`Uploaded ${file.name}`)
    } catch (error) {
      toast.error(friendlyError(error))
    }
    await reloadSharedFiles()
    setUploading(null)
  }

  /** The upload button of a shared file that is missing. */
  function uploadButton(target: SharedSlot, label: string) {
    return (
      <Button variant="outline" size="sm" aria-label={label} onClick={() => pick(target)} disabled={uploading !== null}>
        {uploading === keyOf(target) ? <Spinner /> : <UploadIcon />}
        Upload PDF
      </Button>
    )
  }

  // An empty list offers its action in its empty state, so the heading offers it only once a list has rows.
  const noOfferings = offerings.total === 0 && !offerings.query
  const noProgramCodes = studentTimetables.total === 0 && !studentTimetables.query
  const hasOfferings = offerings.total !== null && !noOfferings
  const noLecturers = lecturerTimetables.total === 0 && !lecturerTimetables.query
  const addButton = (
    <Button onClick={() => setDialog({ kind: 'add' })}>
      <PlusIcon />
      Add offering
    </Button>
  )
  const offeringActions = (
    <div className="flex flex-wrap justify-center gap-2 max-sm:w-full max-sm:*:grow">
      <Button variant="outline" onClick={() => setDialog({ kind: 'copy' })} disabled={!semester}>
        <CopyIcon />
        Copy offerings
      </Button>
      {addButton}
    </div>
  )

  return (
    <div className="grid gap-8">
      <PageHeader title={semester ? `Semester ${semester.code}` : 'Semester'} action={backLink} />

      <section aria-labelledby="offerings-heading" className="grid gap-3">
        <ListHeading id="offerings-heading" title="Offerings" total={offerings.total} action={hasOfferings && offeringActions} />
        {copied?.semesterId === semesterId && <CopyResults outcome={copied.outcome} onDismiss={() => setCopied(null)} />}
        {hasOfferings && (
          <Input
            type="search"
            aria-label="Search offerings"
            placeholder="Search by course code or title"
            className="max-w-sm"
            value={offerings.query}
            onChange={(event) => offerings.setQuery(event.target.value)}
          />
        )}
        <TableCard>
          <Table aria-labelledby="offerings-heading">
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Course</TableHead>
                <TableHead className={cn('px-4', WIDE)}>Coordinator</TableHead>
                <TableHead className={cn('px-4', WIDE)}>Other lecturers</TableHead>
                <TableHead className="w-14 px-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {offerings.failed ? (
                <TableLoadError columns={OFFERING_COLUMNS.length} title="Couldn't load the offerings" onRetry={offerings.retry} />
              ) : !offerings.rows ? (
                <TableSkeleton columns={OFFERING_COLUMNS} />
              ) : offerings.rows.length === 0 ? (
                <TableEmpty
                  columns={OFFERING_COLUMNS.length}
                  icon={BookOpenIcon}
                  title={noOfferings ? 'No offerings yet' : 'No matching offerings'}
                  description={noOfferings ? 'Copy the offerings of another semester, or add them one at a time.' : undefined}
                  action={noOfferings ? offeringActions : undefined}
                />
              ) : (
                offerings.rows.map((offering) => (
                  <OfferingRow
                    key={offering.id}
                    offering={offering}
                    onEdit={() => setDialog({ kind: 'edit', offering })}
                    onDelete={() => setDialog({ kind: 'delete', offering })}
                  />
                ))
              )}
            </TableBody>
          </Table>
          {offerings.total !== null && <Pager page={offerings.page} total={offerings.total} onPageChange={offerings.setPage} />}
        </TableCard>
      </section>

      <section aria-labelledby="shared-files-heading" className="grid gap-3">
        <h2 id="shared-files-heading" className="text-lg font-semibold tracking-tight">
          Shared files
        </h2>
        <input ref={picker} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void upload(event)} />
        <TableCard>
          <Table aria-labelledby="shared-files-heading">
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Section</TableHead>
                <TableHead className={cn('w-64 px-4', WIDE)}>Uploaded</TableHead>
                <TableHead className="w-14 px-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!sharedFiles ? (
                <TableSkeleton columns={SHARED_COLUMNS} rows={SEMESTER_FILE_SECTIONS.length} />
              ) : (
                SEMESTER_FILE_SECTIONS.map((section) => {
                  const file = sharedFiles.find((shared) => shared.section === section.number)
                  return (
                    <SharedFileRow
                      key={section.number}
                      name={`${section.number} ${section.title}`}
                      file={file}
                      actionLabel={`Actions for ${section.title}`}
                      onReplace={(file) => setDialog({ kind: 'replace-shared', file, title: section.title, slot: { semesterId, section: section.number } })}
                      onDelete={(file) => setDialog({ kind: 'delete-shared', file, title: section.title })}
                      upload={uploadButton({ semesterId, section: section.number }, `Upload the ${section.title}`)}
                    />
                  )
                })
              )}
            </TableBody>
          </Table>
        </TableCard>
      </section>

      <section aria-labelledby="lecturer-timetables-heading" className="grid gap-3">
        <ListHeading id="lecturer-timetables-heading" title="Lecturer timetables" total={lecturerTimetables.total} missing={missing.lecturers} />
        {lecturerTimetables.total !== null && !noLecturers && (
          <Input
            type="search"
            aria-label="Search lecturer timetables"
            placeholder="Search by lecturer name or email"
            className="max-w-sm"
            value={lecturerTimetables.query}
            onChange={(event) => lecturerTimetables.setQuery(event.target.value)}
          />
        )}
        <TableCard>
          <Table aria-labelledby="lecturer-timetables-heading">
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Lecturer</TableHead>
                <TableHead className={cn('w-64 px-4', WIDE)}>Uploaded</TableHead>
                <TableHead className="w-14 px-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lecturerTimetables.failed ? (
                <TableLoadError columns={SHARED_COLUMNS.length} title="Couldn't load the lecturer timetables" onRetry={lecturerTimetables.retry} />
              ) : !lecturerTimetables.rows ? (
                <TableSkeleton columns={SHARED_COLUMNS} />
              ) : lecturerTimetables.rows.length === 0 ? (
                <TableEmpty columns={SHARED_COLUMNS.length} icon={FileTextIcon} title={noLecturers ? 'No lecturers in this semester yet' : 'No matching lecturers'} />
              ) : (
                lecturerTimetables.rows.map((lecturer) => {
                  const name = lecturer.display_name
                  return (
                    <SharedFileRow
                      key={lecturer.lecturer_id}
                      name={<StaffNames staff={[{ name, active: lecturer.active }]} />}
                      file={lecturer.file ?? undefined}
                      detail={
                        <>
                          <span className="text-muted-foreground text-xs break-all">{lecturer.email}</span>
                          {lecturer.courses.length > 0 ? (
                            <span className="text-muted-foreground text-xs">Teaches {lecturer.courses.join(', ')}</span>
                          ) : (
                            <Badge variant="outline">Not in any course file</Badge>
                          )}
                        </>
                      }
                      actionLabel={`Actions for the timetable of ${name}`}
                      onDelete={
                        lecturer.file?.deletable ? (file) => setDialog({ kind: 'delete-shared', file, title: `the timetable of ${name}` }) : undefined
                      }
                    />
                  )
                })
              )}
            </TableBody>
          </Table>
          {lecturerTimetables.total !== null && <Pager page={lecturerTimetables.page} total={lecturerTimetables.total} onPageChange={lecturerTimetables.setPage} />}
        </TableCard>
      </section>

      <section aria-labelledby="student-timetables-heading" className="grid gap-3">
        <ListHeading id="student-timetables-heading" title="Student timetables" total={studentTimetables.total} missing={missing.programCodes} />
        {studentTimetables.total !== null && !noProgramCodes && (
          <Input
            type="search"
            aria-label="Search student timetables"
            placeholder="Search by program code"
            className="max-w-sm"
            value={studentTimetables.query}
            onChange={(event) => studentTimetables.setQuery(event.target.value)}
          />
        )}
        <TableCard>
          <Table aria-labelledby="student-timetables-heading">
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Program code</TableHead>
                <TableHead className={cn('w-64 px-4', WIDE)}>Uploaded</TableHead>
                <TableHead className="w-14 px-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {studentTimetables.failed ? (
                <TableLoadError columns={SHARED_COLUMNS.length} title="Couldn't load the student timetables" onRetry={studentTimetables.retry} />
              ) : !studentTimetables.rows ? (
                <TableSkeleton columns={SHARED_COLUMNS} />
              ) : studentTimetables.rows.length === 0 ? (
                <TableEmpty
                  columns={SHARED_COLUMNS.length}
                  icon={FileTextIcon}
                  title={noProgramCodes ? 'No program codes yet' : 'No matching program codes'}
                  action={
                    noProgramCodes ? (
                      <Button asChild variant="outline">
                        <Link to="/program-codes">Go to Program codes</Link>
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                studentTimetables.rows.map((timetable) => (
                  <SharedFileRow
                    key={timetable.program_code_id}
                    name={timetable.code}
                    file={timetable.file ?? undefined}
                    actionLabel={`Actions for the student timetable of ${timetable.code}`}
                    onReplace={(file) =>
                      setDialog({
                        kind: 'replace-shared',
                        file,
                        title: `the student timetable of ${timetable.code}`,
                        slot: { semesterId, section: STUDENT_TIMETABLE.number, programCodeId: timetable.program_code_id },
                      })
                    }
                    onDelete={(file) => setDialog({ kind: 'delete-shared', file, title: `the student timetable of ${timetable.code}` })}
                    upload={uploadButton(
                      { semesterId, section: STUDENT_TIMETABLE.number, programCodeId: timetable.program_code_id },
                      `Upload the student timetable of ${timetable.code}`,
                    )}
                  />
                ))
              )}
            </TableBody>
          </Table>
          {studentTimetables.total !== null && <Pager page={studentTimetables.page} total={studentTimetables.total} onPageChange={studentTimetables.setPage} />}
        </TableCard>
      </section>

      {dialog?.kind === 'add' && (
        <OfferingDialog
          semesterId={semesterId}
          onClose={close}
          onSubmit={({ coordinatorId, lecturerIds }, course) =>
            write(
              supabase.rpc('create_offering', { semester_id: semesterId, course_id: course!.value, coordinator_id: coordinatorId, lecturer_ids: lecturerIds }),
              `Added ${course!.label}`,
            )
          }
        />
      )}

      {dialog?.kind === 'copy' && semester && (
        <CopyOfferingsDialog
          semester={semester}
          onClose={close}
          onCopied={(outcome) => {
            setCopied({ semesterId, outcome })
            reloadOfferings()
          }}
        />
      )}

      {dialog?.kind === 'edit' && (
        <OfferingDialog
          semesterId={semesterId}
          offering={dialog.offering}
          onClose={close}
          onSubmit={(staff, course) => write(edit(dialog.offering, staff, course!), `Saved ${course!.label}`)}
        />
      )}

      {dialog?.kind === 'delete' && <DeleteOfferingDialog offering={dialog.offering} onClose={close} onDelete={() => remove(dialog.offering)} />}

      {dialog?.kind === 'delete-shared' && (
        <DeleteSharedFileDialog
          file={dialog.file}
          title={dialog.title}
          onClose={close}
          onDeleted={async () => {
            await reloadSharedFiles()
            toast.success(`Deleted ${dialog.file.name}`)
          }}
        />
      )}

      {dialog?.kind === 'replace-shared' && (
        <ReplaceSharedFileDialog
          file={dialog.file}
          title={dialog.title}
          slot={dialog.slot}
          onClose={close}
          onFailed={reloadSharedFiles}
          onReplaced={async (name) => {
            await reloadSharedFiles()
            toast.success(`Replaced ${dialog.file.name} with ${name}`)
          }}
        />
      )}
    </div>
  )
}

/** Where a shared file goes, as one string, to tell which upload is running. */
function keyOf(target: SharedSlot) {
  return `${target.section}:${target.programCodeId ?? ''}`
}

/**
 * A list's heading with how many it holds, how many of them miss their file when the list counts
 * that, and the list's action at its end.
 */
function ListHeading({ id, title, total, missing, action }: { id: string; title: string; total: number | null; missing?: number | null; action?: ReactNode }) {
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={id} className="flex items-baseline gap-2 text-lg font-semibold tracking-tight">
          {title}
          {total !== null && total > 0 && <span className="text-muted-foreground text-sm font-normal tabular-nums">{total.toLocaleString('en-US')}</span>}
        </h2>
        {missing != null &&
          total !== null &&
          total > 0 &&
          (missing > 0 ? (
            <Badge variant="destructive" className="tabular-nums">
              {missing.toLocaleString('en-US')} missing
            </Badge>
          ) : (
            <Badge variant="success">None missing</Badge>
          ))}
      </div>
      {action}
    </div>
  )
}

/** An offering's row: its course, which opens its course file, its coordinator and its other lecturers, each marked when deactivated. */
function OfferingRow({ offering, onEdit, onDelete }: { offering: Offering; onEdit: () => void; onDelete: () => void }) {
  const member = (lecturer: Offering['lecturers'][number]): StaffMember => ({ name: lecturer.lecturer_name, active: lecturer.profile.active })
  const coordinator = offering.lecturers.filter((lecturer) => lecturer.lecturer_id === offering.coordinator_id).map(member)
  const others = offering.lecturers
    .filter((lecturer) => lecturer.lecturer_id !== offering.coordinator_id)
    .map(member)
    .toSorted((a, b) => a.name.localeCompare(b.name))
  return (
    <TableRow className="relative">
      <TableCell className="px-4 py-3 whitespace-normal">
        <div className="grid gap-0.5">
          <Link to={`/course-files/${offering.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
            {offering.course.code}
          </Link>
          <span>{offering.course.title}</span>
          <div className="text-muted-foreground mt-1 grid gap-0.5 text-xs md:hidden">
            <span>
              Coordinator: <StaffNames staff={coordinator} />
            </span>
            {others.length > 0 && (
              <span>
                Lecturers: <StaffNames staff={others} />
              </span>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>
        <StaffNames staff={coordinator} />
      </TableCell>
      <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>
        {others.length > 0 ? <StaffNames staff={others} /> : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="relative z-10 px-4 py-2 text-right">
        <RowActions label={`Actions for ${offering.course.code}`}>
          <DropdownMenuItem asChild>
            <Link to={`/course-files/${offering.id}`}>
              <FolderOpenIcon />
              Open course file
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </RowActions>
      </TableCell>
    </TableRow>
  )
}

/**
 * A shared file's row: the section, program code or lecturer it is for, the file, which opens in a
 * new tab, any detail under it, who uploaded it and when, and its row menu, which offers Replace
 * with onReplace and Delete with onDelete. Without a file it is Missing, with the upload button.
 */
function SharedFileRow({
  name,
  file,
  detail,
  actionLabel,
  onReplace,
  onDelete,
  upload,
}: {
  name: ReactNode
  file: SharedFile | undefined
  detail?: ReactNode
  actionLabel: string
  onReplace?: (file: SharedFile) => void
  onDelete?: (file: SharedFile) => void
  upload?: ReactNode
}) {
  return (
    <TableRow>
      <TableCell className="px-4 py-3 whitespace-normal">
        <div className="grid justify-items-start gap-0.5">
          <span className="font-medium">{name}</span>
          {file ? <FileLink file={file} className="font-normal" /> : <SectionStatusBadge status="missing" />}
          {detail}
          {file && (
            <span className="text-muted-foreground text-xs md:hidden">
              {file.uploader_name} · <Time value={file.uploaded_at} />
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>
        {file ? (
          <div className="grid gap-0.5">
            <span>{file.uploader_name}</span>
            <span className="text-muted-foreground text-xs">
              <Time value={file.uploaded_at} />
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="px-4 py-2 text-right">
        {file ? (
          <RowActions label={actionLabel}>
            <FileMenuItems file={file} />
            {onReplace && (
              <DropdownMenuItem onSelect={() => onReplace(file)}>
                <RefreshCwIcon />
                Replace
              </DropdownMenuItem>
            )}
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(file)}>
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </RowActions>
        ) : (
          upload
        )}
      </TableCell>
    </TableRow>
  )
}

/** Finds active users with the lecturer role whose name or email has the query. */
async function searchLecturers(query: string): Promise<ComboboxOption[]> {
  let request = supabase.from('profiles').select('id, display_name, email, user_roles!inner(role)').eq('active', true).eq('user_roles.role', 'lecturer')
  const filter = containsFilter(['display_name', 'email'], query)
  if (filter) request = request.or(filter)
  const { data, error } = await request.order('full_name').limit(PICKER_LIMIT)
  if (error) throw error
  return data.map((person) => ({ value: person.id, label: person.display_name ?? person.email, detail: person.email }))
}

/** An offering's coordinator, and its other lecturers. */
type Staff = { coordinatorId: string; lecturerIds: string[] }

/**
 * The dialog that adds an offering, or with an offering edits it. The course is chosen among those
 * the semester does not offer yet, and stays once the offering's course file is in use. The
 * coordinator is a lecturer too, so they show first among the lecturers and cannot be taken off. A
 * coordinator who is replaced stays a lecturer until taken off. onSubmit gets the coordinator, the
 * other lecturers and the course.
 */
function OfferingDialog({
  semesterId,
  offering,
  onClose,
  onSubmit,
}: {
  semesterId: string
  offering?: Offering
  onClose: () => void
  onSubmit: (staff: Staff, course: ComboboxOption | null) => Promise<string | null>
}) {
  const named = (lecturer: Offering['lecturers'][number]): ComboboxOption => ({ value: lecturer.lecturer_id, label: lecturer.lecturer_name })
  const [course, setCourse] = useState<ComboboxOption | null>(
    offering ? { value: offering.course.id, label: `${offering.course.code} ${offering.course.title}` } : null,
  )
  const [coordinator, setCoordinator] = useState<ComboboxOption | null>(() => {
    const current = offering?.lecturers.find((lecturer) => lecturer.lecturer_id === offering.coordinator_id)
    return current ? named(current) : null
  })
  const [lecturers, setLecturers] = useState<ComboboxOption[]>(() => (offering?.lecturers ?? []).map(named))
  const others = lecturers.filter((lecturer) => lecturer.value !== coordinator?.value)

  /**
   * Finds the courses the semester does not offer yet whose code or title has the query. When every
   * course that matches is offered already, it lists those, disabled, so the picker says why none
   * can be chosen.
   */
  async function searchCourses(query: string): Promise<ComboboxOption[]> {
    const matching = (offered: boolean) => {
      let request = supabase.from('courses').select(`id, code, title, offerings!${offered ? 'inner' : 'left'}(id)`).eq('offerings.semester_id', semesterId)
      if (!offered) request = request.is('offerings', null)
      const filter = containsFilter(['code', 'title'], query)
      if (filter) request = request.or(filter)
      return request.order('code').limit(PICKER_LIMIT)
    }
    const open = await matching(false)
    if (open.error) throw open.error
    if (open.data.length > 0) return open.data.map((found) => ({ value: found.id, label: `${found.code} ${found.title}` }))
    const offered = await matching(true)
    if (offered.error) throw offered.error
    return offered.data.map((found) => ({ value: found.id, label: `${found.code} ${found.title}`, detail: 'Already offered in this semester', disabled: true }))
  }

  return (
    <FormDialog
      title={offering ? `Edit ${offering.course.code}` : 'Add an offering'}
      submitLabel={offering ? 'Save' : 'Add offering'}
      onClose={onClose}
      onSubmit={async () => {
        if (!course) return { field: 'course_id', message: 'Choose a course.' }
        if (!coordinator) return { field: 'coordinator_id', message: 'Choose a coordinator.' }
        return onSubmit({ coordinatorId: coordinator.value, lecturerIds: others.map((lecturer) => lecturer.value) }, course)
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="offering-course">Course</Label>
        <Combobox
          id="offering-course"
          name="course_id"
          value={course}
          onChange={setCourse}
          search={searchCourses}
          placeholder="Choose a course"
          searchPlaceholder="Search courses"
          disabled={offering?.in_use}
        />
        {offering?.in_use && <p className="text-muted-foreground text-sm">Its course file is in use, so the course stays.</p>}
        <FieldError name="course_id" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="offering-coordinator">Coordinator</Label>
        <Combobox
          id="offering-coordinator"
          name="coordinator_id"
          value={coordinator}
          onChange={setCoordinator}
          search={searchLecturers}
          placeholder="Choose a coordinator"
          searchPlaceholder="Search lecturers"
        />
        <FieldError name="coordinator_id" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="offering-lecturer">Lecturers</Label>
        <ul aria-label="Lecturers of the offering" className="flex flex-wrap gap-2">
          {coordinator && (
            <li>
              <Badge variant="secondary" className="h-8 max-w-full gap-1.5 rounded-md px-2.5 text-sm font-normal whitespace-normal">
                {coordinator.label}
                <span className="text-muted-foreground text-xs">Coordinator</span>
              </Badge>
            </li>
          )}
          {others.map((lecturer) => (
            <li key={lecturer.value}>
              <Badge variant="outline" className="h-8 max-w-full gap-1 rounded-md py-0 pr-1 pl-2.5 text-sm font-normal whitespace-normal">
                {lecturer.label}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-6"
                  aria-label={`Remove ${lecturer.label}`}
                  onClick={() => setLecturers((list) => list.filter((l) => l.value !== lecturer.value))}
                >
                  <XIcon />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
        <Combobox
          id="offering-lecturer"
          value={null}
          onChange={(picked) => setLecturers((list) => (list.some((l) => l.value === picked.value) ? list : [...list, picked]))}
          search={async (query) => {
            const chosen = new Set([coordinator?.value, ...lecturers.map((lecturer) => lecturer.value)])
            return (await searchLecturers(query)).filter((option) => !chosen.has(option.value))
          }}
          placeholder="Add a lecturer"
          searchPlaceholder="Search lecturers"
        />
      </div>
    </FormDialog>
  )
}

/** Confirms the delete of an offering whose course file is not in use, or says why one in use stays. */
function DeleteOfferingDialog({ offering, onDelete, onClose }: { offering: Offering; onDelete: () => Promise<string | null>; onClose: () => void }) {
  const { code, title } = offering.course
  if (offering.in_use) {
    return (
      <AlertDialog open onOpenChange={(open) => !open && onClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Can't delete {code}</AlertDialogTitle>
            <AlertDialogDescription>
              Its course file is in use, so the offering stays as part of the audit record. Its coordinator and lecturers can still change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }
  return (
    <ConfirmDialog
      title={`Delete ${code} ${title}?`}
      description="Its coordinator and lecturers lose it. This can't be undone."
      confirmLabel="Delete"
      destructive
      onClose={onClose}
      onConfirm={onDelete}
    />
  )
}
