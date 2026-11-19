import { FolderCheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** The app's mark and name. */
export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
        <FolderCheckIcon className="size-4" />
      </span>
      eCourseFile
    </span>
  )
}
