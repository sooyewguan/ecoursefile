import { ArrowLeftIcon, BookOpenIcon, CalendarRangeIcon, FileTextIcon, FolderOpenIcon, PlusIcon, Trash2Icon, UploadIcon, UsersIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { FormDialog } from '@/components/action-dialogs'
import { Combobox, type ComboboxOption } from '@/components/combobox'
import { DeleteSharedFileDialog, type LinkedSharedFile } from '@/components/delete-shared-file-dialog'
import { FileLink, FileMenuItems } from '@/components/file-link'
import { FieldError } from '@/components/form-errors'
import { LoadError, NotFound, PageHeader, RowActions, TableEmpty, TableLoadError, TableSkeleton } from '@/components/page'
import { Pager, usePagedList } from '@/components/paged-list'
import { SectionStatusBadge } from '@/components/section-status'
import { Time } from '@/components/time'
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
import { PROGRAM_CODE_FILE_SECTION, SEMESTER_FILE_SECTIONS, type Section } from '../sections.ts'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'
import { uploadFile } from '../uploads.ts'

/** An offering and its lecturers, the coordinator among them, by the names the app shows. */
type Offering = {
  id: string
  coordinator_id: string
  course: { code: string; title: string }
  lecturers: { lecturer_id: string; lecturer_name: string }[]
}

/** One of the semester's shared files, and the offerings whose course files link it. */
type SharedFile = LinkedSharedFile & { section: number; uploaded_at: string; uploader_name: string }

/** A program code's student timetable for the semester. */
type StudentTimetable = SharedFile & { program_code: { code: string } }

/** The dialog that is open, and the offering or shared file it acts on. title names the shared file. */
type OpenDialog =
  | { kind: 'add' }
  | { kind: 'edit'; offering: Offering }
  | { kind: 'upload-timetable' }
  | { kind: 'delete-shared'; file: SharedFile; title: string }

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
 * Academic Calendar and Appointment Letter that every course file of the semester links; and the
 * Student Timetable of each program code that has one, which every course file that ticks the code
 * links. Each file opens in a new tab.
 */
export function Semester() {
  const semesterId = useParams().semesterId!
  /** Undefined while it loads, and null when no semester has the id in the address. */
  const [semester, setSemester] = useState<{ code: string } | null | undefined>(undefined)
  const [sharedFiles, setSharedFiles] = useState<SharedFile[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  /** The section whose file is uploading. */
  const [uploading, setUploading] = useState<Section | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  /** The section the file picked next goes to. */
  const picking = useRef<Section | null>(null)

  const offerings = usePagedList((range, search) => {
    let query = supabase
      .from('offerings')
      .select('id, coordinator_id, course:courses!inner(code, title), lecturers:offering_lecturers!offering_lecturers_offering_id_fkey(lecturer_id, lecturer_name)', {
        count: 'exact',
      })
      .eq('semester_id', semesterId)
    const filter = containsFilter(['code', 'title'], search)
    if (filter) query = query.or(filter, { referencedTable: 'course' })
    return query.order('course(code)').range(range.from, range.to).overrideTypes<Offering[], { merge: false }>()
  }, semesterId)

  const timetables = usePagedList((range, search) => {
    let query = supabase
      .from('files')
      .select('id, section, name, uploaded_at, uploader_name, program_code:program_codes!inner(code), linked_offerings(id, course:courses(code, title))', {
        count: 'exact',
      })
      .eq('semester_id', semesterId)
      .eq('section', STUDENT_TIMETABLE.number)
    const filter = containsFilter(['code'], search)
    if (filter) query = query.or(filter, { referencedTable: 'program_code' })
    return query.order('program_code(code)').range(range.from, range.to).overrideTypes<StudentTimetable[], { merge: false }>()
  }, semesterId)

  const reload = useCallback(async () => {
    const [found, files] = await Promise.all([
      supabase.from('semesters').select('code').eq('id', semesterId).maybeSingle(),
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

  /** Runs one write to an offering, reloads the offerings, and returns why it failed, or shows success and returns null. */
  async function write(request: PromiseLike<{ error: unknown }>, success: string) {
    const { error } = await request
    offerings.retry()
    if (error) return friendlyError(error, { codes: { [UNIQUE_VIOLATION]: 'This course is already offered in this semester.' } })
    toast.success(success)
    return null
  }

  function close() {
    setDialog(null)
  }

  function pick(section: Section) {
    picking.current = section
    picker.current?.click()
  }

  /** Uploads the picked PDF as the semester's file of the section, then reports the outcome. */
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    const section = picking.current
    if (!file || !section) return
    setUploading(section)
    try {
      await uploadFile(supabase, { semesterId, section: section.number }, file)
      toast.success(`Uploaded ${file.name}`)
    } catch (error) {
      toast.error(friendlyError(error))
    }
    await reload()
    setUploading(null)
  }

  // An empty list offers its action in its empty state, so the heading offers it only once a list has rows.
  const noOfferings = offerings.total === 0 && !offerings.query
  const noTimetables = timetables.total === 0 && !timetables.query
  const hasOfferings = offerings.total !== null && !noOfferings
  const hasTimetables = timetables.total !== null && !noTimetables
  const addButton = (
    <Button onClick={() => setDialog({ kind: 'add' })}>
      <PlusIcon />
      Add offering
    </Button>
  )
  const uploadTimetableButton = (
    <Button variant="outline" onClick={() => setDialog({ kind: 'upload-timetable' })}>
      <UploadIcon />
      Upload timetable
    </Button>
  )

  return (
    <div className="grid gap-8">
      <PageHeader title={semester ? `Semester ${semester.code}` : 'Semester'} action={backLink} />

      <section aria-labelledby="offerings-heading" className="grid gap-3">
        <ListHeading id="offerings-heading" title="Offerings" total={offerings.total} action={hasOfferings && addButton} />
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
        <Card className="gap-0 overflow-hidden py-0">
          <Table aria-labelledby="offerings-heading">
            <TableHeader className="bg-muted/50">
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
                  action={noOfferings ? addButton : undefined}
                />
              ) : (
                offerings.rows.map((offering) => <OfferingRow key={offering.id} offering={offering} onEdit={() => setDialog({ kind: 'edit', offering })} />)
              )}
            </TableBody>
          </Table>
          {offerings.total !== null && <Pager page={offerings.page} total={offerings.total} onPageChange={offerings.setPage} />}
        </Card>
      </section>

      <section aria-labelledby="shared-files-heading" className="grid gap-3">
        <h2 id="shared-files-heading" className="text-lg font-semibold tracking-tight">
          Shared files
        </h2>
        <input ref={picker} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void upload(event)} />
        <Card className="gap-0 overflow-hidden py-0">
          <Table aria-labelledby="shared-files-heading">
            <TableHeader className="bg-muted/50">
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
                      onDelete={(file) => setDialog({ kind: 'delete-shared', file, title: section.title })}
                      upload={
                        <Button variant="outline" size="sm" onClick={() => pick(section)} disabled={uploading !== null}>
                          {uploading === section ? <Spinner /> : <UploadIcon />}
                          Upload PDF
                        </Button>
                      }
                    />
                  )
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </section>

      <section aria-labelledby="student-timetables-heading" className="grid gap-3">
        <ListHeading id="student-timetables-heading" title="Student timetables" total={timetables.total} action={hasTimetables && uploadTimetableButton} />
        {hasTimetables && (
          <Input
            type="search"
            aria-label="Search student timetables"
            placeholder="Search by program code"
            className="max-w-sm"
            value={timetables.query}
            onChange={(event) => timetables.setQuery(event.target.value)}
          />
        )}
        <Card className="gap-0 overflow-hidden py-0">
          <Table aria-labelledby="student-timetables-heading">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="px-4">Program code</TableHead>
                <TableHead className={cn('w-64 px-4', WIDE)}>Uploaded</TableHead>
                <TableHead className="w-14 px-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {timetables.failed ? (
                <TableLoadError columns={SHARED_COLUMNS.length} title="Couldn't load the student timetables" onRetry={timetables.retry} />
              ) : !timetables.rows ? (
                <TableSkeleton columns={SHARED_COLUMNS} />
              ) : timetables.rows.length === 0 ? (
                <TableEmpty
                  columns={SHARED_COLUMNS.length}
                  icon={FileTextIcon}
                  title={noTimetables ? 'No student timetables yet' : 'No matching student timetables'}
                  action={noTimetables ? uploadTimetableButton : undefined}
                />
              ) : (
                timetables.rows.map((timetable) => (
                  <SharedFileRow
                    key={timetable.id}
                    name={timetable.program_code.code}
                    file={timetable}
                    actionLabel={`Actions for the student timetable of ${timetable.program_code.code}`}
                    onDelete={(file) => setDialog({ kind: 'delete-shared', file, title: `the student timetable of ${timetable.program_code.code}` })}
                  />
                ))
              )}
            </TableBody>
          </Table>
          {timetables.total !== null && <Pager page={timetables.page} total={timetables.total} onPageChange={timetables.setPage} />}
        </Card>
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

      {dialog?.kind === 'edit' && (
        <OfferingDialog
          semesterId={semesterId}
          offering={dialog.offering}
          onClose={close}
          onSubmit={({ coordinatorId, lecturerIds }) =>
            write(
              supabase.rpc('set_offering_lecturers', { offering_id: dialog.offering.id, coordinator_id: coordinatorId, lecturer_ids: lecturerIds }),
              `Saved ${dialog.offering.course.code}`,
            )
          }
        />
      )}

      {dialog?.kind === 'upload-timetable' && (
        <UploadTimetableDialog
          semesterId={semesterId}
          onClose={close}
          onUploaded={(name) => {
            timetables.retry()
            toast.success(`Uploaded ${name}`)
          }}
        />
      )}

      {dialog?.kind === 'delete-shared' && (
        <DeleteSharedFileDialog
          file={dialog.file}
          title={dialog.title}
          onClose={close}
          onDeleted={async () => {
            await reload()
            timetables.retry()
            toast.success(`Deleted ${dialog.file.name}`)
          }}
        />
      )}
    </div>
  )
}

/** A list's heading with how many it holds, and the list's action at its end. */
function ListHeading({ id, title, total, action }: { id: string; title: string; total: number | null; action?: ReactNode }) {
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
      <h2 id={id} className="flex items-baseline gap-2 text-lg font-semibold tracking-tight">
        {title}
        {total !== null && total > 0 && <span className="text-muted-foreground text-sm font-normal tabular-nums">{total.toLocaleString('en-US')}</span>}
      </h2>
      {action}
    </div>
  )
}

/** An offering's row: its course, which opens its course file, its coordinator and its other lecturers. */
function OfferingRow({ offering, onEdit }: { offering: Offering; onEdit: () => void }) {
  const coordinator = offering.lecturers.find((lecturer) => lecturer.lecturer_id === offering.coordinator_id)?.lecturer_name
  const others = offering.lecturers
    .filter((lecturer) => lecturer.lecturer_id !== offering.coordinator_id)
    .map((lecturer) => lecturer.lecturer_name)
    .toSorted((a, b) => a.localeCompare(b))
    .join(', ')
  return (
    <TableRow className="relative">
      <TableCell className="px-4 py-3 whitespace-normal">
        <div className="grid gap-0.5">
          <Link to={`/course-files/${offering.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
            {offering.course.code}
          </Link>
          <span>{offering.course.title}</span>
          <div className="text-muted-foreground mt-1 grid gap-0.5 text-xs md:hidden">
            <span>Coordinator: {coordinator}</span>
            {others && <span>Lecturers: {others}</span>}
          </div>
        </div>
      </TableCell>
      <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{coordinator}</TableCell>
      <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{others || <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell className="relative z-10 px-4 py-2 text-right">
        <RowActions label={`Actions for ${offering.course.code}`}>
          <DropdownMenuItem asChild>
            <Link to={`/course-files/${offering.id}`}>
              <FolderOpenIcon />
              Open course file
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>
            <UsersIcon />
            Edit lecturers
          </DropdownMenuItem>
        </RowActions>
      </TableCell>
    </TableRow>
  )
}

/**
 * A shared file's row: the section or program code it is for, the file, which opens in a new tab,
 * who uploaded it and when, and its row menu. Without a file it is Missing, with the upload button.
 */
function SharedFileRow({
  name,
  file,
  actionLabel,
  onDelete,
  upload,
}: {
  name: string
  file: SharedFile | undefined
  actionLabel: string
  onDelete: (file: SharedFile) => void
  upload?: ReactNode
}) {
  const uploaded = file && (
    <>
      {file.uploader_name}, <Time value={file.uploaded_at} />
    </>
  )
  return (
    <TableRow>
      <TableCell className="px-4 py-3 whitespace-normal">
        <div className="grid justify-items-start gap-0.5">
          <span className="font-medium">{name}</span>
          {file ? <FileLink file={file} className="font-normal" /> : <SectionStatusBadge status="missing" />}
          {uploaded && <span className="text-muted-foreground text-xs md:hidden">{uploaded}</span>}
        </div>
      </TableCell>
      <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{uploaded ?? <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell className="px-4 py-2 text-right">
        {file ? (
          <RowActions label={actionLabel}>
            <FileMenuItems file={file} />
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(file)}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
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

/**
 * The dialog that adds an offering, or with an offering edits its lecturers. The course is chosen
 * among those the semester does not offer yet. The coordinator is a lecturer too, so they show
 * first among the lecturers and cannot be taken off. A coordinator who is replaced stays a lecturer
 * until taken off. onSubmit gets the coordinator, the other lecturers and the course to add.
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
  onSubmit: (staff: { coordinatorId: string; lecturerIds: string[] }, course: ComboboxOption | null) => Promise<string | null>
}) {
  const named = (lecturer: Offering['lecturers'][number]): ComboboxOption => ({ value: lecturer.lecturer_id, label: lecturer.lecturer_name })
  const [course, setCourse] = useState<ComboboxOption | null>(null)
  const [coordinator, setCoordinator] = useState<ComboboxOption | null>(() => {
    const current = offering?.lecturers.find((lecturer) => lecturer.lecturer_id === offering.coordinator_id)
    return current ? named(current) : null
  })
  const [lecturers, setLecturers] = useState<ComboboxOption[]>(() => (offering?.lecturers ?? []).map(named))
  const others = lecturers.filter((lecturer) => lecturer.value !== coordinator?.value)

  /** Finds the courses the semester does not offer yet whose code or title has the query. */
  async function searchCourses(query: string): Promise<ComboboxOption[]> {
    let request = supabase.from('courses').select('id, code, title, offerings!left(id)').eq('offerings.semester_id', semesterId).is('offerings', null)
    const filter = containsFilter(['code', 'title'], query)
    if (filter) request = request.or(filter)
    const { data, error } = await request.order('code').limit(PICKER_LIMIT)
    if (error) throw error
    return data.map((found) => ({ value: found.id, label: `${found.code} ${found.title}` }))
  }

  return (
    <FormDialog
      title={offering ? `Edit lecturers of ${offering.course.code}` : 'Add an offering'}
      submitLabel={offering ? 'Save' : 'Add offering'}
      onClose={onClose}
      onSubmit={async () => {
        if (!offering && !course) return { field: 'course_id', message: 'Choose a course.' }
        if (!coordinator) return { field: 'coordinator_id', message: 'Choose a coordinator.' }
        return onSubmit({ coordinatorId: coordinator.value, lecturerIds: others.map((lecturer) => lecturer.value) }, course)
      }}
    >
      {!offering && (
        <div className="grid gap-2">
          <Label htmlFor="offering-course">Course</Label>
          <Combobox id="offering-course" name="course_id" value={course} onChange={setCourse} search={searchCourses} placeholder="Choose a course" searchPlaceholder="Search courses" />
          <FieldError name="course_id" />
        </div>
      )}
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

/** Finds the program codes whose code has the query. */
async function searchProgramCodes(query: string): Promise<ComboboxOption[]> {
  let request = supabase.from('program_codes').select('id, code')
  const filter = containsFilter(['code'], query)
  if (filter) request = request.or(filter)
  const { data, error } = await request.order('code').limit(PICKER_LIMIT)
  if (error) throw error
  return data.map((programCode) => ({ value: programCode.id, label: programCode.code }))
}

/** Uploads a PDF as the student timetable of a program code for the semester. */
function UploadTimetableDialog({ semesterId, onClose, onUploaded }: { semesterId: string; onClose: () => void; onUploaded: (name: string) => void }) {
  const [programCode, setProgramCode] = useState<ComboboxOption | null>(null)
  return (
    <FormDialog
      title="Upload a student timetable"
      submitLabel="Upload"
      onClose={onClose}
      onSubmit={async (form) => {
        if (!programCode) return { field: 'program_code_id', message: 'Choose a program code.' }
        const file = form.get('file') as File
        try {
          await uploadFile(supabase, { semesterId, section: STUDENT_TIMETABLE.number, programCodeId: programCode.value }, file)
        } catch (error) {
          return friendlyError(error)
        }
        onUploaded(file.name)
        return null
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="timetable-program-code">Program code</Label>
        <Combobox
          id="timetable-program-code"
          name="program_code_id"
          value={programCode}
          onChange={setProgramCode}
          search={searchProgramCodes}
          placeholder="Choose a program code"
          searchPlaceholder="Search program codes"
        />
        <FieldError name="program_code_id" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="timetable-file">PDF</Label>
        <Input id="timetable-file" name="file" type="file" accept="application/pdf,.pdf" required />
      </div>
    </FormDialog>
  )
}
