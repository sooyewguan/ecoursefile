import { Link } from 'react-router'
import { canOpen, ROLE_PAGES } from '../auth.ts'
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
      <nav>
        <ul>
          {ROLE_PAGES.filter((page) => canOpen(state.roles, page.path)).map((page) => (
            <li key={page.path}>
              <Link to={page.path}>{page.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <button type="button" onClick={() => void supabase.auth.signOut()}>
        Sign out
      </button>
    </main>
  )
}
