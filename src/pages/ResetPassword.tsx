import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { AuthLayout } from '@/components/auth-layout'
import { editsErrorField, FormErrors, type ActionError } from '@/components/form-errors'
import { confirmationError, NewPasswordFields, newPasswordError } from '@/components/password-fields'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '../auth-provider.tsx'
import { friendlyError } from '../errors.ts'
import { supabase } from '../supabase.ts'

const backToSignIn = (
  <Link to="/sign-in" className="underline underline-offset-4">
    Back to sign in
  </Link>
)

/** The page that the link in a reset email opens, with the link's token hash in token_hash. */
export function ResetPassword() {
  const state = useAuth()
  const [params] = useSearchParams()
  const tokenHash = params.get('token_hash')
  const form = useRef<HTMLFormElement>(null)
  // Whether the link's token has signed the user in. It works once, so a retry only sets the password.
  const [signedInByLink, setSignedInByLink] = useState(false)
  const [expired, setExpired] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<ActionError | null>(null)
  const [busy, setBusy] = useState(false)

  // Setting the password clears the must-change-password flag, so the user goes on to the app.
  if (done && state.kind === 'ready') return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const mismatch = confirmationError(fields)
    if (mismatch) return setError(mismatch)
    setBusy(true)
    // The token is used only now, so a mail scanner that opens the link does not use it up.
    if (!signedInByLink) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: 'recovery' })
      if (error) {
        setBusy(false)
        // Supabase Auth gives otp_expired for a used token too. Other errors, such as for a deactivated account, show as they are.
        if (error.code === 'otp_expired') setExpired(true)
        else setError(friendlyError(error))
        return
      }
      setSignedInByLink(true)
    }
    const { error } = await supabase.auth.updateUser({ password: String(fields.get('password')) })
    setBusy(false)
    setError(error && newPasswordError(error))
    setDone(!error)
  }

  if (!tokenHash || expired) {
    return (
      <AuthLayout title={expired ? 'This link has expired' : "This link doesn't work"} footer={backToSignIn}>
        <div className="grid gap-5">
          {!expired && <p className="text-muted-foreground text-center text-sm">Open the link from your email again, or request a new one.</p>}
          <Button asChild className="w-full">
            <Link to="/forgot-password">Request a new link</Link>
          </Button>
        </div>
      </AuthLayout>
    )
  }

  if (done) {
    return (
      <AuthLayout title="Password set">
        <Button asChild className="w-full">
          <Link to="/">Continue</Link>
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Set a new password" footer={backToSignIn}>
      <form ref={form} onSubmit={onSubmit} onInput={(event) => editsErrorField(error, event.target) && setError(null)} className="grid gap-5">
        <FormErrors form={form} error={error}>
          <NewPasswordFields />
        </FormErrors>
        <Button type="submit" disabled={busy} className="w-full">
          {busy && <Spinner />}
          Set password
        </Button>
      </form>
    </AuthLayout>
  )
}
