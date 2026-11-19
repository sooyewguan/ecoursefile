import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import { redirectFor } from './auth.ts'
import { AuthProvider, useAuth } from './auth-provider.tsx'
import { ChangePassword } from './pages/ChangePassword.tsx'
import { Home } from './pages/Home.tsx'
import { SignIn } from './pages/SignIn.tsx'

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Guard />}>
            <Route path="/" element={<Home />} />
            <Route path="/sign-in" element={<SignIn />} />
            <Route path="/change-password" element={<ChangePassword />} />
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
  if (state.kind === 'loading') return <p>Loading…</p>
  return <Outlet />
}
