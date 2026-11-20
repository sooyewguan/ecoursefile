import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { AuthLayout } from '@/components/auth-layout'
import { ErrorAlert, SuccessAlert } from '@/components/notice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '../auth-provider.tsx'
import { supabase } from '../supabase.ts'

/** The page that the link in a reset email opens, with the link's token hash in token_hash. */
export function ResetPassword() {
  const state = useAuth()
  const [params] = useSearchParams()
  const tokenHash = params.get('token_hash')
  // Whether the link's token has signed the user in. It works once, so a retry only sets the password.
  const [signedInByLink, setSignedInByLink] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<ReactNode>(null)
  const [busy, setBusy] = useState(false)

  // Setting the password clears the must-change-password flag, so the user goes on to the app.
  if (done && state.kind === 'ready') return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password'))
    if (password !== String(form.get('confirm'))) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    // The token is used only now, so a mail scanner that opens the link does not use it up.
    if (!signedInByLink) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: 'recovery' })
      if (error) {
        setBusy(false)
        // Supabase Auth gives otp_expired for a used token too. Other errors, such as for a deactivated account, keep their message.
        setError(
          error.code === 'otp_expired' ? (
            <>
              This link has expired or has been used. <ForgotPasswordLink>Ask for a new link</ForgotPasswordLink>.
            </>
          ) : (
            error.message
          ),
        )
        return
      }
      setSignedInByLink(true)
    }
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    setError(error?.message ?? null)
    setDone(!error)
  }

  return (
    <AuthLayout
      title="Set a new password"
      description="Choose the password you will sign in with."
      footer={
        <Link to="/sign-in" className="underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      {!tokenHash ? (
        <ErrorAlert>
          This link is not complete. Open the link from the email again, or <ForgotPasswordLink>ask for a new link</ForgotPasswordLink>.
        </ErrorAlert>
      ) : done ? (
        <div className="grid gap-5">
          <SuccessAlert>Your new password is set.</SuccessAlert>
          <Button asChild className="w-full">
            <Link to="/">Continue</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="password">New password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm">Confirm new password</Label>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
          </div>
          {error && <ErrorAlert>{error}</ErrorAlert>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy && <Spinner />}
            Set password
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

function ForgotPasswordLink({ children }: { children: ReactNode }) {
  return (
    <Link to="/forgot-password" className="underline underline-offset-4">
      {children}
    </Link>
  )
}
