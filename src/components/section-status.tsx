import { CheckIcon, ClockIcon, MinusIcon, WrenchIcon, XIcon, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { OFFERING_STATUS_LABELS, type OfferingStatus } from '../reports.ts'
import { SECTION_STATUS_LABELS, sectionName, type SectionStatus } from '../sections.ts'

const STATUS_STYLES: Record<SectionStatus, string> = {
  missing: 'border-destructive/30 bg-destructive/10 text-destructive',
  pending_review: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  verified: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  needs_fix: 'bg-destructive dark:bg-destructive/60 border-transparent text-white',
  empty: 'text-muted-foreground',
  off: 'text-muted-foreground border-dashed',
}

/** The heatmap's mark for each status, so a cell never tells its status by color alone. Empty has none. */
const STATUS_ICONS: Record<SectionStatus, LucideIcon | null> = {
  missing: XIcon,
  pending_review: ClockIcon,
  verified: CheckIcon,
  needs_fix: WrenchIcon,
  empty: null,
  off: MinusIcon,
}

/** An offering's status shows in the colors of the section status it stands for. */
const OFFERING_STATUS_STYLES: Record<OfferingStatus, SectionStatus> = {
  incomplete: 'missing',
  needs_fix: 'needs_fix',
  pending_review: 'pending_review',
  verified: 'verified',
}

export function SectionStatusBadge({ status }: { status: SectionStatus }) {
  return (
    <Badge variant="outline" className={STATUS_STYLES[status]}>
      {SECTION_STATUS_LABELS[status]}
    </Badge>
  )
}

export function OfferingStatusBadge({ status }: { status: OfferingStatus }) {
  return (
    <Badge variant="outline" className={STATUS_STYLES[OFFERING_STATUS_STYLES[status]]}>
      {OFFERING_STATUS_LABELS[status]}
    </Badge>
  )
}

/** A section's status as one small square with its mark, named in full for screen readers and on hover. */
export function SectionStatusSquare({ section, status }: { section: number; status: SectionStatus }) {
  const Icon = STATUS_ICONS[status]
  const label = `${sectionName(section)}: ${SECTION_STATUS_LABELS[status]}`
  return (
    <span title={label} className={cn('inline-flex size-6 items-center justify-center rounded-md border', STATUS_STYLES[status])}>
      {Icon && <Icon aria-hidden="true" className="size-3.5" />}
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** Every section status with its square, for the heatmap's legend. */
export function SectionStatusLegend() {
  return (
    <ul aria-label="Legend" className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-2 text-sm">
      {(Object.keys(SECTION_STATUS_LABELS) as SectionStatus[]).map((status) => {
        const Icon = STATUS_ICONS[status]
        return (
          <li key={status} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('inline-flex size-5 items-center justify-center rounded-md border', STATUS_STYLES[status])}>
              {Icon && <Icon className="size-3" />}
            </span>
            {SECTION_STATUS_LABELS[status]}
          </li>
        )
      })}
    </ul>
  )
}
