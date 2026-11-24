import { cn, plural } from '@/lib/utils'
import type { OfferingRow } from '../reports.ts'

/** The sections that count, as a row of a report gives them. */
export type SectionCounts = Pick<OfferingRow, 'counted_sections' | 'uploaded_sections' | 'verified_sections' | 'needs_fix_sections'>

/** The parts of the sections that count, in bar order: Verified, Pending review, Needs fix, and Missing as the rest of the bar. */
const PARTS: { label: string; className: string; count: (row: SectionCounts) => number }[] = [
  { label: 'Verified', className: 'bg-success', count: (row) => row.verified_sections },
  { label: 'Pending review', className: 'bg-info', count: (row) => row.uploaded_sections - row.verified_sections - row.needs_fix_sections },
  { label: 'Needs fix', className: 'bg-warning', count: (row) => row.needs_fix_sections },
  { label: 'Missing', className: 'bg-muted-foreground/20', count: (row) => row.counted_sections - row.uploaded_sections },
]

/**
 * A thin bar of the sections that count, split by status in share of the total. A part of zero
 * draws nothing. Its name gives every part's count, and each part names its count on hover.
 */
export function SectionBar({ counts, className }: { counts: SectionCounts; className?: string }) {
  const parts = PARTS.map(({ label, className, count }) => ({ label, className, value: count(counts) }))
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  return (
    <div
      role="img"
      aria-label={parts.map((part) => `${part.label} ${part.value}`).join(', ') + ` of ${plural(total, 'section')}`}
      className={cn('flex h-2 w-full gap-0.5', className)}
    >
      {total === 0 ? (
        <span className="bg-muted-foreground/20 h-full flex-1 rounded-full" />
      ) : (
        parts
          .filter((part) => part.value > 0)
          .map((part) => (
            <span
              key={part.label}
              title={`${part.label}: ${part.value} of ${total}`}
              className={cn('h-full min-w-1 rounded-full', part.className)}
              style={{ flexGrow: part.value, flexBasis: 0 }}
            />
          ))
      )}
    </div>
  )
}

/** What each color of a SectionBar stands for. */
export function SectionBarLegend({ className }: { className?: string }) {
  return (
    <ul aria-label="Legend" className={cn('text-muted-foreground flex flex-wrap gap-x-4 gap-y-1.5 text-xs', className)}>
      {PARTS.map((part) => (
        <li key={part.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('size-2 rounded-full', part.className)} />
          {part.label}
        </li>
      ))}
    </ul>
  )
}
