import { CheckIcon, ClockIcon, MinusIcon, ShieldIcon, WrenchIcon, XIcon, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { OFFERING_STATUS_LABELS, type OfferingStatus } from '../reports.ts'
import { SECTION_STATUS_LABELS, sectionName, type SectionStatus } from '../sections.ts'

/**
 * How each status looks: its Tailwind colors and its mark, so that no status is told by color alone.
 * Missing is destructive, Pending review sky, Verified emerald, and Needs fix solid amber, which
 * stands out as the one an auditor sent back. Empty has no mark.
 */
const STATUS_LOOK: Record<SectionStatus, { className: string; icon: LucideIcon | null }> = {
  missing: { className: 'border-destructive/25 bg-destructive/10 text-destructive', icon: XIcon },
  pending_review: { className: 'border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400', icon: ClockIcon },
  verified: { className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', icon: CheckIcon },
  needs_fix: { className: 'border-transparent bg-amber-500 text-amber-950', icon: WrenchIcon },
  empty: { className: 'text-muted-foreground', icon: null },
  off: { className: 'text-muted-foreground bg-muted/60 border-dashed', icon: MinusIcon },
}

/**
 * An offering's status in the look of the section status it stands for. Incomplete stays plain, so
 * that color marks only what an auditor has seen.
 */
const OFFERING_STATUS_LOOK: Record<OfferingStatus, { className: string; icon: LucideIcon | null }> = {
  incomplete: { className: 'text-foreground', icon: null },
  needs_fix: STATUS_LOOK.needs_fix,
  pending_review: STATUS_LOOK.pending_review,
  verified: STATUS_LOOK.verified,
}

/** Missing in a section the admin uploads, in violet with a shield, so lecturers see it is not theirs to upload. */
const ADMIN_MISSING_LOOK = { className: 'border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-400', icon: ShieldIcon }

/** A section's status. With adminUploads, Missing reads Missing · Admin, for a file the admin uploads. */
export function SectionStatusBadge({ status, adminUploads = false }: { status: SectionStatus; adminUploads?: boolean }) {
  const isAdminMissing = adminUploads && status === 'missing'
  const { className, icon: Icon } = isAdminMissing ? ADMIN_MISSING_LOOK : STATUS_LOOK[status]
  return (
    <Badge variant="outline" className={className}>
      {Icon && <Icon aria-hidden="true" />}
      {isAdminMissing ? 'Missing · Admin' : SECTION_STATUS_LABELS[status]}
    </Badge>
  )
}

export function OfferingStatusBadge({ status }: { status: OfferingStatus }) {
  const { className, icon: Icon } = OFFERING_STATUS_LOOK[status]
  return (
    <Badge variant="outline" className={className}>
      {Icon && <Icon aria-hidden="true" />}
      {OFFERING_STATUS_LABELS[status]}
    </Badge>
  )
}

/**
 * A section by number and title in the look of its status, such as 4 Lecturer Timetable as Missing.
 * With to, it links to the section's page. What the status is comes from the list it sits in, such as
 * one labelled Missing.
 */
export function SectionStatusChip({ section, status, to }: { section: number; status: SectionStatus; to?: string }) {
  const { className, icon: Icon } = STATUS_LOOK[status]
  const chip = (
    <Badge variant="outline" className={cn('h-7 gap-1.5 px-2.5 text-sm font-normal', to && 'underline-offset-2 group-hover:underline', className)}>
      {Icon && <Icon aria-hidden="true" />}
      {sectionName(section)}
    </Badge>
  )
  if (!to) return chip
  return (
    <Link to={to} className="group focus-visible:ring-ring/40 inline-flex rounded-md outline-none focus-visible:ring-[3px]">
      {chip}
    </Link>
  )
}

/** A section's status as one small square with its mark, named in full for screen readers and on hover. With to, it links to the section's page. */
export function SectionStatusSquare({ section, status, to }: { section: number; status: SectionStatus; to?: string }) {
  const { className, icon: Icon } = STATUS_LOOK[status]
  const label = `${sectionName(section)}: ${SECTION_STATUS_LABELS[status]}`
  const square = (
    <span title={label} className={cn('inline-flex size-6 items-center justify-center rounded-md border', className)}>
      {Icon && <Icon aria-hidden="true" className="size-3.5" />}
      <span className="sr-only">{label}</span>
    </span>
  )
  if (!to) return square
  return (
    <Link to={to} className="focus-visible:ring-ring/40 hover:ring-ring/40 inline-flex rounded-md outline-none hover:ring-2 focus-visible:ring-[3px]">
      {square}
    </Link>
  )
}

/** Every section status with its square, for the heatmap's legend. */
export function SectionStatusLegend({ className }: { className?: string }) {
  return (
    <ul aria-label="Legend" className={cn('text-muted-foreground flex flex-wrap gap-x-4 gap-y-2 text-sm', className)}>
      {(Object.keys(SECTION_STATUS_LABELS) as SectionStatus[]).map((status) => {
        const { className, icon: Icon } = STATUS_LOOK[status]
        return (
          <li key={status} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('inline-flex size-5 items-center justify-center rounded-md border', className)}>
              {Icon && <Icon className="size-3" />}
            </span>
            {SECTION_STATUS_LABELS[status]}
          </li>
        )
      })}
    </ul>
  )
}
