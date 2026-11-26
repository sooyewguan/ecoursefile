import { useCallback } from 'react'
import { useOutletContext } from 'react-router'

/** What a section open beside a course file's section list gets from the course file. */
export type CourseFileOutlet = { refresh: () => Promise<void> }

/**
 * Loads the course file's section statuses again, for a section open beside the list after it
 * changes its files, items, setting or review. Outside a course file it does nothing.
 */
export function useRefreshCourseFile(): () => void {
  const outlet = useOutletContext<CourseFileOutlet | undefined>()
  return useCallback(() => void outlet?.refresh(), [outlet])
}
