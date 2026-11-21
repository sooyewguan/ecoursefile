import { DownloadIcon, ExternalLinkIcon } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { friendlyError } from '../errors.ts'
import { saveFile } from '../save-file.ts'
import { supabase } from '../supabase.ts'
import { fetchFile, type Slot } from '../uploads.ts'

/** A stored file as a list shows it. */
type NamedFile = { id: string; name: string }

/**
 * The address of the page that shows the file. A file of a past offering that the user may only
 * reuse carries the slot it would be reused into, which the files function checks.
 */
export function filePath(fileId: string, reuseInto?: Slot) {
  if (!reuseInto) return `/files/${fileId}`
  const { offeringId, section, item, slot } = reuseInto
  const place = new URLSearchParams({ offering: offeringId, section: String(section) })
  if (item !== undefined) place.set('item', String(item))
  if (slot !== undefined) place.set('slot', slot)
  return `/files/${fileId}?${place}`
}

/** The slot that filePath put in the page's address, if any. */
export function reuseSlotOf(params: URLSearchParams): Slot | undefined {
  const offeringId = params.get('offering')
  if (!offeringId) return undefined
  const item = params.get('item')
  return { offeringId, section: Number(params.get('section')), item: item ? Number(item) : undefined, slot: params.get('slot') ?? undefined }
}

/** A file's name as a link that opens the file in a new tab. */
export function FileLink({ file, reuseInto, className }: { file: NamedFile; reuseInto?: Slot; className?: string }) {
  return (
    <a href={filePath(file.id, reuseInto)} target="_blank" rel="noopener" className={cn('font-medium break-words hover:underline', className)}>
      {file.name}
    </a>
  )
}

/** The row menu's Open and Download, which come first in a file's menu. */
export function FileMenuItems({ file }: { file: NamedFile }) {
  return (
    <>
      <DropdownMenuItem asChild>
        <a href={filePath(file.id)} target="_blank" rel="noopener">
          <ExternalLinkIcon />
          Open
        </a>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void downloadFile(file)}>
        <DownloadIcon />
        Download
      </DropdownMenuItem>
    </>
  )
}

/** Gets the file and saves it under its name, with a toast while it comes. */
async function downloadFile(file: NamedFile) {
  const id = toast.loading(`Downloading ${file.name}`)
  try {
    const { name, blob } = await fetchFile(supabase, file.id)
    saveFile(blob, name)
    toast.dismiss(id)
  } catch (error) {
    toast.error(friendlyError(error), { id })
  }
}
