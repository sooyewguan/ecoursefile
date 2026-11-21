import { ConfirmDialog } from '@/components/action-dialogs'
import { friendlyError } from '../errors.ts'
import type { Section } from '../sections.ts'
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
 * because the section becomes Missing in each of them. subject names the file in a sentence, such
 * as "The Academic Calendar of 2026/2027-1".
 */
export function DeleteSharedFileDialog({
  file,
  section,
  subject,
  onClose,
  onDeleted,
}: {
  file: LinkedSharedFile
  section: Section
  subject: string
  onClose: () => void
  onDeleted: () => Promise<void>
}) {
  const linked = file.linked_offerings.toSorted((a, b) => a.course.code.localeCompare(b.course.code))
  const sectionName = `section ${section.number} ${section.title}`
  return (
    <ConfirmDialog
      title={`Delete ${file.name}?`}
      description={
        linked.length === 0
          ? `${subject} is deleted for good, from SharePoint. No course file links it yet.`
          : `${subject} is deleted for good, from SharePoint and from the course files that link it. ${
              linked.length === 1 ? `This offering loses it, and ${sectionName} becomes Missing:` : `These ${linked.length} offerings lose it, and ${sectionName} becomes Missing in each:`
            }`
      }
      confirmLabel="Delete file"
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
