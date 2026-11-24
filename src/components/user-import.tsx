import { XIcon } from 'lucide-react'
import { FormDialog, type Action } from '@/components/action-dialogs'
import { TableCard } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { plural } from '@/lib/utils'
import { MAX_IMPORT_ROWS, ROLE_SEPARATOR, USER_IMPORT_TEMPLATE, type ImportedRow } from '../../supabase/functions/_shared/user-import.ts'
import type { GlobalRole } from '../roles.ts'

/**
 * Asks for a CSV file of users and gives onImport its text as it is, since the accounts function
 * reads the file. The dialog shows onImport's error, or closes when it succeeds.
 */
export function ImportUsersDialog({
  roles,
  onImport,
  onClose,
}: {
  /** The roles the admin may give, which a row may hold. */
  roles: GlobalRole[]
  onImport: Action<[string]>
  onClose: () => void
}) {
  return (
    <FormDialog
      title="Import users"
      description={`Add up to ${MAX_IMPORT_ROWS} users from a CSV file.`}
      submitLabel="Import"
      onClose={onClose}
      onSubmit={async (form) => onImport(await (form.get('file') as File).text())}
    >
      <p className="text-muted-foreground text-sm">
        Use the{' '}
        <Button type="button" variant="link" className="text-foreground h-auto p-0 underline" onClick={downloadTemplate}>
          template
        </Button>
        . Roles: {roles.join(', ')} (separate several with {ROLE_SEPARATOR}).
      </p>
      <div className="grid gap-2">
        <Label htmlFor="import-file">CSV file</Label>
        <Input id="import-file" name="file" type="file" accept=".csv,text/csv" required />
      </div>
    </FormDialog>
  )
}

/** What the last import did with each row: the rejected rows first, each with its reason, then the created ones. */
export function ImportResults({ rows, onDismiss }: { rows: ImportedRow[]; onDismiss: () => void }) {
  const rejected = rows.filter((row) => row.status === 'rejected')
  const created = rows.filter((row) => row.status === 'created')
  return (
    <TableCard>
      <CardHeader className="border-b px-4 py-4">
        <CardTitle>Import results</CardTitle>
        <CardDescription>
          {plural(created.length, 'user')} added, {plural(rejected.length, 'row')} rejected.
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="Dismiss the import results" onClick={onDismiss}>
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16 px-4">Row</TableHead>
            <TableHead className="px-4">Email</TableHead>
            <TableHead className="px-4">Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...rejected, ...created].map((row) => (
            <TableRow key={row.row}>
              <TableCell className="px-4 py-3 align-top tabular-nums">{row.row}</TableCell>
              <TableCell className="px-4 py-3 align-top whitespace-normal">
                {row.email || <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="px-4 py-3 whitespace-normal">
                {row.status === 'created' ? (
                  <Badge variant="success">
                    Added
                  </Badge>
                ) : (
                  <div className="grid gap-1">
                    <Badge variant="destructive">
                      Rejected
                    </Badge>
                    <span>{row.reason}</span>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  )
}

function downloadTemplate() {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([USER_IMPORT_TEMPLATE], { type: 'text/csv' }))
  link.download = 'users.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
}
