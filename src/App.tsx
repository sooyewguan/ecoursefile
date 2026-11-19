import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import { AppShell } from '@/components/app-shell'
import { Spinner } from '@/components/ui/spinner'
import { redirectFor } from './auth.ts'
import { AuthProvider, useAuth } from './auth-provider.tsx'
import { ChangePassword } from './pages/ChangePassword.tsx'
import { CourseFile } from './pages/CourseFile.tsx'
import { CourseFiles } from './pages/CourseFiles.tsx'
import { CourseFileSection } from './pages/CourseFileSection.tsx'
import { Courses } from './pages/Courses.tsx'
import { CourseTypes } from './pages/CourseTypes.tsx'
import { Departments } from './pages/Departments.tsx'
import { Home } from './pages/Home.tsx'
import { LecturerTimetables } from './pages/LecturerTimetables.tsx'
import { ProgramCodes } from './pages/ProgramCodes.tsx'
import { Semester } from './pages/Semester.tsx'
import { Semesters } from './pages/Semesters.tsx'
import { SignIn } from './pages/SignIn.tsx'
import { StudentTimetables } from './pages/StudentTimetables.tsx'
import { Users } from './pages/Users.tsx'
import { LECTURER_FILE_SECTION, PROGRAM_CODE_FILE_SECTION } from './sections.ts'

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Guard />}>
            <Route path="/sign-in" element={<SignIn />} />
            <Route path="/change-password" element={<ChangePassword />} />
            <Route element={<AppShell />}>
              <Route path="/" element={<Home />} />
              <Route path="/users" element={<Users />} />
              <Route path="/departments" element={<Departments />} />
              <Route path="/course-types" element={<CourseTypes />} />
              <Route path="/courses" element={<Courses />} />
              <Route path="/program-codes" element={<ProgramCodes />} />
              <Route path="/semesters" element={<Semesters />} />
              <Route path="/semesters/:semesterId" element={<Semester />} />
              <Route path="/course-files" element={<CourseFiles />} />
              <Route path="/course-files/:offeringId" element={<CourseFile />} />
              <Route path={`/course-files/:offeringId/sections/${LECTURER_FILE_SECTION.number}`} element={<LecturerTimetables />} />
              <Route path={`/course-files/:offeringId/sections/${PROGRAM_CODE_FILE_SECTION.number}`} element={<StudentTimetables />} />
              <Route path="/course-files/:offeringId/sections/:section" element={<CourseFileSection />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
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
