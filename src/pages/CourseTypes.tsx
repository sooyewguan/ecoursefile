import { LayersIcon, PencilIcon, PlusIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FormDialog } from '@/components/action-dialogs'
import { FieldError } from '@/components/form-errors'
import { PageHeader, RowActions, TableEmpty, TableLoadError, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SWITCHABLE_SECTIONS } from '../sections.ts'
import { friendlyError } from '../errors.ts'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'

type CourseType = { id: string; name: string; sections_on: number[] }

/** The dialog that is open, and the course type it acts on. */
type OpenDialog = { kind: 'add' } | { kind: 'edit'; courseType: CourseType }

/** The table's columns: name, the sections on by default and the row menu. */
const COLUMNS = ['', '', '']

export function CourseTypes() {
  const [courseTypes, setCourseTypes] = useState<CourseType[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('course_types').select('id, name, sections_on').order('name')
    setLoadFailed(error !== null)
    if (data) setCourseTypes(data)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Runs one write, reloads the list, and returns why it failed or null. */
  async function write(request: PromiseLike<{ error: { code: string } | null }>, name: string, success: string) {
    const { error } = await request
    await reload()
    if (error?.code === UNIQUE_VIOLATION) return { field: 'name', message: `A course type named ${name} already exists.` }
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
      Add course type
    </Button>
  )

  return (
    <div className="grid gap-6">
      <PageHeader title="Course types" action={addButton} />

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-1/3 px-4">Name</TableHead>
              <TableHead className="px-4">On by default</TableHead>
              <TableHead className="w-14 px-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadFailed ? (
              <TableLoadError columns={COLUMNS.length} title="Couldn't load course types" onRetry={reload} />
            ) : !courseTypes ? (
              <TableSkeleton columns={COLUMNS} />
            ) : courseTypes.length === 0 ? (
              <TableEmpty columns={COLUMNS.length} icon={LayersIcon} title="No course types yet" action={addButton} />
            ) : (
              courseTypes.map((courseType) => (
                <TableRow key={courseType.id}>
                  <TableCell className="px-4 py-3 font-medium whitespace-normal">{courseType.name}</TableCell>
                  <TableCell className="px-4 py-3 whitespace-normal">
                    <SectionBadges sectionsOn={courseType.sections_on} />
                  </TableCell>
                  <TableCell className="px-4 py-2 text-right">
                    <RowActions label={`Actions for ${courseType.name}`}>
                      <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', courseType })}>
                        <PencilIcon />
                        Edit
                      </DropdownMenuItem>
                    </RowActions>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {dialog?.kind === 'add' && (
        <FormDialog
          title="Add a course type"
          submitLabel="Add course type"
          onClose={close}
          onSubmit={(form) => {
            const values = courseTypeValues(form)
            return write(supabase.from('course_types').insert(values), values.name, `Added ${values.name}`)
          }}
        >
          <CourseTypeFields />
        </FormDialog>
      )}

      {dialog?.kind === 'edit' && (
        <FormDialog
          title={`Edit ${dialog.courseType.name}`}
          description="Changes apply only to offerings created afterwards."
          submitLabel="Save"
          onClose={close}
          onSubmit={(form) => {
            const values = courseTypeValues(form)
            return write(
              supabase.from('course_types').update(values).eq('id', dialog.courseType.id),
              values.name,
              `Saved ${values.name}`,
            )
          }}
        >
          <CourseTypeFields courseType={dialog.courseType} />
        </FormDialog>
      )}
    </div>
  )
}

function courseTypeValues(form: FormData) {
  return { name: String(form.get('name')), sections_on: form.getAll('sections_on').map(Number) }
}

function SectionBadges({ sectionsOn }: { sectionsOn: number[] }) {
  const on = SWITCHABLE_SECTIONS.filter((section) => sectionsOn.includes(section.number))
  if (on.length === 0) return <span className="text-muted-foreground">All off</span>
  return (
    <ul aria-label="Sections on by default" className="flex flex-wrap gap-1">
      {on.map((section) => (
        <Badge asChild key={section.number} variant="secondary">
          <li>
            {section.number} {section.title}
          </li>
        </Badge>
      ))}
    </ul>
  )
}

/** The name and a checkbox for each switchable section. A new course type starts with every section on. */
function CourseTypeFields({ courseType }: { courseType?: CourseType }) {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="course-type-name">Name</Label>
        <Input id="course-type-name" name="name" defaultValue={courseType?.name} autoComplete="off" required />
        <FieldError name="name" />
      </div>
      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-medium">On by default</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SWITCHABLE_SECTIONS.map((section) => (
            <Label
              key={section.number}
              htmlFor={`course-type-section-${section.number}`}
              className="hover:bg-accent/50 has-[[aria-checked=true]]:border-primary/40 has-[[aria-checked=true]]:bg-accent/60 rounded-md border px-2.5 py-2.5 leading-snug font-normal"
            >
              <Checkbox
                id={`course-type-section-${section.number}`}
                name="sections_on"
                value={section.number}
                defaultChecked={courseType ? courseType.sections_on.includes(section.number) : true}
              />
              {section.number} {section.title}
            </Label>
          ))}
        </div>
      </fieldset>
    </>
  )
}
