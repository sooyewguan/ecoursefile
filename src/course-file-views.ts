import type { GlobalRole } from './roles.ts'

/**
 * The job a course file page is for. Each role that opens course files has pages of its own, and
 * the page, not the roles the user holds, decides what they may do there. A lecturer who also
 * audits gets both sets of pages, and each set offers only its own role's actions.
 *
 * - `lecturer`: the course files the user teaches or coordinates. They upload, reorder, reuse and
 *   delete files, switch sections 10 to 16, and comment on and reply to audit requests.
 * - `auditor`: every course file. They read its files, mark sections Verified or Needs fix, and
 *   send and close their audit requests. They change no file and switch no section.
 * - `reader`: every course file, read only, for HoDs, deans, deputy deans and the admin.
 */
export type CourseFileView = 'lecturer' | 'auditor' | 'reader'

export const COURSE_FILE_VIEWS = ['lecturer', 'auditor', 'reader'] as const satisfies readonly CourseFileView[]

/** The address of each view's list of course files. A course file of the view is under it. */
export const COURSE_FILE_AREAS = {
  lecturer: '/my-course-files',
  auditor: '/audit',
  reader: '/course-files',
} as const satisfies Record<CourseFileView, string>

/** The address of a course file in the view, or of one of its sections. */
export function courseFilePath(view: CourseFileView, offeringId: string, section?: number) {
  const page = `${COURSE_FILE_AREAS[view]}/${offeringId}`
  return section === undefined ? page : `${page}/sections/${section}`
}

/**
 * The view that Reports and the faculty overview on Home open a course file in. An auditor opens it
 * to audit it, and the admin, HoDs, deans and deputy deans to read it.
 */
export function overviewView(roles: readonly GlobalRole[]): CourseFileView {
  return roles.includes('auditor') ? 'auditor' : 'reader'
}

/**
 * Where an address under /course-files goes for a user who may not open it there: the same page in
 * the lecturer view for a lecturer, else in the auditor view for an auditor, else nowhere. Before
 * each role had its own pages, every course file was under /course-files, and notifications sent
 * then still link there.
 */
export function movedCourseFilePath(roles: readonly GlobalRole[], path: string): string | null {
  const area = COURSE_FILE_AREAS.reader
  if (path !== area && !path.startsWith(`${area}/`)) return null
  const view = roles.includes('lecturer') ? 'lecturer' : roles.includes('auditor') ? 'auditor' : null
  return view && COURSE_FILE_AREAS[view] + path.slice(area.length)
}
