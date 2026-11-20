import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AuthLayout } from '@/components/auth-layout'
import { NoticeAlert, type Notice } from '@/components/notice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { supabase } from '../supabase.ts'

export function ForgotPassword() {
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = String(new FormData(event.currentTarget).get('email')).trim()
    setBusy(true)
    // The Send Email Hook links to the reset page on this origin, once Supabase Auth has checked it.
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    setBusy(false)
    // The answer is the same whether or not the email has an account, so the page says no more.
    setNotice(
      error
        ? { tone: 'error', text: error.message }
        : { tone: 'success', text: `If ${email} belongs to an active account, it will get a link to set a new password. The link works once, within one hour.` },
    )
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter your staff email, and we will email you a link to set a new password."
      footer={
        <Link to="/sign-in" className="underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </div>
        {notice && <NoticeAlert notice={notice} />}
        <Button type="submit" disabled={busy} className="w-full">
          {busy && <Spinner />}
          Email me a link
        </Button>
      </form>
    </AuthLayout>
  )
}
