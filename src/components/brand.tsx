import { FolderCheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** The app's mark: a checked folder in the primary color, as in shadcn's sidebar blocks. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg shadow-xs', className)}>
      <FolderCheckIcon className="size-[18px]" strokeWidth={2.25} />
    </span>
  )
}

/** The app's mark and name. */
export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5 text-base font-semibold tracking-tight', className)}>
      <BrandMark />
      eCourseFile
    </span>
  )
}
