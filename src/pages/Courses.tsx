import { BookOpenIcon, PencilIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { FormDialog, type Action } from '@/components/action-dialogs'
import { Combobox, type ComboboxOption } from '@/components/combobox'
import { FieldError } from '@/components/form-errors'
import { PageHeader } from '@/components/page'
import { usePagedList } from '@/components/paged-list'
import { isEmptyList, ListEmpty, ListSearch, PagedTableBody, TablePager } from '@/components/paged-table'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  courseTypeOption,
  departmentLabel,
  departmentOption,
  matching,
  searchCourseTypes,
  searchDepartments,
  type CourseType,
  type Department,
} from '../catalog.ts'
import { friendlyError } from '../errors.ts'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'

type Course = { id: string; code: string; title: string; department: Department; course_type: CourseType }

/** The columns a course form writes. */
type CourseValues = { code: string; title: string; department_id: string; course_type_id: string }

/** The dialog that is open, and the course it acts on. */
type OpenDialog = { kind: 'add' } | { kind: 'edit'; course: Course }

/** Below md the department and course type move into the course cell, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'

/** The table's columns: course, department, course type and the Edit button. */
const COLUMNS = ['', WIDE, WIDE, '']

export function Courses() {
  const list = usePagedList<Course>(({ from, to }, search) =>
    matching(
      supabase
        .from('courses')
        .select('id, code, title, department:departments(id, code, name), course_type:course_types(id, name)', { count: 'exact' }),
      ['code', 'title'],
      search,
    )
      .order('code')
      .range(from, to)
      .overrideTypes<Course[], { merge: false }>(),
  )
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const empty = isEmptyList(list)

  /** Runs one write, reloads the list, and returns why it failed or null. */
  async function write(request: PromiseLike<{ error: { code: string } | null }>, code: string, success: string) {
    const { error } = await request
    list.retry()
    if (error?.code === UNIQUE_VIOLATION) return { field: 'code', message: `A course with the code ${code} already exists.` }
    if (error) return friendlyError(error)
    toast.success(success)
    return null
  }

  function close() {
    setDialog(null)
  }

  const addButton = (
    <Button onClick={() => setDialog({ kind: 'add' })}>
      <PlusIcon />
      Add course
    </Button>
  )

  return (
    <div className="grid gap-6">
      <PageHeader title="Courses" action={!empty && addButton} />

      <div className="grid gap-3">
        {!empty && <ListSearch list={list} label="Search courses" />}
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader className="bg-muted/50 max-md:hidden">
              <TableRow>
                <TableHead className="px-4">Course</TableHead>
                <TableHead className={cn('px-4', WIDE)}>Department</TableHead>
                <TableHead className={cn('px-4', WIDE)}>Course type</TableHead>
                <TableHead className="w-24 px-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <PagedTableBody
              list={list}
              columns={COLUMNS}
              loadError="Couldn't load courses"
              empty={<ListEmpty list={list} columns={COLUMNS.length} icon={BookOpenIcon} noun="courses" addButton={addButton} />}
            >
              {(course) => (
                <TableRow key={course.id}>
                  <TableCell className="px-4 py-3 whitespace-normal">
                    <div className="grid gap-0.5">
                      <span className="font-medium">{course.code}</span>
                      <span>{course.title}</span>
                      <div className="text-muted-foreground mt-1 grid gap-0.5 text-xs md:hidden">
                        <span>{departmentLabel(course.department)}</span>
                        <span>{course.course_type.name}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{departmentLabel(course.department)}</TableCell>
                  <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{course.course_type.name}</TableCell>
                  <TableCell className="px-4 py-2 text-right align-top md:align-middle">
                    <Button variant="ghost" size="sm" aria-label={`Edit ${course.code}`} onClick={() => setDialog({ kind: 'edit', course })}>
                      <PencilIcon />
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              )}
            </PagedTableBody>
          </Table>
          <TablePager list={list} />
        </Card>
      </div>

      {dialog?.kind === 'add' && (
        <CourseDialog
          onClose={close}
          onSave={(values) => write(supabase.from('courses').insert(values), values.code, `Added ${values.code}`)}
        />
      )}

      {dialog?.kind === 'edit' && (
        <CourseDialog
          course={dialog.course}
          onClose={close}
          onSave={(values) =>
            write(supabase.from('courses').update(values).eq('id', dialog.course.id), values.code, `Saved ${values.code}`)
          }
        />
      )}
    </div>
  )
}

/** The form that adds a course, or edits one. The department and course type pickers search as the user types. */
function CourseDialog({ course, onSave, onClose }: { course?: Course; onSave: Action<[CourseValues]>; onClose: () => void }) {
  const [department, setDepartment] = useState<ComboboxOption | null>(course ? departmentOption(course.department) : null)
  const [courseType, setCourseType] = useState<ComboboxOption | null>(course ? courseTypeOption(course.course_type) : null)

  return (
    <FormDialog
      title={course ? `Edit ${course.code}` : 'Add a course'}
      submitLabel={course ? 'Save' : 'Add course'}
      onClose={onClose}
      onSubmit={async (form) => {
        if (!department) return { field: 'department_id', message: 'Choose a department.' }
        if (!courseType) return { field: 'course_type_id', message: 'Choose a course type.' }
        return onSave({
          code: String(form.get('code')),
          title: String(form.get('title')),
          department_id: department.value,
          course_type_id: courseType.value,
        })
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="course-code">Code</Label>
        <Input id="course-code" name="code" defaultValue={course?.code} autoComplete="off" required />
        <FieldError name="code" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="course-title">Title</Label>
        <Input id="course-title" name="title" defaultValue={course?.title} autoComplete="off" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="course-department">Department</Label>
        <Combobox
          id="course-department"
          name="department_id"
          value={department}
          onChange={setDepartment}
          search={searchDepartments}
          placeholder="Choose a department"
          searchPlaceholder="Search departments"
        />
        <FieldError name="department_id" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="course-type">Course type</Label>
        <Combobox
          id="course-type"
          name="course_type_id"
          value={courseType}
          onChange={setCourseType}
          search={searchCourseTypes}
          placeholder="Choose a course type"
          searchPlaceholder="Search course types"
        />
        {course && <p className="text-muted-foreground text-sm">A new course type applies only to offerings created afterwards.</p>}
        <FieldError name="course_type_id" />
      </div>
    </FormDialog>
  )
}
