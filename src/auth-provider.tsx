import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { rolesFromAccessToken, type AuthState } from './auth.ts'
import { turnOffPush } from './push.ts'
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
        const next = await readAuthState(session)
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

/** Signs out, after taking this browser's push token off the account, so the next user of the browser gets none of this user's notifications. */
export async function signOut() {
  await turnOffPush(supabase)
  await supabase.auth.signOut()
}

async function readAuthState(session: Session | null): Promise<AuthState> {
  if (!session) return { kind: 'signed-out' }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, phone, must_change_password')
    .eq('id', session.user.id)
    .single()
  if (error) {
    console.error('Could not read the signed-in profile', error)
    return { kind: 'signed-out' }
  }

  const row: { id: string; email: string; full_name: string; phone: string | null; must_change_password: boolean } = data
  const profile = { id: row.id, email: row.email, fullName: row.full_name, phone: row.phone }
  if (row.must_change_password) return { kind: 'must-change-password', profile }
  // The same roles that RLS reads, so the pages offered match what the database allows.
  return { kind: 'ready', profile, roles: rolesFromAccessToken(session.access_token) }
}
