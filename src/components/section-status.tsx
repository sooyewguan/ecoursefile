import { Badge } from '@/components/ui/badge'
import { SECTION_STATUS_LABELS, type SectionStatus } from '../sections.ts'

const STATUS_STYLES: Record<SectionStatus, string> = {
  missing: 'border-destructive/30 bg-destructive/10 text-destructive',
  pending_review: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  empty: 'text-muted-foreground',
  off: 'text-muted-foreground border-dashed',
}

export function SectionStatusBadge({ status }: { status: SectionStatus }) {
  return (
    <Badge variant="outline" className={STATUS_STYLES[status]}>
      {SECTION_STATUS_LABELS[status]}
    </Badge>
  )
}
