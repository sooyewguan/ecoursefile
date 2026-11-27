import { FolderOpenIcon } from 'lucide-react'
import { ThemeProvider } from 'next-themes'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router'
import { AppShell } from '@/components/app-shell'
import { CourseFileViewRoutes, useCourseFileView } from '@/components/course-file-view'
import { NotFound } from '@/components/page'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'
import { redirectFor } from './auth.ts'
import { AuthProvider, useAuth } from './auth-provider.tsx'
import { COURSE_FILE_AREAS, COURSE_FILE_VIEWS, movedCourseFilePath } from './course-file-views.ts'
import { ChangePassword } from './pages/ChangePassword.tsx'
import { Completeness } from './pages/Completeness.tsx'
import { CourseFile } from './pages/CourseFile.tsx'
import { CourseFiles } from './pages/CourseFiles.tsx'
import { CourseFileSection } from './pages/CourseFileSection.tsx'
import { Courses } from './pages/Courses.tsx'
import { CourseTypes } from './pages/CourseTypes.tsx'
import { Departments } from './pages/Departments.tsx'
import { FileViewer } from './pages/FileViewer.tsx'
import { ForgotPassword } from './pages/ForgotPassword.tsx'
import { Home } from './pages/Home.tsx'
import { LecturerTimetables } from './pages/LecturerTimetables.tsx'
import { Profile } from './pages/Profile.tsx'
import { ProgramCodes } from './pages/ProgramCodes.tsx'
import { Reports } from './pages/Reports.tsx'
import { Semester } from './pages/Semester.tsx'
import { Semesters } from './pages/Semesters.tsx'
import { SignIn } from './pages/SignIn.tsx'
import { StudentTimetables } from './pages/StudentTimetables.tsx'
import { Users } from './pages/Users.tsx'
import { LECTURER_FILE_SECTION, PROGRAM_CODE_FILE_SECTION } from './sections.ts'

export function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AuthProvider>
        <Toaster />
        <BrowserRouter>
          <Routes>
            <Route element={<Guard />}>
              <Route path="/sign-in" element={<SignIn />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/change-password" element={<ChangePassword />} />
              <Route path="/files/:fileId" element={<FileViewer />} />
              <Route element={<AppShell />}>
                <Route path="/" element={<Home />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/users" element={<Users />} />
                <Route path="/departments" element={<Departments />} />
                <Route path="/course-types" element={<CourseTypes />} />
                <Route path="/courses" element={<Courses />} />
                <Route path="/program-codes" element={<ProgramCodes />} />
                <Route path="/semesters" element={<Semesters />} />
                <Route path="/semesters/:semesterId" element={<Semester />} />
                {COURSE_FILE_VIEWS.map((view) => (
                  <Route key={view} element={<CourseFileViewRoutes view={view} />}>
                    <Route path={COURSE_FILE_AREAS[view]} element={<CourseFiles />} />
                    <Route path={`${COURSE_FILE_AREAS[view]}/:offeringId`} element={<CourseFileRoute />}>
                      <Route index element={<CourseFile />} />
                      <Route path={`sections/${LECTURER_FILE_SECTION.number}`} element={<LecturerTimetables />} />
                      <Route path={`sections/${PROGRAM_CODE_FILE_SECTION.number}`} element={<StudentTimetables />} />
                      <Route path="sections/:section" element={<CourseFileSection />} />
                    </Route>
                  </Route>
                ))}
                <Route path="/completeness" element={<Completeness />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/profile" element={<Profile />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}

/** The form of every id, so an address with any other offering id names no course file. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The pages of one course file, or Course file not found when the address's id cannot be one. Each
 * address is a page of its own, so Next and Previous start the section page afresh rather than show
 * or act on the section it came from.
 */
function CourseFileRoute() {
  const { pathname } = useLocation()
  const { area } = useCourseFileView()
  if (UUID.test(useParams().offeringId ?? '')) return <Outlet key={pathname} />
  return <NotFound icon={FolderOpenIcon} title="Course file not found" backTo={area} backLabel="All course files" />
}

function Guard() {
  const state = useAuth()
  const { pathname, search, hash } = useLocation()
  const target = redirectFor(state, pathname)
  // A course file moved to the user's own view keeps its semester, tab and audit request.
  if (target) return <Navigate to={state.kind === 'ready' && target === movedCourseFilePath(state.roles, pathname) ? target + search + hash : target} replace />
  if (state.kind === 'loading') {
    return (
      <div className="text-muted-foreground flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  return <Outlet />
}
