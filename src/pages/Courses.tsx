import { BookOpenIcon, PencilIcon, PlusIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FormDialog } from '@/components/action-dialogs'
import { FieldError } from '@/components/form-errors'
import { PageHeader, RowActions, TableEmpty, TableLoadError, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { friendlyError } from '../errors.ts'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'

type Course = { id: string; code: string; title: string; department_id: string; course_type_id: string }

type Department = { id: string; code: string; name: string }

type CourseType = { id: string; name: string }

type PageData = { courses: Course[]; departments: Department[]; courseTypes: CourseType[] }

/** The dialog that is open, and the course it acts on. */
type OpenDialog = { kind: 'add' } | { kind: 'edit'; course: Course }

/** Below md the department and course type move into the course cell, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'

/** The table's columns: course, department, course type and the row menu. */
const COLUMNS = ['', WIDE, WIDE, '']

export function Courses() {
  const [data, setData] = useState<PageData | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)

  const reload = useCallback(async () => {
    const [courses, departments, courseTypes] = await Promise.all([
      supabase.from('courses').select('id, code, title, department_id, course_type_id').order('code'),
      supabase.from('departments').select('id, code, name').order('code'),
      supabase.from('course_types').select('id, name').order('name'),
    ])
    setLoadFailed(Boolean(courses.error || departments.error || courseTypes.error))
    if (courses.error || departments.error || courseTypes.error) return
    setData({ courses: courses.data, departments: departments.data, courseTypes: courseTypes.data })
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const departments = data?.departments ?? []
  const courseTypes = data?.courseTypes ?? []
  const departmentName = new Map(departments.map((d) => [d.id, `${d.code} ${d.name}`]))
  const courseTypeName = new Map(courseTypes.map((t) => [t.id, t.name]))

  /** Runs one write, reloads the page data, and returns why it failed or null. */
  async function write(request: PromiseLike<{ error: { code: string } | null }>, code: string, success: string) {
    const { error } = await request
    await reload()
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
      <PageHeader title="Courses" action={addButton} />

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-4">Course</TableHead>
              <TableHead className={cn('px-4', WIDE)}>Department</TableHead>
              <TableHead className={cn('px-4', WIDE)}>Course type</TableHead>
              <TableHead className="w-14 px-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadFailed ? (
              <TableLoadError columns={COLUMNS.length} title="Couldn't load courses" onRetry={reload} />
            ) : !data ? (
              <TableSkeleton columns={COLUMNS} />
            ) : data.courses.length === 0 ? (
              <TableEmpty columns={COLUMNS.length} icon={BookOpenIcon} title="No courses yet" action={addButton} />
            ) : (
              data.courses.map((course) => {
                const department = departmentName.get(course.department_id)
                const courseType = courseTypeName.get(course.course_type_id)
                return (
                  <TableRow key={course.id}>
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <div className="grid gap-0.5">
                        <span className="font-medium">{course.code}</span>
                        <span>{course.title}</span>
                        <div className="text-muted-foreground mt-1 grid gap-0.5 text-xs md:hidden">
                          <span>{department}</span>
                          <span>{courseType}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{department}</TableCell>
                    <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{courseType}</TableCell>
                    <TableCell className="px-4 py-2 text-right">
                      <RowActions label={`Actions for ${course.code}`}>
                        <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', course })}>
                          <PencilIcon />
                          Edit
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
          title="Add a course"
          submitLabel="Add course"
          onClose={close}
          onSubmit={(form) => {
            const values = courseValues(form)
            return write(supabase.from('courses').insert(values), values.code, `Added ${values.code}`)
          }}
        >
          <CourseFields departments={departments} courseTypes={courseTypes} />
        </FormDialog>
      )}

      {dialog?.kind === 'edit' && (
        <FormDialog
          title={`Edit ${dialog.course.code}`}
          submitLabel="Save"
          onClose={close}
          onSubmit={(form) => {
            const values = courseValues(form)
            return write(
              supabase.from('courses').update(values).eq('id', dialog.course.id),
              values.code,
              `Saved ${values.code}`,
            )
          }}
        >
          <CourseFields course={dialog.course} departments={departments} courseTypes={courseTypes} />
        </FormDialog>
      )}
    </div>
  )
}

function courseValues(form: FormData) {
  return {
    code: String(form.get('code')),
    title: String(form.get('title')),
    department_id: String(form.get('department_id')),
    course_type_id: String(form.get('course_type_id')),
  }
}

function CourseFields({
  course,
  departments,
  courseTypes,
}: {
  course?: Course
  departments: Department[]
  courseTypes: CourseType[]
}) {
  return (
    <>
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
        <NativeSelect id="course-department" name="department_id" defaultValue={course?.department_id ?? ''} required>
          <NativeSelectOption value="" disabled>
            Choose a department
          </NativeSelectOption>
          {departments.map((d) => (
            <NativeSelectOption key={d.id} value={d.id}>
              {d.code} {d.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="course-type">Course type</Label>
        <NativeSelect
          id="course-type"
          name="course_type_id"
          defaultValue={course?.course_type_id ?? ''}
          aria-describedby={course ? 'course-type-hint' : undefined}
          required
        >
          <NativeSelectOption value="" disabled>
            Choose a course type
          </NativeSelectOption>
          {courseTypes.map((t) => (
            <NativeSelectOption key={t.id} value={t.id}>
              {t.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {course && (
          <p id="course-type-hint" className="text-muted-foreground text-sm">
            A new course type applies only to offerings created afterwards.
          </p>
        )}
      </div>
    </>
  )
}
