import { ArrowLeftIcon, BookOpenIcon, CalendarRangeIcon, FolderOpenIcon, PlusIcon, TagsIcon, Trash2Icon, UploadIcon, UsersIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { FormDialog } from '@/components/action-dialogs'
import { DeleteSharedFileDialog, type LinkedSharedFile } from '@/components/delete-shared-file-dialog'
import { LoadError, PageHeader, RowActions, TableEmpty, TableSkeleton } from '@/components/page'
import { Time } from '@/components/time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { friendlyError } from '../errors.ts'
import type { GlobalRole } from '../roles.ts'
import { PROGRAM_CODE_FILE_SECTION, SEMESTER_FILE_SECTIONS, type Section } from '../sections.ts'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'
import { uploadFile } from '../uploads.ts'

/** display_name is the title and full name, as the app names a person to others. */
type Person = { id: string; display_name: string; email: string; active: boolean; user_roles: { role: GlobalRole }[] }

type Course = { id: string; code: string; title: string }

type ProgramCode = { id: string; code: string }

type Offering = {
  id: string
  course_id: string
  coordinator_id: string
  course: { code: string; title: string }
  /** Every lecturer of the offering, the coordinator included. */
  lecturers: { lecturer_id: string }[]
}

/**
 * One of the semester's shared files, and the offerings whose course files link it. A student
 * timetable has the program code it belongs to.
 */
type SharedFile = LinkedSharedFile & { section: number; program_code_id: string | null; uploaded_at: string; uploader_name: string }

/** The page's data. A semester of null means no semester has the id in the address. */
type PageData = {
  semester: { code: string } | null
  offerings: Offering[]
  sharedFiles: SharedFile[]
  programCodes: ProgramCode[]
  courses: Course[]
  people: Person[]
}

/** Where an upload goes: a semester file's section, or the student timetable of a program code. */
type UploadTarget = { section: Section; programCode: ProgramCode | null }

/** The dialog that is open, and the offering or shared file it acts on. subject names the shared file in a sentence. */
type OpenDialog =
  | { kind: 'add' }
  | { kind: 'edit'; offering: Offering }
  | { kind: 'delete-shared'; file: SharedFile; section: Section; subject: string }

const STUDENT_TIMETABLE = PROGRAM_CODE_FILE_SECTION

/** Below md the coordinator and lecturers move into the course cell, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'

/** The table's columns: course, coordinator, other lecturers and the row menu. */
const COLUMNS = ['', WIDE, WIDE, '']

/** The shared files table's columns: section and file, uploaded, and the upload button or row menu. */
const SHARED_COLUMNS = ['', WIDE, '']

/**
 * One semester's offerings and shared files. The admin offers courses here, assigns their
 * lecturers, and uploads the semester's Academic Calendar and Appointment Letter, which every
 * course file of the semester links, and a Student Timetable for each program code, which every
 * course file that ticks the code links.
 */
export function Semester() {
  const { semesterId } = useParams()
  const [data, setData] = useState<PageData | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  /** Where the running upload goes. */
  const [uploading, setUploading] = useState<UploadTarget | null>(null)
  const [codeFilter, setCodeFilter] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  /** Where the file picked next goes. */
  const picking = useRef<UploadTarget | null>(null)

  const reload = useCallback(async () => {
    const [semester, offerings, sharedFiles, programCodes, courses, people] = await Promise.all([
      supabase.from('semesters').select('code').eq('id', semesterId!).maybeSingle(),
      supabase
        .from('offerings')
        .select(
          'id, course_id, coordinator_id, course:courses(code, title), lecturers:offering_lecturers!offering_lecturers_offering_id_fkey(lecturer_id)',
        )
        .eq('semester_id', semesterId!)
        .overrideTypes<Offering[], { merge: false }>(),
      supabase
        .from('files')
        .select('id, section, program_code_id, name, uploaded_at, uploader_name, linked_offerings(id, course:courses(code, title))')
        .eq('semester_id', semesterId!)
        .in('section', [...SEMESTER_FILE_SECTIONS, STUDENT_TIMETABLE].map((section) => section.number))
        .overrideTypes<SharedFile[], { merge: false }>(),
      supabase.from('program_codes').select('id, code').order('code'),
      supabase.from('courses').select('id, code, title').order('code'),
      supabase.from('profiles').select('id, display_name, email, active, user_roles(role)').order('full_name'),
    ])
    if (semester.error || offerings.error || sharedFiles.error || programCodes.error || courses.error || people.error) {
      setLoadFailed(true)
      return
    }
    setLoadFailed(false)
    setData({
      semester: semester.data,
      offerings: offerings.data.toSorted((a, b) => a.course.code.localeCompare(b.course.code)),
      sharedFiles: sharedFiles.data,
      programCodes: programCodes.data,
      courses: courses.data,
      people: people.data,
    })
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

  if (data && !data.semester) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Semester" description="Semesters are listed on the Semesters page." action={backLink} />
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableBody>
              <TableEmpty columns={1} icon={CalendarRangeIcon} title="Semester not found" description="No semester has this address." />
            </TableBody>
          </Table>
        </Card>
      </div>
    )
  }

  const people = data?.people ?? []
  const nameOf = new Map(people.map((person) => [person.id, person.display_name]))
  const offeredCourseIds = new Set(data?.offerings.map((offering) => offering.course_id))
  const unofferedCourses = (data?.courses ?? []).filter((course) => !offeredCourseIds.has(course.id))
  const shownCodes = (data?.programCodes ?? []).filter((programCode) => programCode.code.toLowerCase().includes(codeFilter.trim().toLowerCase()))

  /** Runs one write, reloads the page data, and returns why it failed, or shows success and returns null. */
  async function write(request: PromiseLike<{ error: unknown }>, success: string) {
    const { error } = await request
    await reload()
    if (error) return friendlyError(error, { codes: { [UNIQUE_VIOLATION]: 'This course is already offered in this semester.' } })
    toast.success(success)
    return null
  }

  function close() {
    setDialog(null)
  }

  function pick(target: UploadTarget) {
    picking.current = target
    picker.current?.click()
  }

  /** Whether the running upload goes to the section, and for a student timetable to the program code. */
  function isUploading(section: Section, programCode: ProgramCode | null = null) {
    return uploading?.section === section && uploading.programCode?.id === programCode?.id
  }

  /** Uploads the picked PDF as the semester's file of the section or program code, then reports the outcome. */
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    const target = picking.current
    if (!file || !target) return
    const { section, programCode } = target
    setUploading(target)
    try {
      await uploadFile(supabase, { semesterId: semesterId!, section: section.number, ...(programCode && { programCodeId: programCode.id }) }, file)
      await reload()
      toast.success(`Uploaded ${file.name}`)
    } catch (error) {
      await reload()
      toast.error(friendlyError(error))
    }
    setUploading(null)
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={data ? `Semester ${data.semester!.code}` : 'Semester'}
        description="Offer catalog courses in this semester. Each offering has one coordinator, who also counts as a lecturer."
        action={
          <div className="flex flex-wrap gap-2">
            {backLink}
            <Button onClick={() => setDialog({ kind: 'add' })} disabled={!data}>
              <PlusIcon />
              Add offering
            </Button>
          </div>
        }
      />
      {loadFailed && <LoadError title="Couldn't load this semester" onRetry={reload} />}

      <section aria-labelledby="shared-files-heading" className="grid gap-3">
        <div className="grid gap-1">
          <h2 id="shared-files-heading" className="text-lg font-semibold tracking-tight">
            Shared files
          </h2>
          <p className="text-muted-foreground text-sm">
            Every course file of this semester links these files. Upload one PDF of up to 20 MB for each. To replace one, delete it first.
          </p>
        </div>
        <input ref={picker} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void upload(event)} />
        <Card className="gap-0 overflow-hidden py-0">
          <Table aria-label="Shared files">
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
              {!data ? (
                <TableSkeleton columns={SHARED_COLUMNS} rows={SEMESTER_FILE_SECTIONS.length} />
              ) : (
                SEMESTER_FILE_SECTIONS.map((section) => {
                  const file = data.sharedFiles.find((shared) => shared.section === section.number)
                  const uploaded = file && (
                    <>
                      {file.uploader_name}, <Time value={file.uploaded_at} />
                    </>
                  )
                  return (
                    <TableRow key={section.number}>
                      <TableCell className="px-4 py-3 whitespace-normal">
                        <div className="grid gap-0.5">
                          <span className="font-medium">
                            {section.number} {section.title}
                          </span>
                          {file ? (
                            <span>{file.name}</span>
                          ) : (
                            <span className="text-muted-foreground">Not uploaded. Section {section.number} is missing in every course file.</span>
                          )}
                          {uploaded && <span className="text-muted-foreground text-xs md:hidden">{uploaded}</span>}
                        </div>
                      </TableCell>
                      <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{uploaded}</TableCell>
                      <TableCell className="px-4 py-2 text-right">
                        {file ? (
                          <RowActions label={`Actions for ${section.title}`}>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setDialog({ kind: 'delete-shared', file, section, subject: `The ${section.title} of ${data.semester!.code}` })}
                            >
                              <Trash2Icon />
                              Delete
                            </DropdownMenuItem>
                          </RowActions>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => pick({ section, programCode: null })} disabled={uploading !== null}>
                            {isUploading(section) ? <Spinner /> : <UploadIcon />}
                            Upload PDF
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </section>

      <section aria-labelledby="student-timetables-heading" className="grid gap-3">
        <div className="grid gap-1">
          <h2 id="student-timetables-heading" className="text-lg font-semibold tracking-tight">
            Student timetables
          </h2>
          <p className="text-muted-foreground text-sm">
            Upload one PDF of up to 20 MB for each program code with students this semester. Staff tick the codes that take each course in its section{' '}
            {STUDENT_TIMETABLE.number}, which links their timetables. To replace one, delete it first.
          </p>
        </div>
        {(data?.programCodes.length ?? 0) > 0 && (
          <Input
            type="search"
            aria-label="Filter program codes"
            placeholder="Filter program codes"
            className="max-w-sm"
            value={codeFilter}
            onChange={(event) => setCodeFilter(event.target.value)}
          />
        )}
        <Card className="gap-0 overflow-hidden py-0">
          <Table aria-label="Student timetables">
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
              {!data ? (
                <TableSkeleton columns={SHARED_COLUMNS} />
              ) : shownCodes.length === 0 ? (
                <TableEmpty
                  columns={SHARED_COLUMNS.length}
                  icon={TagsIcon}
                  title={data.programCodes.length === 0 ? 'No program codes yet' : 'No program code matches'}
                  description={
                    data.programCodes.length === 0
                      ? 'Add program codes on the Program codes page, then upload their timetables here.'
                      : 'Change the filter to see other program codes.'
                  }
                />
              ) : (
                shownCodes.map((programCode) => {
                    const file = data.sharedFiles.find((shared) => shared.program_code_id === programCode.id)
                    const uploaded = file && (
                    <>
                      {file.uploader_name}, <Time value={file.uploaded_at} />
                    </>
                  )
                    return (
                      <TableRow key={programCode.id}>
                        <TableCell className="px-4 py-3 whitespace-normal">
                          <div className="grid gap-0.5">
                            <span className="font-medium">{programCode.code}</span>
                            {file ? (
                              <span>{file.name}</span>
                            ) : (
                              <span className="text-muted-foreground">Not uploaded. Staff cannot tick this code yet.</span>
                            )}
                            {uploaded && <span className="text-muted-foreground text-xs md:hidden">{uploaded}</span>}
                          </div>
                        </TableCell>
                        <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{uploaded}</TableCell>
                        <TableCell className="px-4 py-2 text-right">
                          {file ? (
                            <RowActions label={`Actions for the student timetable of ${programCode.code}`}>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() =>
                                  setDialog({
                                    kind: 'delete-shared',
                                    file,
                                    section: STUDENT_TIMETABLE,
                                    subject: `The student timetable of ${programCode.code} for ${data.semester!.code}`,
                                  })
                                }
                              >
                                <Trash2Icon />
                                Delete
                              </DropdownMenuItem>
                            </RowActions>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => pick({ section: STUDENT_TIMETABLE, programCode })}
                              disabled={uploading !== null}
                            >
                              {isUploading(STUDENT_TIMETABLE, programCode) ? <Spinner /> : <UploadIcon />}
                              Upload PDF
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
              )}
            </TableBody>
          </Table>
        </Card>
      </section>

      <Card className="gap-0 overflow-hidden py-0">
        <Table aria-label="Offerings">
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
            {!data ? (
              <TableSkeleton columns={COLUMNS} />
            ) : data.offerings.length === 0 ? (
              <TableEmpty
                columns={COLUMNS.length}
                icon={BookOpenIcon}
                title="No offerings yet"
                description="Add an offering for each catalog course that runs this semester."
              />
            ) : (
              data.offerings.map((offering) => {
                const coordinator = nameOf.get(offering.coordinator_id)
                const others = offering.lecturers
                  .filter((lecturer) => lecturer.lecturer_id !== offering.coordinator_id)
                  .map((lecturer) => nameOf.get(lecturer.lecturer_id))
                  .join(', ')
                return (
                  <TableRow key={offering.id}>
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <div className="grid gap-0.5">
                        <span className="font-medium">{offering.course.code}</span>
                        <span>{offering.course.title}</span>
                        <div className="text-muted-foreground mt-1 grid gap-0.5 text-xs md:hidden">
                          <span>Coordinator: {coordinator}</span>
                          {others && <span>Lecturers: {others}</span>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{coordinator}</TableCell>
                    <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>
                      {others || <span className="text-muted-foreground">None</span>}
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right">
                      <RowActions label={`Actions for ${offering.course.code}`}>
                        <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', offering })}>
                          <UsersIcon />
                          Edit lecturers
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link to={`/course-files/${offering.id}`}>
                            <FolderOpenIcon />
                            Open course file
                          </Link>
                        </DropdownMenuItem>
                      </RowActions>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {dialog?.kind === 'add' && (
        <FormDialog
          title="Add an offering"
          description="The offering's sections 10 to 16 start as its course type sets them now. Later changes to the type do not affect it."
          submitLabel="Add offering"
          submitDisabled={unofferedCourses.length === 0}
          onClose={close}
          onSubmit={(form) => {
            const course = unofferedCourses.find((c) => c.id === form.get('course_id'))
            return write(
              supabase.rpc('create_offering', {
                semester_id: semesterId,
                course_id: form.get('course_id'),
                coordinator_id: form.get('coordinator_id'),
                lecturer_ids: form.getAll('lecturer_ids'),
              }),
              `Added ${course?.code}`,
            )
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="offering-course">Course</Label>
            <NativeSelect id="offering-course" name="course_id" defaultValue="" required>
              <NativeSelectOption value="" disabled>
                {unofferedCourses.length === 0 ? 'Every catalog course is already offered' : 'Choose a course'}
              </NativeSelectOption>
              {unofferedCourses.map((course) => (
                <NativeSelectOption key={course.id} value={course.id}>
                  {course.code} {course.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <StaffFields people={people} />
        </FormDialog>
      )}

      {dialog?.kind === 'edit' && (
        <FormDialog
          title={`Edit lecturers of ${dialog.offering.course.code}`}
          description="Choose the coordinator and the other lecturers who teach this offering."
          submitLabel="Save"
          onClose={close}
          onSubmit={(form) =>
            write(
              supabase.rpc('set_offering_lecturers', {
                offering_id: dialog.offering.id,
                coordinator_id: form.get('coordinator_id'),
                lecturer_ids: form.getAll('lecturer_ids'),
              }),
              `Saved ${dialog.offering.course.code}`,
            )
          }
        >
          <StaffFields people={people} offering={dialog.offering} />
        </FormDialog>
      )}

      {dialog?.kind === 'delete-shared' && (
        <DeleteSharedFileDialog
          file={dialog.file}
          section={dialog.section}
          subject={dialog.subject}
          onClose={close}
          onDeleted={async () => {
            await reload()
            toast.success(`Deleted ${dialog.file.name}`)
          }}
        />
      )}
    </div>
  )
}

/**
 * The coordinator and a checkbox per lecturer. Active users with the lecturer role are listed,
 * and so is anyone the offering already has. The coordinator is always ticked, because the
 * coordinator counts as a lecturer.
 */
function StaffFields({ people, offering }: { people: Person[]; offering?: Offering }) {
  const current = new Set(offering?.lecturers.map((lecturer) => lecturer.lecturer_id))
  const candidates = people.filter(
    (person) => current.has(person.id) || (person.active && person.user_roles.some((r) => r.role === 'lecturer')),
  )
  const [coordinatorId, setCoordinatorId] = useState(offering?.coordinator_id ?? '')
  const [lecturerIds, setLecturerIds] = useState(current)
  const [filter, setFilter] = useState('')
  const needle = filter.trim().toLowerCase()

  function toggle(id: string, checked: boolean) {
    setLecturerIds((ids) => {
      const next = new Set(ids)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="offering-coordinator">Coordinator</Label>
        <NativeSelect
          id="offering-coordinator"
          name="coordinator_id"
          value={coordinatorId}
          onChange={(event) => setCoordinatorId(event.target.value)}
          required
        >
          <NativeSelectOption value="" disabled>
            Choose a coordinator
          </NativeSelectOption>
          {candidates.map((person) => (
            <NativeSelectOption key={person.id} value={person.id}>
              {person.display_name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <p className="text-muted-foreground text-sm">Only active users with the lecturer role are listed.</p>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Lecturers</legend>
        <Input
          type="search"
          aria-label="Filter lecturers"
          placeholder="Filter by name or email"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <div className="grid max-h-64 gap-1 overflow-y-auto rounded-md border p-1">
          {candidates.map((person) => {
            const isCoordinator = person.id === coordinatorId
            const shown = `${person.display_name} ${person.email}`.toLowerCase().includes(needle)
            return (
              // Rows that the filter hides stay in the form, so their ticks are still sent.
              <Label
                key={person.id}
                htmlFor={`offering-lecturer-${person.id}`}
                className={cn('hover:bg-accent/50 rounded-md px-2 py-2 leading-snug font-normal', !shown && 'hidden')}
              >
                <Checkbox
                  id={`offering-lecturer-${person.id}`}
                  name="lecturer_ids"
                  value={person.id}
                  checked={isCoordinator || lecturerIds.has(person.id)}
                  disabled={isCoordinator}
                  onCheckedChange={(checked) => toggle(person.id, checked === true)}
                />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate">{person.display_name}</span>
                  <span className="text-muted-foreground truncate text-xs">{person.email}</span>
                </span>
                {isCoordinator && <Badge variant="secondary">Coordinator</Badge>}
              </Label>
            )
          })}
        </div>
      </fieldset>
    </>
  )
}
