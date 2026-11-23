import { useRef, useState, type FormEvent } from 'react'
import { AuthLayout } from '@/components/auth-layout'
import { editsErrorField, FormErrors, type ActionError } from '@/components/form-errors'
import { confirmationError, NewPasswordFields, newPasswordError } from '@/components/password-fields'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '../auth-provider.tsx'
import { supabase } from '../supabase.ts'

export function ChangePassword() {
  const state = useAuth()
  const form = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<ActionError | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const mismatch = confirmationError(fields)
    if (mismatch) return setError(mismatch)
    setBusy(true)
    // On success supabase-js emits USER_UPDATED, the auth state re-reads the cleared flag,
    // and the route guard moves the user on to /.
    const { error } = await supabase.auth.updateUser({ password: String(fields.get('password')) })
    setBusy(false)
    setError(error && newPasswordError(error))
  }

  return (
    <AuthLayout
      title="Set a new password"
      description="Replace your temporary password to continue."
      footer={
        <>
          {state.kind === 'must-change-password' && <>Signed in as {state.profile.email}. </>}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-sm underline"
            onClick={() => void supabase.auth.signOut()}
          >
            Sign out
          </Button>
        </>
      }
    >
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
