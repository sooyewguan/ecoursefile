import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { SECTIONS } from '../sections.ts'

/** Links to the sections before and after this one in the course file, at the foot of a section page. A phone wraps their titles. */
export function SectionPager({ offeringId, section }: { offeringId: string; section: number }) {
  const index = SECTIONS.findIndex((s) => s.number === section)
  const previous = SECTIONS[index - 1]
  const next = SECTIONS[index + 1]
  const link = 'grid h-auto min-w-0 content-start justify-stretch gap-0.5 px-4 py-3 whitespace-normal'
  return (
    <nav aria-label="Sections" className="grid grid-cols-2 gap-3">
      {previous ? (
        <Button asChild variant="outline" className={link}>
          <Link to={`/course-files/${offeringId}/sections/${previous.number}`}>
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <ChevronLeftIcon aria-hidden="true" className="size-3.5" />
              Previous
            </span>
            <span className="font-medium text-pretty sm:truncate">
              {previous.number} {previous.title}
            </span>
          </Link>
        </Button>
      ) : (
        <span />
      )}
      {next && (
        <Button asChild variant="outline" className={`${link} text-right`}>
          <Link to={`/course-files/${offeringId}/sections/${next.number}`}>
            <span className="text-muted-foreground flex items-center justify-end gap-1 text-xs">
              Next
              <ChevronRightIcon aria-hidden="true" className="size-3.5" />
            </span>
            <span className="font-medium text-pretty sm:truncate">
              {next.number} {next.title}
            </span>
          </Link>
        </Button>
      )}
    </nav>
  )
}
