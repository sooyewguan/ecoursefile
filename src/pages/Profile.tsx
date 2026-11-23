import { BellIcon, BellOffIcon } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { NoticeAlert, type Notice } from '@/components/notice'
import { PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '../auth-provider.tsx'
import { pushStatus, turnOffPush, turnOnPush, type PushStatus } from '../push.ts'
import { supabase } from '../supabase.ts'

/** The signed-in user's own account: their details, a new password, and notifications on this browser. */
export function Profile() {
  const state = useAuth()
  if (state.kind !== 'ready') return null
  const { profile } = state

  return (
    <div className="grid gap-6">
      <PageHeader title="Your profile" description="Change your password, and turn on notifications." />
      <Card>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail term="Name">{profile.fullName}</Detail>
            <Detail term="Email">{profile.email}</Detail>
          </dl>
        </CardContent>
      </Card>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <ChangePasswordCard />
        <NotificationsCard />
      </div>
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

function ChangePasswordCard() {
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const password = String(form.get('password'))
    if (password !== String(form.get('confirm'))) {
      setNotice({ tone: 'error', text: 'The two passwords do not match.' })
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      setNotice({ tone: 'error', text: error.message })
      return
    }
    formElement.reset()
    setNotice({ tone: 'success', text: 'Your new password is set.' })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Change password</h2>
        </CardTitle>
        <CardDescription>Choose the password you will sign in with.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="profile-password">New password</Label>
            <Input id="profile-password" name="password" type="password" autoComplete="new-password" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-confirm">Confirm new password</Label>
            <Input id="profile-confirm" name="confirm" type="password" autoComplete="new-password" required />
          </div>
          {notice && <NoticeAlert notice={notice} />}
          <Button type="submit" disabled={busy}>
            {busy && <Spinner />}
            Change password
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
