import { BellIcon, BellOffIcon } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { editsErrorField, FieldError, FormErrors, type ActionError } from '@/components/form-errors'
import { Initials, RoleBadges } from '@/components/identity'
import { PageHeader } from '@/components/page'
import { confirmationError, NewPasswordFields, newPasswordError } from '@/components/password-fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { MAX_TITLE_LENGTH } from '../../supabase/functions/_shared/user-import.ts'
import type { Profile as SignedInProfile } from '../auth.ts'
import { useAuth, useReloadAuth } from '../auth-provider.tsx'
import { friendlyError } from '../errors.ts'
import { pushStatus, turnOffPush, turnOnPush, type PushStatus } from '../push.ts'
import type { GlobalRole } from '../roles.ts'
import { supabase } from '../supabase.ts'

type Department = { code: string; name: string }

/**
 * The signed-in user's own account. The card on the left shows what an admin sets, with no inputs.
 * The forms on the right change the user's title and name, and their password, and turn push
 * notifications on or off for this browser.
 */
export function Profile() {
  const state = useAuth()
  if (state.kind !== 'ready') return null

  return (
    <div className="grid gap-6">
      <PageHeader title="My profile" />
      <div className="grid items-start gap-6 lg:grid-cols-[20rem_1fr]">
        <AccountCard profile={state.profile} roles={state.roles} />
        <div className="grid gap-6">
          <NameCard profile={state.profile} />
          <PasswordCard email={state.profile.email} />
          <NotificationsCard />
        </div>
      </div>
    </div>
  )
}

/** Who the user is, and the parts of their account that only an admin changes. */
function AccountCard({ profile, roles }: { profile: SignedInProfile; roles: GlobalRole[] }) {
  // undefined while loading, null when the user has no department, and 'failed' when it did not load.
  const [department, setDepartment] = useState<Department | null | 'failed' | undefined>(undefined)

  useEffect(() => {
    let current = true
    void supabase
      .from('profiles')
      .select('department:departments(code, name)')
      .eq('id', profile.id)
      .single()
      .overrideTypes<{ department: Department | null }, { merge: false }>()
      .then(({ data, error }) => {
        if (current) setDepartment(error ? 'failed' : data.department)
      })
    return () => {
      current = false
    }
  }, [profile.id])

  return (
    <Card className="lg:sticky lg:top-20">
      <CardContent className="grid gap-5">
        <div className="flex items-center gap-4 lg:flex-col lg:items-start">
          <Initials name={profile.fullName} className="size-16 text-xl font-semibold" />
          <p className="min-w-0 text-lg font-semibold break-words">{profile.displayName}</p>
        </div>
        <dl className="grid gap-3 text-sm">
          <Fact label="Email">
            <span className="break-all">{profile.email}</span>
          </Fact>
          <Fact label="Department">
            {department === undefined ? (
              <Skeleton className="h-5 w-40" />
            ) : department === 'failed' ? (
              <span className="text-muted-foreground">Couldn't load</span>
            ) : department ? (
              `${department.code} ${department.name}`
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Fact>
          <Fact label="Roles">
            <RoleBadges roles={roles} />
          </Fact>
        </dl>
      </CardContent>
    </Card>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * A card that holds one form, with its button in the footer. onSubmit resolves to why it failed,
 * which shows under its field or after the fields, or to null when it succeeded.
 */
function FormCard({
  title,
  onSubmit,
  action,
  children,
}: {
  title: string
  onSubmit: (form: HTMLFormElement) => Promise<ActionError | null>
  action: (busy: boolean) => ReactNode
  children: ReactNode
}) {
  const form = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<ActionError | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(await onSubmit(event.currentTarget))
    setBusy(false)
  }

  return (
    <Card className="gap-0 py-0">
      <form ref={form} onSubmit={submit} onInput={(event) => editsErrorField(error, event.target) && setError(null)} aria-label={title}>
        <CardHeader className="grid-rows-none border-b py-4 [.border-b]:pb-4">
          <CardTitle className="text-base">
            <h2>{title}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 py-5">
          <FormErrors form={form} error={error}>
            {children}
          </FormErrors>
        </CardContent>
        <CardFooter className="bg-muted/40 justify-end rounded-b-xl border-t py-3">{action(busy)}</CardFooter>
      </form>
    </Card>
  )
}

/** The user's title and full name, saved with update_my_profile. Every page shows the new name once it is saved. */
function NameCard({ profile }: { profile: SignedInProfile }) {
  const reloadAuth = useReloadAuth()
  const [title, setTitle] = useState(profile.title ?? '')
  const [fullName, setFullName] = useState(profile.fullName)
  const changed = fullName.trim() !== profile.fullName || (title.trim() || null) !== profile.title

  async function save(): Promise<ActionError | null> {
    const { error } = await supabase.rpc('update_my_profile', { full_name: fullName, title })
    // The SQL function refuses a blank name with 23514.
    if (error) return error.code === '23514' ? { field: 'fullName', message: friendlyError(error) } : friendlyError(error)
    await reloadAuth()
    setTitle(title.trim())
    setFullName(fullName.trim())
    toast.success('Saved')
    return null
  }

  return (
    <FormCard
      title="Name and title"
      onSubmit={save}
      action={(busy) => (
        <Button type="submit" size="sm" disabled={busy || !changed}>
          {busy && <Spinner />}
          Save
        </Button>
      )}
    >
      <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
        <div className="grid content-start gap-2">
          <Label htmlFor="title">
            Title <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="title"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Dr., Ts."
            maxLength={MAX_TITLE_LENGTH}
            autoComplete="honorific-prefix"
          />
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="full-name">Full name</Label>
          <Input
            id="full-name"
            name="fullName"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="name"
            required
          />
          <FieldError name="fullName" />
        </div>
      </div>
    </FormCard>
  )
}

/**
 * A new password, set only after the current one is confirmed, so that someone at an unlocked,
 * signed-in screen cannot take over the account. Signing in with the current password checks it.
 */
function PasswordCard({ email }: { email: string }) {
  async function change(formElement: HTMLFormElement): Promise<ActionError | null> {
    const form = new FormData(formElement)
    const current = String(form.get('current'))
    const password = String(form.get('password'))
    const mismatch = confirmationError(form)
    if (mismatch) return mismatch
    if (password === current) return { field: 'password', message: 'Must differ from your current password.' }
    const check = await supabase.auth.signInWithPassword({ email, password: current })
    if (check.error) return check.error.code === 'invalid_credentials' ? { field: 'current', message: 'Incorrect password.' } : friendlyError(check.error)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return newPasswordError(error)
    formElement.reset()
    toast.success('Password changed')
    return null
  }

  return (
    <FormCard
      title="Password"
      onSubmit={change}
      action={(busy) => (
        <Button type="submit" size="sm" disabled={busy}>
          {busy && <Spinner />}
          Change password
        </Button>
      )}
    >
      <div className="grid gap-2">
        <Label htmlFor="current">Current password</Label>
        <Input id="current" name="current" type="password" autoComplete="current-password" required />
        <FieldError name="current" />
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <NewPasswordFields />
      </div>
    </FormCard>
  )
}

const PUSH_TEXT: Record<PushStatus, string> = {
  unavailable: 'Notifications are not set up on this site yet.',
  on: 'This browser shows a notification when an auditor sends you an audit request, or staff reply to yours.',
  off: 'Turn notifications on to hear about audit requests on this browser. Do it on each browser and phone you use.',
  blocked: 'Notifications are blocked for this site. Allow them in your browser settings, then reload the page.',
  unsupported:
    'This browser cannot show notifications. On an iPhone or iPad, add eCourseFile to your Home Screen from the Share menu, and open it from there.',
}

/** Push notifications of audit requests on this browser. Each browser and phone is turned on by itself. */
function NotificationsCard() {
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void pushStatus().then(setStatus)
  }, [])

  async function toggle() {
    setBusy(true)
    try {
      if (status === 'on') await turnOffPush(supabase)
      else await turnOnPush(supabase)
      toast.success(status === 'on' ? 'Notifications turned off' : 'Notifications turned on')
    } catch (failure) {
      toast.error(friendlyError(failure))
    } finally {
      setStatus(await pushStatus())
      setBusy(false)
    }
  }

  const toggles = status === 'on' || status === 'off'
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="grid-rows-none border-b py-4 [.border-b]:pb-4">
        <CardTitle className="text-base">
          <h2>Notifications on this browser</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="py-5">
        <CardDescription>{status ? PUSH_TEXT[status] : <Skeleton className="h-5 w-64" />}</CardDescription>
      </CardContent>
      {toggles && (
        <CardFooter className="bg-muted/40 justify-end rounded-b-xl border-t py-3">
          <Button size="sm" variant={status === 'on' ? 'outline' : 'default'} disabled={busy} onClick={() => void toggle()}>
            {busy ? <Spinner /> : status === 'on' ? <BellOffIcon /> : <BellIcon />}
            {status === 'on' ? 'Turn off' : 'Turn on'}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
