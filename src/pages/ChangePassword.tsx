import { useState, type FormEvent } from 'react'
import { AuthLayout } from '@/components/auth-layout'
import { ErrorAlert } from '@/components/notice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '../auth-provider.tsx'
import { supabase } from '../supabase.ts'

export function ChangePassword() {
  const state = useAuth()
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
    <AuthLayout
      title="Set a new password"
      description="You need to set a new password before you can continue."
      footer={
        <>
          {state.kind === 'must-change-password' && <>Signed in as {state.profile.email}. </>}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-sm"
            onClick={() => void supabase.auth.signOut()}
          >
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
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy && <Spinner />}
          Set password
        </Button>
      </form>
    </AuthLayout>
  )
}
