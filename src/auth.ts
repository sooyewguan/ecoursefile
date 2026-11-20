import { isGlobalRole, type GlobalRole } from './roles.ts'

export type Profile = { id: string; email: string; fullName: string }

export type AuthState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'must-change-password'; profile: Profile }
  | { kind: 'ready'; profile: Profile; roles: GlobalRole[] }

/**
 * Pages that only some roles may open, with the pages below them, such as /semesters/<id>.
 * Every other page is open to any signed-in user.
 */
export const ROLE_PAGES = [
  { path: '/course-files', label: 'Course files', roles: ['admin', 'lecturer', 'auditor', 'hod', 'dean', 'deputy_dean'] },
  { path: '/users', label: 'Users', roles: ['root', 'admin'] },
  { path: '/departments', label: 'Departments', roles: ['admin'] },
  { path: '/course-types', label: 'Course types', roles: ['admin'] },
  { path: '/courses', label: 'Courses', roles: ['admin'] },
  { path: '/program-codes', label: 'Program codes', roles: ['admin'] },
  { path: '/semesters', label: 'Semesters', roles: ['admin'] },
  { path: '/onedrive-check', label: 'OneDrive check', roles: ['admin'] },
] as const satisfies readonly { path: string; label: string; roles: readonly GlobalRole[] }[]

export function canOpen(roles: readonly GlobalRole[], path: string): boolean {
  const page = ROLE_PAGES.find((p) => path === p.path || path.startsWith(`${p.path}/`))
  return !page || page.roles.some((role) => roles.includes(role))
}

/** Where to send a visitor in this state who asked for this path, or null to let them stay. */
export function redirectFor(state: AuthState, path: string): string | null {
  switch (state.kind) {
    case 'loading':
      return null
    case 'signed-out':
      return path === '/sign-in' ? null : '/sign-in'
    case 'must-change-password':
      return path === '/change-password' ? null : '/change-password'
    case 'ready':
      if (path === '/sign-in' || path === '/change-password') return '/'
      return canOpen(state.roles, path) ? null : '/'
  }
}

/** The global roles in the app_roles claim, which the access token hook adds and RLS reads. */
export function rolesFromAccessToken(accessToken: string): GlobalRole[] {
  const payload = accessToken.split('.')[1] ?? ''
  const bytes = Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  const claims: { app_roles?: unknown } = JSON.parse(new TextDecoder().decode(bytes))
  return Array.isArray(claims.app_roles) ? claims.app_roles.filter(isGlobalRole) : []
}
