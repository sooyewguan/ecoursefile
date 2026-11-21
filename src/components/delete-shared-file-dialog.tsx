import { ConfirmDialog } from '@/components/action-dialogs'
import { plural } from '@/lib/utils'
import { friendlyError } from '../errors.ts'
import { supabase } from '../supabase.ts'
import { deleteSharedFile } from '../uploads.ts'

/** A shared file about to be deleted, and the offerings whose course files link it. */
export type LinkedSharedFile = {
  id: string
  name: string
  linked_offerings: { id: string; course: { code: string; title: string } }[]
}

/**
 * Confirms the delete of a shared file. It lists the offerings whose course files link the file,
 * because its section becomes Missing in each of them. title names the file, such as "Academic
 * Calendar" or "your timetable".
 */
export function DeleteSharedFileDialog({
  file,
  title,
  onClose,
  onDeleted,
}: {
  file: LinkedSharedFile
  title: string
  onClose: () => void
  onDeleted: () => Promise<void>
}) {
  const linked = file.linked_offerings.toSorted((a, b) => a.course.code.localeCompare(b.course.code))
  return (
    <ConfirmDialog
      title={`Delete ${title}?`}
      description={
        linked.length === 0
          ? `${file.name} will be permanently deleted.`
          : `${plural(linked.length, 'course file')} will show it as Missing:`
      }
      confirmLabel="Delete"
      destructive
      onClose={onClose}
      onConfirm={async () => {
        try {
          await deleteSharedFile(supabase, file.id)
        } catch (error) {
          return friendlyError(error)
        }
        await onDeleted()
        return null
      }}
    >
      {linked.length > 0 && (
        <ul aria-label="Affected offerings" className="max-h-48 overflow-y-auto rounded-md border text-sm">
          {linked.map((offering) => (
            <li key={offering.id} className="border-b px-3 py-2 last:border-b-0">
              <span className="font-medium">{offering.course.code}</span> {offering.course.title}
            </li>
          ))}
        </ul>
      )}
    </ConfirmDialog>
  )
}
