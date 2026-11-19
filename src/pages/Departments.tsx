import { Building2Icon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ConfirmDialog, FormDialog } from '@/components/action-dialogs'
import { NoticeAlert, type Notice } from '@/components/notice'
import { PageHeader, RowActions, TableEmpty, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { supabase } from '../supabase.ts'

type Department = { id: string; code: string; name: string }

/** The dialog that is open, and the department it acts on. */
type OpenDialog =
  | { kind: 'add' }
  | { kind: 'rename'; department: Department }
  | { kind: 'delete'; department: Department }

/** The table's columns: code, name and the row menu. */
const COLUMNS = ['', '', '']

export function Departments() {
  const [departments, setDepartments] = useState<Department[] | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('departments').select('id, code, name').order('code')
    if (error) setNotice({ tone: 'error', text: error.message })
    else setDepartments(data)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Runs one write, reloads the list, and returns the write's error message or null. */
  async function write(request: PromiseLike<{ error: { message: string } | null }>, success: string) {
    const { error } = await request
    await reload()
    if (!error) setNotice({ tone: 'success', text: success })
    return error?.message ?? null
  }

  function close() {
    setDialog(null)
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Departments"
        description="The departments that staff belong to. Every HoD needs one."
        action={
          <Button onClick={() => setDialog({ kind: 'add' })}>
            <PlusIcon />
            Add department
          </Button>
        }
      />
      {notice && <NoticeAlert notice={notice} />}

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-40 px-4">Code</TableHead>
              <TableHead className="px-4">Name</TableHead>
              <TableHead className="w-14 px-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!departments ? (
              <TableSkeleton columns={COLUMNS} />
            ) : departments.length === 0 ? (
              <TableEmpty
                columns={COLUMNS.length}
                icon={Building2Icon}
                title="No departments yet"
                description="Add a department so that you can place staff in it."
              />
            ) : (
              departments.map((department) => (
                <TableRow key={department.id}>
                  <TableCell className="px-4 py-3 font-medium whitespace-normal wrap-anywhere">{department.code}</TableCell>
                  <TableCell className="px-4 py-3 whitespace-normal">{department.name}</TableCell>
                  <TableCell className="px-4 py-2 text-right">
                    <RowActions label={`Actions for ${department.code}`}>
                      <DropdownMenuItem onSelect={() => setDialog({ kind: 'rename', department })}>
                        <PencilIcon />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: 'delete', department })}>
                        <Trash2Icon />
                        Delete
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
          title="Add a department"
          description="Staff and HoDs can be placed in it once it exists."
          submitLabel="Add department"
          onClose={close}
          onSubmit={(form) => {
            const values = departmentValues(form)
            return write(supabase.from('departments').insert(values), `Added ${values.code} ${values.name}.`)
          }}
        >
          <DepartmentFields />
        </FormDialog>
      )}

      {dialog?.kind === 'rename' && (
        <FormDialog
          title={`Rename ${dialog.department.code}`}
          description="Change the department's code or name. Its staff stay in it."
          submitLabel="Save"
          onClose={close}
          onSubmit={(form) => {
            const values = departmentValues(form)
            return write(
              supabase.from('departments').update(values).eq('id', dialog.department.id),
              `Saved ${values.code} ${values.name}.`,
            )
          }}
        >
          <DepartmentFields department={dialog.department} />
        </FormDialog>
      )}

      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete ${dialog.department.code} ${dialog.department.name}?`}
          description="This cannot be undone. A department that still has staff or courses in it cannot be deleted."
          confirmLabel="Delete"
          destructive
          onClose={close}
          onConfirm={() =>
            write(
              supabase.from('departments').delete().eq('id', dialog.department.id),
              `Deleted ${dialog.department.code} ${dialog.department.name}.`,
            )
          }
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
      </div>
      <div className="grid gap-2">
        <Label htmlFor="department-name">Name</Label>
        <Input id="department-name" name="name" defaultValue={department?.name} autoComplete="off" required />
      </div>
    </>
  )
}
