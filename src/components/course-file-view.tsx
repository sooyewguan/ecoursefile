import { createContext, useContext } from 'react'
import { Outlet } from 'react-router'
import { useAuth } from '../auth-provider.tsx'
import { COURSE_FILE_AREAS, courseFilePath, overviewView, type CourseFileView } from '../course-file-views.ts'

const ViewContext = createContext<CourseFileView>('reader')

/** The routes of one course file view. Every page under it reads the view with useCourseFileView. */
export function CourseFileViewRoutes({ view }: { view: CourseFileView }) {
  return (
    <ViewContext.Provider value={view}>
      <Outlet />
    </ViewContext.Provider>
  )
}

/**
 * The view the course file page is in, with the address of its list and of its course files. See
 * CourseFileView for what each view lets the user do.
 */
export function useCourseFileView() {
  const view = useContext(ViewContext)
  return {
    view,
    area: COURSE_FILE_AREAS[view],
    path: (offeringId: string, section?: number) => courseFilePath(view, offeringId, section),
  }
}

/**
 * The address of a course file, or one of its sections, for a link from Reports or the faculty
 * overview: in the auditor view for an auditor, else in the read-only view.
 */
export function useOverviewPath() {
  const auth = useAuth()
  const view = overviewView(auth.kind === 'ready' ? auth.roles : [])
  return (offeringId: string, section?: number) => courseFilePath(view, offeringId, section)
}
