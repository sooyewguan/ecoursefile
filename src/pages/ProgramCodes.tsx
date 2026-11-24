import { PencilIcon, PlusIcon, TagsIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { FormDialog } from '@/components/action-dialogs'
import { FieldError } from '@/components/form-errors'
import { PageHeader, TableCard } from '@/components/page'
import { usePagedList } from '@/components/paged-list'
import { isEmptyList, ListEmpty, ListSearch, PagedTableBody, TablePager } from '@/components/paged-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { matching } from '../catalog.ts'
import { friendlyError } from '../errors.ts'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'

type ProgramCode = { id: string; code: string }

/** The dialog that is open, and the program code it acts on. */
type OpenDialog = { kind: 'add' } | { kind: 'edit'; programCode: ProgramCode }

/** The table's columns: code and the Edit button. */
const COLUMNS = ['', '']

export function ProgramCodes() {
  const list = usePagedList<ProgramCode>(({ from, to }, search) =>
    matching(supabase.from('program_codes').select('id, code', { count: 'exact' }), ['code'], search)
      .order('code')
      .range(from, to),
  )
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const empty = isEmptyList(list)

  /** Runs one write, reloads the list, and returns why it failed or null. */
  async function write(request: PromiseLike<{ error: { code: string } | null }>, code: string, success: string) {
    const { error } = await request
    list.retry()
    if (error?.code === UNIQUE_VIOLATION) return { field: 'code', message: `The program code ${code} already exists.` }
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
      Add program code
    </Button>
  )

  return (
    <div className="grid gap-6">
      <PageHeader title="Program codes" action={!empty && addButton} />

      <div className="grid gap-3">
        {!empty && <ListSearch list={list} label="Search program codes" />}
        <TableCard>
          <Table>
            <TableHeader className="max-md:hidden">
              <TableRow>
                <TableHead className="px-4">Code</TableHead>
                <TableHead className="w-24 px-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <PagedTableBody
              list={list}
              columns={COLUMNS}
              loadError="Couldn't load program codes"
              empty={<ListEmpty list={list} columns={COLUMNS.length} icon={TagsIcon} noun="program codes" addButton={addButton} />}
            >
              {(programCode) => (
                <TableRow key={programCode.id}>
                  <TableCell className="px-4 py-3 font-medium whitespace-normal">{programCode.code}</TableCell>
                  <TableCell className="px-4 py-2 text-right">
                    <Button variant="ghost" size="sm" aria-label={`Edit ${programCode.code}`} onClick={() => setDialog({ kind: 'edit', programCode })}>
                      <PencilIcon />
                      Edit
                    </Button>
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
          title="Add a program code"
          submitLabel="Add program code"
          onClose={close}
          onSubmit={(form) => {
            const code = String(form.get('code'))
            return write(supabase.from('program_codes').insert({ code }), code, `Added ${code}`)
          }}
        >
          <ProgramCodeField />
        </FormDialog>
      )}

      {dialog?.kind === 'edit' && (
        <FormDialog
          title={`Edit ${dialog.programCode.code}`}
          submitLabel="Save"
          onClose={close}
          onSubmit={(form) => {
            const code = String(form.get('code'))
            return write(
              supabase.from('program_codes').update({ code }).eq('id', dialog.programCode.id),
              code,
              `Saved ${code}`,
            )
          }}
        >
          <ProgramCodeField programCode={dialog.programCode} />
        </FormDialog>
      )}
    </div>
  )
}

function ProgramCodeField({ programCode }: { programCode?: ProgramCode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="program-code">Code</Label>
      <Input
        id="program-code"
        name="code"
        defaultValue={programCode?.code}
        placeholder="1 BITS S1G1"
        autoComplete="off"
        required
      />
      <FieldError name="code" />
    </div>
  )
}
