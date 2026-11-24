import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Link } from 'react-router'
import { SECTIONS } from '../sections.ts'

/** Links to the sections before and after this one in the course file, at the foot of a section page. A phone wraps their titles. */
export function SectionPager({ offeringId, section }: { offeringId: string; section: number }) {
  const index = SECTIONS.findIndex((s) => s.number === section)
  const previous = SECTIONS[index - 1]
  const next = SECTIONS[index + 1]
  const link = 'hover:bg-accent/50 grid min-w-0 content-start gap-0.5 rounded-lg border px-4 py-3 text-sm'
  return (
    <nav aria-label="Sections" className="grid grid-cols-2 gap-3">
      {previous ? (
        <Link to={`/course-files/${offeringId}/sections/${previous.number}`} className={link}>
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <ChevronLeftIcon aria-hidden="true" className="size-3.5" />
            Previous
          </span>
          <span className="font-medium text-pretty sm:truncate">
            {previous.number} {previous.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link to={`/course-files/${offeringId}/sections/${next.number}`} className={`${link} text-right`}>
          <span className="text-muted-foreground flex items-center justify-end gap-1 text-xs">
            Next
            <ChevronRightIcon aria-hidden="true" className="size-3.5" />
          </span>
          <span className="font-medium text-pretty sm:truncate">
            {next.number} {next.title}
          </span>
        </Link>
      )}
    </nav>
  )
}
