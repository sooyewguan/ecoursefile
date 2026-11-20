import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AuthLayout } from '@/components/auth-layout'
import { ErrorAlert } from '@/components/notice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { supabase } from '../supabase.ts'

export function SignIn() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get('email')),
      password: String(form.get('password')),
    })
    setBusy(false)
    setError(error?.message ?? null)
  }

  return (
    <AuthLayout title="Sign in" description="Use your staff email and password.">
      <form onSubmit={onSubmit} className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <div className="grid gap-2">
          <div className="flex items-center">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="ml-auto text-sm underline-offset-4 hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy && <Spinner />}
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}
