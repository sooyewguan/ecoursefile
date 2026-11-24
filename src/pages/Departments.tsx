import { Building2Icon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog, FormDialog } from '@/components/action-dialogs'
import { FieldError } from '@/components/form-errors'
import { PageHeader, RowActions, TableCard } from '@/components/page'
import { usePagedList } from '@/components/paged-list'
import { isEmptyList, ListEmpty, ListToolbar, PagedTableBody, TablePager } from '@/components/paged-table'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn, plural } from '@/lib/utils'
import { matching, type Department } from '../catalog.ts'
import { friendlyError } from '../errors.ts'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'

/** The dialog that is open, and the department it acts on. */
type OpenDialog =
  | { kind: 'add' }
  | { kind: 'edit'; department: Department }
  | { kind: 'delete'; department: Department }

/** Below md the name moves under the code, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'

/** The table's columns: code, name and the row menu. */
const COLUMNS = ['', WIDE, '']

export function Departments() {
  const list = usePagedList<Department>(({ from, to }, search) =>
    matching(supabase.from('departments').select('id, code, name', { count: 'exact' }), ['code', 'name'], search)
      .order('code')
      .range(from, to),
  )
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const empty = isEmptyList(list)

  /** Saves a department's code and name, reloads the list, and returns why it failed or null. */
  async function save(request: PromiseLike<{ error: { code: string } | null }>, code: string, success: string) {
    const { error } = await request
    list.retry()
    if (error?.code === UNIQUE_VIOLATION) return { field: 'code', message: `A department with the code ${code} already exists.` }
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
      Add department
    </Button>
  )

  return (
    <div className="grid gap-6">
      <PageHeader title="Departments" action={!empty && addButton} />

      <div className="grid gap-3">
        {!empty && <ListToolbar list={list} label="Search departments" noun="department" />}
        <TableCard>
          <Table>
            <TableHeader className="max-md:hidden">
              <TableRow>
                <TableHead className="w-40 px-4">Code</TableHead>
                <TableHead className={cn('px-4', WIDE)}>Name</TableHead>
                <TableHead className="w-14 px-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <PagedTableBody
              list={list}
              columns={COLUMNS}
              loadError="Couldn't load departments"
              empty={<ListEmpty list={list} columns={COLUMNS.length} icon={Building2Icon} noun="departments" addButton={addButton} />}
            >
              {(department) => (
                <TableRow key={department.id}>
                  <TableCell className="px-4 py-3 whitespace-normal">
                    <div className="grid gap-0.5">
                      <span className="font-medium">{department.code}</span>
                      <span className="md:hidden">{department.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{department.name}</TableCell>
                  <TableCell className="px-4 py-2 text-right">
                    <RowActions label={`Actions for ${department.code}`}>
                      <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', department })}>
                        <PencilIcon />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: 'delete', department })}>
                        <Trash2Icon />
                        Delete
                      </DropdownMenuItem>
                    </RowActions>
                  </TableCell>
                </TableRow>
              )}
            </PagedTableBody>
          </Table>
          <TablePager list={list} />
        </TableCard>
      </div>

      {dialog?.kind === 'add' && (
        <FormDialog
          title="Add a department"
          submitLabel="Add department"
          onClose={close}
          onSubmit={(form) => {
            const values = departmentValues(form)
            return save(supabase.from('departments').insert(values), values.code, `Added ${values.code}`)
          }}
        >
          <DepartmentFields />
        </FormDialog>
      )}

      {dialog?.kind === 'edit' && (
        <FormDialog
          title={`Edit ${dialog.department.code}`}
          submitLabel="Save"
          onClose={close}
          onSubmit={(form) => {
            const values = departmentValues(form)
            return save(supabase.from('departments').update(values).eq('id', dialog.department.id), values.code, `Saved ${values.code}`)
          }}
        >
          <DepartmentFields department={dialog.department} />
        </FormDialog>
      )}

      {dialog?.kind === 'delete' && (
        <DeleteDepartmentDialog
          department={dialog.department}
          onClose={close}
          onDelete={async () => {
            const { code } = dialog.department
            const { error } = await supabase.from('departments').delete().eq('id', dialog.department.id)
            list.retry()
            if (error) return friendlyError(error, { codes: { '23503': `${code} still has courses or staff. Move them to another department first.` } })
            toast.success(`Deleted ${code}`)
            return null
          }}
        />
      )}
    </div>
  )
}

function departmentValues(form: FormData) {
  return { code: String(form.get('code')), name: String(form.get('name')) }
}

function DepartmentFields({ department }: { department?: Department }) {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="department-code">Code</Label>
        <Input id="department-code" name="code" defaultValue={department?.code} autoComplete="off" required />
        <FieldError name="code" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="department-name">Name</Label>
        <Input id="department-name" name="name" defaultValue={department?.name} autoComplete="off" required />
      </div>
    </>
  )
}

/** The courses and staff that keep a department from being deleted. */
type Usage = { courses: number; staff: number }

/**
 * Counts what the department still has before it offers a delete, so a department in use says what
 * to move instead of failing. The dialog opens once the counts are in. If counting fails, it offers
 * the delete, which the database still refuses for a department in use.
 */
function DeleteDepartmentDialog({
  department,
  onDelete,
  onClose,
}: {
  department: Department
  onDelete: () => Promise<string | null>
  onClose: () => void
}) {
  const [usage, setUsage] = useState<Usage | 'counting' | 'unknown'>('counting')

  useEffect(() => {
    let current = true
    const count = (table: 'courses' | 'profiles') =>
      supabase.from(table).select('id', { count: 'exact', head: true }).eq('department_id', department.id)
    void Promise.all([count('courses'), count('profiles')]).then(([courses, staff]) => {
      if (!current) return
      setUsage(courses.error || staff.error ? 'unknown' : { courses: courses.count ?? 0, staff: staff.count ?? 0 })
    })
    return () => {
      current = false
    }
  }, [department.id])

  if (usage === 'counting') return null

  if (usage !== 'unknown' && usage.courses + usage.staff > 0) {
    const held = [usage.courses > 0 && plural(usage.courses, 'course'), usage.staff > 0 && plural(usage.staff, 'staff member')]
    return (
      <AlertDialog open onOpenChange={(open) => !open && onClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Can't delete {department.code}</AlertDialogTitle>
            <AlertDialogDescription>
              It has {held.filter(Boolean).join(' and ')}. Move {usage.courses + usage.staff === 1 ? 'it' : 'them'} to another
              department first.
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
      title={`Delete ${department.code} ${department.name}?`}
      description="This can't be undone."
      confirmLabel="Delete"
      destructive
      onClose={onClose}
      onConfirm={onDelete}
    />
  )
}
