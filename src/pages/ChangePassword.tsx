import { useState, type FormEvent } from 'react'
import { AuthLayout } from '@/components/auth-layout'
import { ErrorAlert } from '@/components/notice'
import { TacFields } from '@/components/tac-fields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { signOut, useAuth } from '../auth-provider.tsx'
import { setPassword } from '../password.ts'
import type { TacChallenge } from '../phone.ts'
import { supabase } from '../supabase.ts'

/**
 * The page a user must pass before any other while their password is temporary: at their first
 * sign-in, and after an admin reset it. A user with no phone registers it here with a TAC, and a
 * user with one gets the TAC on it.
 */
export function ChangePassword() {
  const state = useAuth()
  const [challenge, setChallenge] = useState<TacChallenge | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The route guard sends every other state away from this page.
  if (state.kind !== 'must-change-password') return null
  const { profile } = state

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password'))
    if (password !== String(form.get('confirm'))) {
      setError('The two passwords do not match.')
      return
    }
    if (!challenge) {
      setError('Send a TAC to your phone first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await setPassword(supabase, await challenge.confirm(String(form.get('tac'))), password)
      // The new password ended this session. Signing in with it clears the flag in the auth state,
      // and the route guard moves the user on to /.
      const { error } = await supabase.auth.signInWithPassword({ email: profile.email, password })
      if (error) throw error
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Set a new password"
      description={
        profile.phone
          ? 'Set a new password before you continue. We will text a TAC to your phone to confirm it.'
          : 'Set a new password and register your phone before you continue. Every later password change needs a TAC to this phone.'
      }
      footer={
        <>
          Signed in as {profile.email}.{' '}
          <Button type="button" variant="link" className="h-auto p-0 text-sm underline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </div>
        <TacFields fixedPhone={profile.phone} phoneLabel={profile.phone ? 'Your phone' : 'Your phone number'} challenge={challenge} onChallenge={setChallenge} />
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <Button type="submit" disabled={busy || !challenge} className="w-full">
          {busy && <Spinner />}
          Set password
        </Button>
      </form>
    </AuthLayout>
  )
}
