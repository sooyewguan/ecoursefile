import { FolderOpenIcon } from 'lucide-react'
import { ThemeProvider } from 'next-themes'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router'
import { AppShell } from '@/components/app-shell'
import { NotFound } from '@/components/page'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'
import { redirectFor } from './auth.ts'
import { AuthProvider, useAuth } from './auth-provider.tsx'
import { ChangePassword } from './pages/ChangePassword.tsx'
import { Completeness } from './pages/Completeness.tsx'
import { CourseFile, NoSectionChosen } from './pages/CourseFile.tsx'
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
                <Route path="/course-files" element={<CourseFiles />} />
                <Route path="/course-files/:offeringId" element={<CourseFileRoute />}>
                  <Route element={<CourseFile />}>
                    <Route index element={<NoSectionChosen />} />
                    <Route path={`sections/${LECTURER_FILE_SECTION.number}`} element={<LecturerTimetables />} />
                    <Route path={`sections/${PROGRAM_CODE_FILE_SECTION.number}`} element={<StudentTimetables />} />
                    <Route path="sections/:section" element={<CourseFileSection />} />
                  </Route>
                </Route>
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
 * One course file, or Course file not found when the address's id cannot be one. The course file
 * stays on the page while its sections open beside its section list. A different course file starts
 * afresh.
 */
function CourseFileRoute() {
  const { offeringId } = useParams()
  if (UUID.test(offeringId ?? '')) return <Outlet key={offeringId} />
  return <NotFound icon={FolderOpenIcon} title="Course file not found" backTo="/course-files" backLabel="All course files" />
}

function Guard() {
  const state = useAuth()
  const { pathname } = useLocation()
  const target = redirectFor(state, pathname)
  if (target) return <Navigate to={target} replace />
  if (state.kind === 'loading') {
    return (
      <div className="text-muted-foreground flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  return <Outlet />
}
