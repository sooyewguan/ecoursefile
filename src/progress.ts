import type { SectionStatus } from './sections.ts'

/**
 * How far a course file has got, counted as the reports count it: the sections that count toward
 * completeness, how many of them are uploaded (not missing), and how many are Needs fix. A section
 * counts when section_statuses says so and it is not Empty, so sections 7 to 9 count once they hold
 * a file or a verdict.
 */
export function courseFileProgress(statuses: readonly { status: SectionStatus; counts_toward_completeness: boolean }[]) {
  const counted = statuses.filter((row) => row.counts_toward_completeness && row.status !== 'empty')
  return {
    counted: counted.length,
    uploaded: counted.filter((row) => row.status !== 'missing').length,
    needsFix: counted.filter((row) => row.status === 'needs_fix').length,
  }
}
