import { FormDialog } from '@/components/action-dialogs'
import { BulkResults } from '@/components/bulk-results'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { plural } from '@/lib/utils'
import { COURSE_IMPORT_TEMPLATE, isExampleRow, MAX_COURSE_IMPORT_ROWS, readCourseImport, type ImportedCourse } from '../course-import.ts'
import { friendlyError } from '../errors.ts'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'

/** What import_courses did with one row. */
type ImportedRow = { file_row: number; code: string; course_id: string | null; reason: string | null }

/**
 * Asks for a CSV file of courses, reads it, and has import_courses add the valid rows. The template's
 * example row, left in the file, is rejected here. onImported gets what happened to every row; the
 * dialog shows why a file that cannot be read was refused.
 */
export function ImportCoursesDialog({ onImported, onClose }: { onImported: (rows: ImportedCourse[]) => void; onClose: () => void }) {
  return (
    <FormDialog
      title="Import courses"
      description={`Add up to ${MAX_COURSE_IMPORT_ROWS} courses from a CSV file.`}
      submitLabel="Import"
      onClose={onClose}
      onSubmit={async (form) => {
        const read = readCourseImport(await (form.get('file') as File).text())
        if ('problem' in read) return read.problem
        const examples: ImportedCourse[] = read.rows
          .filter(isExampleRow)
          .map(({ row, code }) => ({ row, code, status: 'rejected', reason: 'This is the example row of the template. Replace it with a course of your own.' }))
        const rows = read.rows.filter((row) => !isExampleRow(row))
        let imported: ImportedCourse[] = []
        if (rows.length > 0) {
          const { data, error } = await supabase.rpc('import_courses', { courses: rows })
          if (error) return friendlyError(error, { codes: { [UNIQUE_VIOLATION]: 'A course of the file was added while it imported, so nothing was added. Import it again.' } })
          imported = (data as ImportedRow[]).map(({ file_row: row, code, course_id, reason }) =>
            course_id ? { row, code, status: 'added', courseId: course_id } : { row, code, status: 'rejected', reason: reason! },
          )
        }
        onImported([...examples, ...imported].toSorted((a, b) => a.row - b.row))
        return null
      }}
    >
      <p className="text-muted-foreground text-sm">
        Use the{' '}
        <Button type="button" variant="link" className="text-foreground h-auto p-0 underline" onClick={downloadTemplate}>
          template
        </Button>
        . Each row holds a course's code and title, its department's code and its course type's name.
      </p>
      <div className="grid gap-2">
        <Label htmlFor="course-import-file">CSV file</Label>
        <Input id="course-import-file" name="file" type="file" accept=".csv,text/csv" required />
      </div>
    </FormDialog>
  )
}

/** What the last import did with each row: the rejected rows first, each with its reason, then the added ones. */
export function CourseImportResults({ rows, onDismiss }: { rows: ImportedCourse[]; onDismiss: () => void }) {
  const rejected = rows.filter((row) => row.status === 'rejected')
  const added = rows.filter((row) => row.status === 'added')
  return (
    <BulkResults
      title="Import results"
      summary={`${plural(added.length, 'course')} added, ${plural(rejected.length, 'row')} rejected.`}
      nameHeading="Row"
      results={[...rejected, ...added].map((row) => ({
        key: String(row.row),
        name: (
          <span className="grid gap-0.5">
            <span className="text-muted-foreground text-xs tabular-nums">Row {row.row}</span>
            <span className="font-medium break-all">{row.code || '—'}</span>
          </span>
        ),
        outcome: row.status === 'added' ? { label: 'Added', variant: 'success' } : { label: 'Rejected', variant: 'destructive' },
        note: row.status === 'rejected' ? row.reason : undefined,
      }))}
      onDismiss={onDismiss}
    />
  )
}

function downloadTemplate() {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([COURSE_IMPORT_TEMPLATE], { type: 'text/csv' }))
  link.download = 'courses.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
}
