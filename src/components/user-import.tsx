import { DownloadIcon, XIcon } from 'lucide-react'
import { Link } from 'react-router'
import { FormDialog, type Action } from '@/components/action-dialogs'
import { TableCard } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { plural } from '../format.ts'
import { importReason, MAX_IMPORT_ROWS, ROLE_SEPARATOR, USER_IMPORT_TEMPLATE, type ImportedRow } from '../../supabase/functions/_shared/user-import.ts'
import { importResultsCsv, inResultOrder } from '../import-results.ts'
import { ROLE_LABELS, type GlobalRole } from '../roles.ts'
import { saveFile } from '../save-file.ts'

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
  const labels = roles.map((role) => ROLE_LABELS[role])
  return (
    <FormDialog
      title="Import users"
      description={`Add up to ${MAX_IMPORT_ROWS} users from a CSV file.`}
      submitLabel="Import"
      onClose={onClose}
      onSubmit={async (form) => onImport(await (form.get('file') as File).text())}
    >
      <dl className="text-muted-foreground grid gap-2 text-sm">
        <div>
          <dt className="text-foreground inline font-medium">Template: </dt>
          <dd className="inline">
            <Button type="button" variant="link" className="text-foreground h-auto p-0 underline" onClick={downloadTemplate}>
              users.csv
            </Button>
            . Its example row shows each column filled in, and the import skips it.
          </dd>
        </div>
        <div>
          <dt className="text-foreground inline font-medium">Roles: </dt>
          <dd className="inline">
            {labels.join(', ')}. Separate several with {ROLE_SEPARATOR}, as in {labels.slice(0, 2).join(ROLE_SEPARATOR)}.
          </dd>
        </div>
        <div>
          <dt className="text-foreground inline font-medium">Department: </dt>
          <dd className="inline">
            a code from the{' '}
            <Link to="/departments" className="text-foreground underline">
              Departments
            </Link>{' '}
            page, or empty.
          </dd>
        </div>
      </dl>
      <div className="grid gap-2">
        <Label htmlFor="import-file">CSV file</Label>
        <Input id="import-file" name="file" type="file" accept=".csv,text/csv" required />
      </div>
    </FormDialog>
  )
}

/** What the last import did with each row: the rejected rows first, each with its reason, then the created ones. */
export function ImportResults({ rows, onDismiss }: { rows: ImportedRow[]; onDismiss: () => void }) {
  const created = rows.filter((row) => row.status === 'created').length
  return (
    <TableCard>
      <CardHeader className="border-b px-4 py-4">
        <CardTitle>Import results</CardTitle>
        <CardDescription>
          {plural(created, 'user')} added, {plural(rows.length - created, 'row')} rejected.
        </CardDescription>
        <CardAction className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => saveFile(new Blob([importResultsCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'import-results.csv')}
          >
            <DownloadIcon />
            Download CSV
          </Button>
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
          {inResultOrder(rows).map((row) => (
            <TableRow key={row.row}>
              <TableCell className="px-4 py-3 align-top tabular-nums">{row.row}</TableCell>
              <TableCell className="px-4 py-3 align-top whitespace-normal">
                {row.email || <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="px-4 py-3 whitespace-normal">
                {row.status === 'created' ? (
                  <Badge variant="secondary">Added</Badge>
                ) : (
                  <div className="grid gap-1">
                    <Badge variant="destructive">Rejected</Badge>
                    <span>{importReason(row)}</span>
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
  saveFile(new Blob([USER_IMPORT_TEMPLATE], { type: 'text/csv' }), 'users.csv')
}
