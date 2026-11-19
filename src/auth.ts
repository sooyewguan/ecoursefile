import type { GlobalRole } from './roles.ts'

export type Profile = { id: string; email: string; fullName: string }

export type AuthState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'must-change-password'; profile: Profile }
  | { kind: 'ready'; profile: Profile; roles: GlobalRole[] }

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
      return path === '/sign-in' || path === '/change-password' ? '/' : null
  }
}
