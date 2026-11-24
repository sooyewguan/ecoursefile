import { FormDialog } from '@/components/action-dialogs'
import { type LinkedSharedFile } from '@/components/delete-shared-file-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { plural } from '@/lib/utils'
import { friendlyError } from '../errors.ts'
import { supabase } from '../supabase.ts'
import { replaceSharedFile, type SharedSlot } from '../uploads.ts'

/**
 * Replaces a shared file with a PDF the user picks. It lists the offerings whose course files link
 * the file and says what happens to them: each gets the new file, and an auditor's verdict on the
 * section no longer holds. title names the file, such as "Academic Calendar". slot is where the file
 * is shared. onFailed runs after a try that failed, which may have deleted the old file already.
 */
export function ReplaceSharedFileDialog({
  file,
  title,
  slot,
  onClose,
  onReplaced,
  onFailed,
}: {
  file: LinkedSharedFile
  title: string
  slot: SharedSlot
  onClose: () => void
  onReplaced: (name: string) => Promise<void>
  onFailed: () => Promise<void>
}) {
  const linked = file.linked_offerings.toSorted((a, b) => a.course.code.localeCompare(b.course.code))
  return (
    <FormDialog
      title={`Replace ${title}`}
      description={
        linked.length === 0
          ? `${file.name} is deleted and the new file takes its place. No course file links it yet.`
          : `${plural(linked.length, 'course file')} link ${file.name}. In each, the section goes back to Pending review until an auditor checks the new file, and earlier verdicts stay in its activity. While the new file uploads, the section shows Missing.`
      }
      submitLabel="Replace"
      onClose={onClose}
      onSubmit={async (form) => {
        const picked = form.get('file') as File
        try {
          await replaceSharedFile(supabase, slot, file.id, picked)
        } catch (error) {
          await onFailed()
          return friendlyError(error)
        }
        await onReplaced(picked.name)
        return null
      }}
    >
      {linked.length > 0 && (
        <ul aria-label="Course files that link it" className="max-h-48 overflow-y-auto rounded-md border text-sm">
          {linked.map((offering) => (
            <li key={offering.id} className="border-b px-3 py-2 last:border-b-0">
              <span className="font-medium">{offering.course.code}</span> {offering.course.title}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2">
        <Label htmlFor="replacement-file">New PDF</Label>
        <Input id="replacement-file" name="file" type="file" accept="application/pdf,.pdf" required />
      </div>
    </FormDialog>
  )
}
