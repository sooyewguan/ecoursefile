import { BellIcon, BellOffIcon } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { NoticeAlert, type Notice } from '@/components/notice'
import { PageHeader } from '@/components/page'
import { TacFields } from '@/components/tac-fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import type { Profile as SignedInProfile } from '../auth.ts'
import { useAuth } from '../auth-provider.tsx'
import { changePhone, setPassword } from '../password.ts'
import type { TacChallenge } from '../phone.ts'
import { pushStatus, turnOffPush, turnOnPush, type PushStatus } from '../push.ts'
import { supabase } from '../supabase.ts'

/** The signed-in user's own account: their details, a new password, a new phone, and notifications on this browser. */
export function Profile() {
  const state = useAuth()
  if (state.kind !== 'ready') return null
  const { profile } = state

  return (
    <div className="grid gap-6">
      <PageHeader title="Your profile" description="Change your password and phone number, and turn on notifications." />
      <Card>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Detail term="Name">{profile.fullName}</Detail>
            <Detail term="Email">{profile.email}</Detail>
            <Detail term="Phone">{profile.phone ?? 'No phone registered'}</Detail>
          </dl>
        </CardContent>
      </Card>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <ChangePasswordCard profile={profile} />
        <ChangePhoneCard />
      </div>
      <NotificationsCard />
    </div>
  )
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-muted-foreground text-sm">{term}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}

function ChangePasswordCard({ profile }: { profile: SignedInProfile }) {
  const [challenge, setChallenge] = useState<TacChallenge | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  // A new key clears the form after a change.
  const [round, setRound] = useState(0)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password'))
    if (password !== String(form.get('confirm'))) {
      setNotice({ tone: 'error', text: 'The two passwords do not match.' })
      return
    }
    if (!challenge) return
    setBusy(true)
    setNotice(null)
    try {
      await setPassword(supabase, await challenge.confirm(String(form.get('tac'))), password)
      // The new password ended every session of the user, this one too, so sign in again with it.
      const { error } = await supabase.auth.signInWithPassword({ email: profile.email, password })
      if (error) throw error
      setChallenge(null)
      setRound(round + 1)
      setNotice({ tone: 'success', text: 'Your new password is set. You are signed out everywhere else.' })
    } catch (failure) {
      setNotice({ tone: 'error', text: failure instanceof Error ? failure.message : String(failure) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Change password</h2>
        </CardTitle>
        <CardDescription>
          {profile.phone ? 'We text a TAC to your phone to confirm the change.' : 'You have no phone yet. The phone you confirm here becomes your phone.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form key={round} onSubmit={onSubmit} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="profile-password">New password</Label>
            <Input id="profile-password" name="password" type="password" autoComplete="new-password" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-confirm">Confirm new password</Label>
            <Input id="profile-confirm" name="confirm" type="password" autoComplete="new-password" required />
          </div>
          <TacFields fixedPhone={profile.phone} phoneLabel="Your phone" challenge={challenge} onChallenge={setChallenge} />
          {notice && <NoticeAlert notice={notice} />}
          <Button type="submit" disabled={busy || !challenge}>
            {busy && <Spinner />}
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function ChangePhoneCard() {
  const [challenge, setChallenge] = useState<TacChallenge | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [round, setRound] = useState(0)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!challenge) return
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setNotice(null)
    try {
      const { phone } = await changePhone(supabase, await challenge.confirm(String(form.get('tac'))), String(form.get('password')))
      // The auth state reads the profile again on a token refresh, so the page shows the new phone.
      await supabase.auth.refreshSession()
      setChallenge(null)
      setRound(round + 1)
      setNotice({ tone: 'success', text: `Your phone is now ${phone}. TACs go to it from now on.` })
    } catch (failure) {
      setNotice({ tone: 'error', text: failure instanceof Error ? failure.message : String(failure) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Change phone number</h2>
        </CardTitle>
        <CardDescription>
          Confirm your password, and the TAC we text to the new phone. If you lost your old phone and your password, ask an admin to reset your password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form key={round} onSubmit={onSubmit} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="profile-current-password">Current password</Label>
            <Input id="profile-current-password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <TacFields phoneLabel="New phone number" challenge={challenge} onChallenge={setChallenge} />
          {notice && <NoticeAlert notice={notice} />}
          <Button type="submit" disabled={busy || !challenge}>
            {busy && <Spinner />}
            Change phone number
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

const PUSH_TEXT: Record<PushStatus, string> = {
  on: 'This browser shows a notification when an auditor sends you an audit request, or staff reply to yours.',
  off: 'Turn notifications on to hear about audit requests on this browser. Do it on each browser and phone you use.',
  blocked: 'Notifications are blocked for this site. Allow them in your browser settings, then reload the page.',
  unsupported:
    'This browser cannot show notifications. On an iPhone or iPad, add eCourseFile to your Home Screen from the Share menu, and open it from there.',
}

function NotificationsCard() {
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void pushStatus().then(setStatus)
  }, [])

  async function toggle() {
    setBusy(true)
    setNotice(null)
    try {
      if (status === 'on') await turnOffPush(supabase)
      else await turnOnPush(supabase)
    } catch (failure) {
      setNotice({ tone: 'error', text: failure instanceof Error ? failure.message : String(failure) })
    } finally {
      setStatus(await pushStatus())
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Notifications on this browser</h2>
        </CardTitle>
        <CardDescription>{status ? PUSH_TEXT[status] : 'Checking this browser…'}</CardDescription>
      </CardHeader>
      {(status === 'on' || status === 'off') && (
        <CardContent className="grid gap-4">
          {notice && <NoticeAlert notice={notice} />}
          <div>
            <Button variant={status === 'on' ? 'outline' : 'default'} disabled={busy} onClick={() => void toggle()}>
              {busy ? <Spinner /> : status === 'on' ? <BellOffIcon /> : <BellIcon />}
              {status === 'on' ? 'Turn off' : 'Turn on'}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
