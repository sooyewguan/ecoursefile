import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AuthState } from './auth.ts'
import type { GlobalRole } from './roles.ts'
import { supabase } from './supabase.ts'

const AuthContext = createContext<AuthState>({ kind: 'loading' })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: 'loading' })

  useEffect(() => {
    let latest = 0
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const read = ++latest
      // supabase-js holds its auth lock during this callback and queries wait for that lock,
      // so read the profile after the callback returns.
      setTimeout(async () => {
        const next = await readAuthState(session?.user.id ?? null)
        if (read === latest) setState(next)
      })
    })
    return () => data.subscription.unsubscribe()
  }, [])

  return <AuthContext value={state}>{children}</AuthContext>
}

export function useAuth() {
  return useContext(AuthContext)
}

async function readAuthState(userId: string | null): Promise<AuthState> {
  if (!userId) return { kind: 'signed-out' }

  const [profileResult, rolesResult] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, must_change_password').eq('id', userId).single(),
    supabase.from('user_roles').select('role').eq('user_id', userId),
  ])
  if (profileResult.error || rolesResult.error) {
    console.error('Could not read the signed-in profile', profileResult.error ?? rolesResult.error)
    return { kind: 'signed-out' }
  }

  const row: { id: string; email: string; full_name: string; must_change_password: boolean } = profileResult.data
  const profile = { id: row.id, email: row.email, fullName: row.full_name }
  if (row.must_change_password) return { kind: 'must-change-password', profile }
  const roles: GlobalRole[] = rolesResult.data.map((r: { role: GlobalRole }) => r.role)
  return { kind: 'ready', profile, roles }
}
