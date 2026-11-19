import { useAuth } from '../auth-provider.tsx'
import { supabase } from '../supabase.ts'

export function Home() {
  const state = useAuth()
  if (state.kind !== 'ready') return null

  return (
    <main>
      <h1>{state.profile.fullName}</h1>
      <p>Signed in as {state.profile.email}</p>
      <p>Roles: {state.roles.length > 0 ? state.roles.join(', ') : 'none'}</p>
      <button type="button" onClick={() => void supabase.auth.signOut()}>
        Sign out
      </button>
    </main>
  )
}
