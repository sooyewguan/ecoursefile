import { ArrowLeftIcon, BookOpenIcon, CalendarRangeIcon, FolderOpenIcon, PlusIcon, Trash2Icon, UploadIcon, UsersIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useParams } from 'react-router'
import { FormDialog } from '@/components/action-dialogs'
import { DeleteSharedFileDialog, type LinkedSharedFile } from '@/components/delete-shared-file-dialog'
import { NoticeAlert, type Notice } from '@/components/notice'
import { PageHeader, RowActions, TableEmpty, TableSkeleton } from '@/components/page'
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
import type { GlobalRole } from '../roles.ts'
import { SEMESTER_FILE_SECTIONS, type Section } from '../sections.ts'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'
import { uploadFile } from '../uploads.ts'

type Person = { id: string; full_name: string; email: string; active: boolean; user_roles: { role: GlobalRole }[] }

type Course = { id: string; code: string; title: string }

type Offering = {
  id: string
  course_id: string
  coordinator_id: string
  course: { code: string; title: string }
  /** Every lecturer of the offering, the coordinator included. */
  lecturers: { lecturer_id: string }[]
}

/** One of the semester's shared files, and the offerings whose course files link it. */
type SharedFile = LinkedSharedFile & { section: number; uploaded_at: string; uploader_name: string }

/** The page's data. A semester of null means no semester has the id in the address. */
type PageData = {
  semester: { code: string } | null
  offerings: Offering[]
  sharedFiles: SharedFile[]
  courses: Course[]
  people: Person[]
}

/** The dialog that is open, and the offering or shared file it acts on. */
type OpenDialog = { kind: 'add' } | { kind: 'edit'; offering: Offering } | { kind: 'delete-shared'; file: SharedFile; section: Section }

/** Below md the coordinator and lecturers move into the course cell, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'

/** The table's columns: course, coordinator, other lecturers and the row menu. */
const COLUMNS = ['', WIDE, WIDE, '']

/** The shared files table's columns: section and file, uploaded, and the upload button or row menu. */
const SHARED_COLUMNS = ['', WIDE, '']

/**
 * One semester's offerings and shared files. The admin offers courses here, assigns their
 * lecturers, and uploads the semester's Academic Calendar and Appointment Letter, which every
 * course file of the semester links.
 */
export function Semester() {
  const { semesterId } = useParams()
  const [data, setData] = useState<PageData | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  /** The shared-file section whose upload is running. */
  const [uploading, setUploading] = useState<Section | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  /** The shared-file section that the file picked next goes to. */
  const picking = useRef<Section | null>(null)

  const reload = useCallback(async () => {
    const [semester, offerings, sharedFiles, courses, people] = await Promise.all([
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
        .select('id, section, name, uploaded_at, uploader_name, linked_offerings(id, course:courses(code, title))')
        .eq('semester_id', semesterId!)
        .in('section', SEMESTER_FILE_SECTIONS.map((section) => section.number))
        .overrideTypes<SharedFile[], { merge: false }>(),
      supabase.from('courses').select('id, code, title').order('code'),
      supabase.from('profiles').select('id, full_name, email, active, user_roles(role)').order('full_name'),
    ])
    if (semester.error || offerings.error || sharedFiles.error || courses.error || people.error) {
      setNotice({ tone: 'error', text: (semester.error ?? offerings.error ?? sharedFiles.error ?? courses.error ?? people.error)!.message })
      return
    }
    setData({
      semester: semester.data,
      offerings: offerings.data.toSorted((a, b) => a.course.code.localeCompare(b.course.code)),
      sharedFiles: sharedFiles.data,
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
  const nameOf = new Map(people.map((person) => [person.id, person.full_name]))
  const offeredCourseIds = new Set(data?.offerings.map((offering) => offering.course_id))
  const unofferedCourses = (data?.courses ?? []).filter((course) => !offeredCourseIds.has(course.id))

  /** Runs one write, reloads the page data, and returns the write's error message or null. */
  async function write(request: PromiseLike<{ error: { code: string; message: string } | null }>, success: string) {
    const { error } = await request
    await reload()
    if (!error) setNotice({ tone: 'success', text: success })
    if (error?.code === UNIQUE_VIOLATION) return 'This course is already offered in this semester.'
    return error?.message ?? null
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
    setNotice(null)
    try {
      await uploadFile(supabase, { semesterId: semesterId!, section: section.number }, file)
      await reload()
      setNotice({ tone: 'success', text: `Uploaded ${file.name} as the ${section.title}.` })
    } catch (error) {
      await reload()
      setNotice({ tone: 'error', text: `${file.name} was not uploaded. ${error instanceof Error ? error.message : String(error)}` })
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
      {notice && <NoticeAlert notice={notice} />}

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
                  const uploaded = file && `${file.uploader_name}, ${new Date(file.uploaded_at).toLocaleString()}`
                  return (
                    <TableRow key={section.number}>
                      <TableCell className="px-4 py-3 whitespace-normal">
                        <div className="grid gap-0.5">
                          <span className="font-medium">
                            {section.number} {section.title}
                          </span>
                          {file ? (
                            <span className="wrap-anywhere">{file.name}</span>
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
                            <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: 'delete-shared', file, section })}>
                              <Trash2Icon />
                              Delete
                            </DropdownMenuItem>
                          </RowActions>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => pick(section)} disabled={uploading !== null}>
                            {uploading === section ? <Spinner /> : <UploadIcon />}
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
                        <span className="font-medium wrap-anywhere">{offering.course.code}</span>
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
              `Offered ${course?.code} ${course?.title}.`,
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
              `Saved the lecturers of ${dialog.offering.course.code}.`,
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
          subject={`The ${dialog.section.title} of ${data!.semester!.code}`}
          onClose={close}
          onDeleted={async () => {
            await reload()
            setNotice({ tone: 'success', text: `Deleted ${dialog.file.name}.` })
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
              {person.full_name}
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
            const shown = `${person.full_name} ${person.email}`.toLowerCase().includes(needle)
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
                  <span className="truncate">{person.full_name}</span>
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
