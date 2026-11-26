import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { rolesFromAccessToken, type AuthState } from './auth.ts'
import { clearFileCache } from './file-cache.ts'
import { turnOffPush } from './push.ts'
import { supabase } from './supabase.ts'

const AuthContext = createContext<AuthState>({ kind: 'loading' })

const ReloadAuthContext = createContext<() => Promise<void>>(async () => {})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: 'loading' })
  const latest = useRef(0)

  /** Reads the state for the session, and sets it unless a later read has started. */
  const load = useCallback(async (session: Session | null) => {
    const read = ++latest.current
    const next = await readAuthState(session)
    if (read === latest.current) setState(next)
  }, [])

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Every way out, such as the menu or the change-password page, ends here, so the next user of
      // the browser finds none of this user's files.
      if (event === 'SIGNED_OUT') void clearFileCache()
      // supabase-js holds its auth lock during this callback and queries wait for that lock,
      // so read the profile after the callback returns.
      setTimeout(() => void load(session))
    })
    return () => data.subscription.unsubscribe()
  }, [load])

  const reload = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    await load(data.session)
  }, [load])

  return (
    <ReloadAuthContext value={reload}>
      <AuthContext value={state}>{children}</AuthContext>
    </ReloadAuthContext>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

/** Reads the signed-in user's profile again, such as after they change their name, so every page shows the change. */
export function useReloadAuth() {
  return useContext(ReloadAuthContext)
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
    .select('id, email, full_name, title, display_name, department_id, must_change_password')
    .eq('id', session.user.id)
    .single()
  if (error) {
    console.error('Could not read the signed-in profile', error)
    return { kind: 'signed-out' }
  }

  const row: {
    id: string
    email: string
    full_name: string
    title: string | null
    display_name: string
    department_id: string | null
    must_change_password: boolean
  } = data
  const profile = { id: row.id, email: row.email, fullName: row.full_name, title: row.title, displayName: row.display_name, departmentId: row.department_id }
  if (row.must_change_password) return { kind: 'must-change-password', profile }
  // The same roles that RLS reads, so the pages offered match what the database allows.
  return { kind: 'ready', profile, roles: rolesFromAccessToken(session.access_token) }
}
