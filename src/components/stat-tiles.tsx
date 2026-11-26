import { CircleCheckIcon, FolderOpenIcon, UploadIcon, WrenchIcon, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { SUMMARY_TABLE } from '../report-tables.ts'
import { formatPercent, type FacultySummary } from '../reports.ts'

/** One headline number: what it counts, the number, a line under it, and its icon in the tone of its status. */
export type Stat = { label: string; value: ReactNode; detail?: ReactNode; icon: LucideIcon; tone: string }

/** How many of the offerings are complete and verified, such as 3 complete · 1 verified. */
export function offeringsDetail(row: Pick<FacultySummary, 'complete_offerings' | 'verified_offerings'>) {
  return `${row.complete_offerings} complete · ${row.verified_offerings} verified`
}

/** A row of four headline numbers as shadcn cards, two to a row on a phone. Placeholder cards while stats is null. */
export function StatTiles({ stats }: { stats: Stat[] | null }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {(stats ?? Array.from({ length: 4 }, () => null)).map((stat, index) => (
        <Card key={stat?.label ?? index}>
          {stat ? (
            <>
              <CardHeader>
                <CardDescription>{stat.label}</CardDescription>
                <CardTitle className="text-2xl tabular-nums sm:text-3xl">{stat.value}</CardTitle>
                <CardAction>
                  <span className={cn('flex size-8 items-center justify-center rounded-lg', stat.tone)}>
                    <stat.icon aria-hidden="true" className="size-4" />
                  </span>
                </CardAction>
              </CardHeader>
              {stat.detail && <CardFooter className="text-muted-foreground text-sm">{stat.detail}</CardFooter>}
            </>
          ) : (
            <CardHeader>
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-8 w-20" />
            </CardHeader>
          )}
        </Card>
      ))}
    </div>
  )
}

/**
 * The faculty's offerings, with how many are complete and verified, and the shares of its sections
 * that are uploaded, verified and Needs fix, under the summary export's headers.
 */
export function FacultyStatTiles({ summary }: { summary: FacultySummary | null }) {
  const column = SUMMARY_TABLE.columns
  const share = (count: typeof column.uploaded, percent: typeof column.uploadedPercent, row: FacultySummary) => ({
    label: percent.header,
    value: formatPercent(percent.value(row)),
    detail: `${count.value(row)} of ${column.sections.value(row)} sections`,
  })
  return (
    <StatTiles
      stats={
        summary && [
          {
            label: column.offerings.header,
            value: column.offerings.value(summary),
            detail: offeringsDetail(summary),
            icon: FolderOpenIcon,
            tone: 'bg-primary/10 text-primary',
          },
          { ...share(column.uploaded, column.uploadedPercent, summary), icon: UploadIcon, tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
          { ...share(column.verified, column.verifiedPercent, summary), icon: CircleCheckIcon, tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
          { ...share(column.needsFix, column.needsFixPercent, summary), icon: WrenchIcon, tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
        ]
      }
    />
  )
}
