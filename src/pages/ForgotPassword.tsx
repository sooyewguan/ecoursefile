import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AuthLayout } from '@/components/auth-layout'
import { ErrorAlert } from '@/components/notice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { friendlyError } from '../errors.ts'
import { supabase } from '../supabase.ts'

const backToSignIn = (
  <Link to="/sign-in" className="underline underline-offset-4">
    Back to sign in
  </Link>
)

export function ForgotPassword() {
  /** The email the link went to, once it has gone. */
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = String(new FormData(event.currentTarget).get('email')).trim()
    setBusy(true)
    // The Send Email Hook links to the reset page on this origin, once Supabase Auth has checked it.
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    setBusy(false)
    // Supabase Auth refuses a repeat request for an email with an account with HTTP 429, and answers
    // one with no account as before, so a 429 reads as sent, which says no more.
    if (error && error.status !== 429) setError(friendlyError(error))
    else setSentTo(email)
  }

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" footer={backToSignIn}>
        <p className="text-muted-foreground text-center text-sm">
          If an account exists for <span className="text-foreground font-medium break-all">{sentTo}</span>, we sent a reset link. It expires in 1 hour.
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Reset your password" description="We'll email you a link to reset it." footer={backToSignIn}>
      <form onSubmit={onSubmit} className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="username" autoFocus required />
        </div>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy && <Spinner />}
          Email me a link
        </Button>
      </form>
    </AuthLayout>
  )
}
