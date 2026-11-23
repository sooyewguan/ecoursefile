import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AuthLayout } from '@/components/auth-layout'
import { ErrorAlert } from '@/components/notice'
import { TacFields } from '@/components/tac-fields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { resetPassword } from '../password.ts'
import type { TacChallenge } from '../phone.ts'
import { supabase } from '../supabase.ts'

/**
 * A signed-out user who forgot their password gets a TAC on the phone of their account, sets a new
 * password, and is signed in with it. Only the phone's owner gets the TAC, so the page may say when
 * no active account has the phone.
 */
export function ForgotPassword() {
  const [challenge, setChallenge] = useState<TacChallenge | null>(null)
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
    if (!challenge) {
      setError('Send a TAC to your phone first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { email } = await resetPassword(supabase, await challenge.confirm(String(form.get('tac'))), password)
      // Signing in moves the user on to the app.
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter the phone number on your account. We will text you a TAC, and you choose a new password."
      footer={
        <div className="grid gap-2">
          <p>Lost your phone? Ask an admin to reset your password.</p>
          <Link to="/sign-in" className="underline underline-offset-4">
            Back to sign in
          </Link>
        </div>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-5">
        <TacFields challenge={challenge} onChallenge={setChallenge} />
        <div className="grid gap-2">
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </div>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <Button type="submit" disabled={busy || !challenge} className="w-full">
          {busy && <Spinner />}
          Set password and sign in
        </Button>
      </form>
    </AuthLayout>
  )
}
