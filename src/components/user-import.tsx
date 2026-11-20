import { DownloadIcon, XIcon } from 'lucide-react'
import { FormDialog, type Action } from '@/components/action-dialogs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { plural } from '@/lib/utils'
import { ROLE_SEPARATOR, USER_IMPORT_TEMPLATE, type ImportedRow } from '../../supabase/functions/_shared/user-import.ts'
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
      description="Each row of the CSV file adds a user who must change the temporary password at first sign-in. A row with a problem is listed with the reason, and the other rows are still added."
      submitLabel="Import"
      onClose={onClose}
      onSubmit={async (form) => onImport(await (form.get('file') as File).text())}
    >
      <div className="grid gap-2 text-sm">
        <p>The first row names the columns, in any order:</p>
        <ul className="text-muted-foreground grid list-disc gap-1 pl-5">
          <li>
            <code>full_name</code>, <code>email</code> and <code>temporary_password</code>.
          </li>
          <li>
            <code>department</code>: the department&apos;s code as the Departments page shows it, or empty for none. An HoD needs one.
          </li>
          <li>
            <code>roles</code>: {roles.join(', ')}, with several separated by <code>{ROLE_SEPARATOR}</code>, such as{' '}
            <code>lecturer{ROLE_SEPARATOR}hod</code>.
          </li>
        </ul>
        <p className="text-muted-foreground">In a spreadsheet, save the file as CSV UTF-8.</p>
      </div>
      <Button type="button" variant="outline" className="justify-self-start" onClick={downloadTemplate}>
        <DownloadIcon />
        Download template
      </Button>
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
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b px-4 py-4">
        <CardTitle>Import results</CardTitle>
        <CardDescription>
          {plural(created.length, 'user')} added, {plural(rejected.length, 'row')} rejected.
          {rejected.length > 0 && ' Fix the rejected rows and import them again. A row whose user was added is rejected if it is imported again.'}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="Dismiss the import results" onClick={onDismiss}>
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <Table>
        <TableHeader className="bg-muted/50">
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
              <TableCell className="px-4 py-3 align-top whitespace-normal wrap-anywhere">
                {row.email || <span className="text-muted-foreground">No email</span>}
              </TableCell>
              <TableCell className="px-4 py-3 whitespace-normal">
                {row.status === 'created' ? (
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                    Added
                  </Badge>
                ) : (
                  <div className="grid gap-1">
                    <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
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
    </Card>
  )
}

function downloadTemplate() {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([USER_IMPORT_TEMPLATE], { type: 'text/csv' }))
  link.download = 'users.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
}
