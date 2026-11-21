import { PencilIcon, PlusIcon, TagsIcon } from 'lucide-react'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { friendlyError } from '../errors.ts'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'

type ProgramCode = { id: string; code: string }

/** The dialog that is open, and the program code it acts on. */
type OpenDialog = { kind: 'add' } | { kind: 'edit'; programCode: ProgramCode }

/** The table's columns: code and the row menu. */
const COLUMNS = ['', '']

export function ProgramCodes() {
  const [programCodes, setProgramCodes] = useState<ProgramCode[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('program_codes').select('id, code').order('code')
    setLoadFailed(error !== null)
    if (data) setProgramCodes(data)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Runs one write, reloads the list, and returns why it failed or null. */
  async function write(request: PromiseLike<{ error: { code: string } | null }>, code: string, success: string) {
    const { error } = await request
    await reload()
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
      <PageHeader title="Program codes" action={addButton} />

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-4">Code</TableHead>
              <TableHead className="w-14 px-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadFailed ? (
              <TableLoadError columns={COLUMNS.length} title="Couldn't load program codes" onRetry={reload} />
            ) : !programCodes ? (
              <TableSkeleton columns={COLUMNS} />
            ) : programCodes.length === 0 ? (
              <TableEmpty columns={COLUMNS.length} icon={TagsIcon} title="No program codes yet" action={addButton} />
            ) : (
              programCodes.map((programCode) => (
                <TableRow key={programCode.id}>
                  <TableCell className="px-4 py-3 font-medium whitespace-normal">{programCode.code}</TableCell>
                  <TableCell className="px-4 py-2 text-right">
                    <RowActions label={`Actions for ${programCode.code}`}>
                      <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', programCode })}>
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
