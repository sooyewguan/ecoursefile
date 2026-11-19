import { useState, type FormEvent } from 'react'
import { supabase } from '../supabase.ts'

export function ChangePassword() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password'))
    if (password !== String(form.get('confirm'))) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    // On success supabase-js emits USER_UPDATED, the auth state re-reads the cleared flag,
    // and the route guard moves the user on to /.
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    setError(error?.message ?? null)
  }

  return (
    <main>
      <h1>Set a new password</h1>
      <p>You need to set a new password before you can continue.</p>
      <form onSubmit={onSubmit}>
        <label>
          New password
          <input name="password" type="password" autoComplete="new-password" required />
        </label>
        <label>
          Confirm new password
          <input name="confirm" type="password" autoComplete="new-password" required />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          Set password
        </button>
      </form>
      <button type="button" onClick={() => void supabase.auth.signOut()}>
        Sign out
      </button>
    </main>
  )
}
