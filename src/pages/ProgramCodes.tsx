import { PencilIcon, PlusIcon, TagsIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { FormDialog } from '@/components/action-dialogs'
import { NoticeAlert, type Notice } from '@/components/notice'
import { PageHeader, RowActions, TableEmpty, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'

type ProgramCode = { id: string; code: string }

/** The dialog that is open, and the program code it acts on. */
type OpenDialog = { kind: 'add' } | { kind: 'edit'; programCode: ProgramCode }

/** The table's columns: code and the row menu. */
const COLUMNS = ['', '']

export function ProgramCodes() {
  const [programCodes, setProgramCodes] = useState<ProgramCode[] | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('program_codes').select('id, code').order('code')
    if (error) setNotice({ tone: 'error', text: error.message })
    else setProgramCodes(data)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Runs one write, reloads the list, and returns the write's error message or null. */
  async function write(request: PromiseLike<{ error: { code: string; message: string } | null }>, code: string, success: string) {
    const { error } = await request
    await reload()
    if (!error) setNotice({ tone: 'success', text: success })
    if (error?.code === UNIQUE_VIOLATION) return `The program code ${code} already exists.`
    return error?.message ?? null
  }

  function close() {
    setDialog(null)
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Program codes"
        description="The master list of program codes that student timetables are tagged with."
        action={
          <Button onClick={() => setDialog({ kind: 'add' })}>
            <PlusIcon />
            Add program code
          </Button>
        }
      />
      {notice && <NoticeAlert notice={notice} />}

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
            {!programCodes ? (
              <TableSkeleton columns={COLUMNS} />
            ) : programCodes.length === 0 ? (
              <TableEmpty
                columns={COLUMNS.length}
                icon={TagsIcon}
                title="No program codes yet"
                description="Add a program code, such as 1 BITS S1G1."
              />
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
          description="Program codes are unique."
          submitLabel="Add program code"
          onClose={close}
          onSubmit={(form) => {
            const code = String(form.get('code'))
            return write(supabase.from('program_codes').insert({ code }), code, `Added ${code}.`)
          }}
        >
          <ProgramCodeField />
        </FormDialog>
      )}

      {dialog?.kind === 'edit' && (
        <FormDialog
          title={`Edit ${dialog.programCode.code}`}
          description="Program codes are unique."
          submitLabel="Save"
          onClose={close}
          onSubmit={(form) => {
            const code = String(form.get('code'))
            return write(
              supabase.from('program_codes').update({ code }).eq('id', dialog.programCode.id),
              code,
              `Saved ${code}.`,
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
    </div>
  )
}
