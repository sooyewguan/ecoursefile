import { PencilIcon, PlusIcon, TagsIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { FormDialog } from '@/components/action-dialogs'
import { FieldError } from '@/components/form-errors'
import { PageHeader, TableEmpty } from '@/components/page'
import { usePagedList } from '@/components/paged-list'
import { isEmptyList, PagedTableBody, TablePager } from '@/components/paged-table'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
        {!empty && (
          <Input
            type="search"
            aria-label="Search program codes"
            placeholder="Search program codes"
            className="sm:max-w-xs"
            value={list.query}
            onChange={(event) => list.setQuery(event.target.value)}
          />
        )}
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader className="bg-muted/50 max-md:hidden">
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
              empty={
                list.search ? (
                  <TableEmpty
                    columns={COLUMNS.length}
                    icon={TagsIcon}
                    title="No matching program codes"
                    action={
                      <Button variant="outline" onClick={() => list.setQuery('')}>
                        Clear search
                      </Button>
                    }
                  />
                ) : (
                  <TableEmpty columns={COLUMNS.length} icon={TagsIcon} title="No program codes yet" action={addButton} />
                )
              }
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
        </Card>
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
