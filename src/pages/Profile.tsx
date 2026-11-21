import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Initials, RoleBadges } from '@/components/identity'
import { NoticeAlert, type Notice } from '@/components/notice'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { MAX_TITLE_LENGTH } from '../../supabase/functions/_shared/user-import.ts'
import type { Profile as SignedInProfile } from '../auth.ts'
import { useAuth, useReloadAuth } from '../auth-provider.tsx'
import type { GlobalRole } from '../roles.ts'
import { supabase } from '../supabase.ts'

type Department = { code: string; name: string }

/**
 * The signed-in user's own account. The card on the left shows what an admin sets, with no inputs.
 * The forms on the right change the user's title and name, and their password.
 */
export function Profile() {
  const state = useAuth()
  if (state.kind !== 'ready') return null

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[20rem_1fr]">
        <AccountCard profile={state.profile} roles={state.roles} />
        <div className="grid gap-6">
          <NameCard profile={state.profile} />
          <PasswordCard email={state.profile.email} />
        </div>
      </div>
    </div>
  )
}

/** Who the user is, and the parts of their account that only an admin changes. */
function AccountCard({ profile, roles }: { profile: SignedInProfile; roles: GlobalRole[] }) {
  // undefined while loading, null when the user has no department.
  const [department, setDepartment] = useState<Department | null | undefined>(undefined)
  const [departmentError, setDepartmentError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void supabase
      .from('profiles')
      .select('department:departments(code, name)')
      .eq('id', profile.id)
      .single()
      .overrideTypes<{ department: Department | null }, { merge: false }>()
      .then(({ data, error }) => {
        if (!current) return
        if (error) setDepartmentError(error.message)
        setDepartment(error ? null : data.department)
      })
    return () => {
      current = false
    }
  }, [profile.id])

  return (
    <Card className="lg:sticky lg:top-20">
      <CardContent className="grid gap-5">
        <div className="flex items-center gap-4 lg:flex-col lg:items-start">
          <Initials name={profile.fullName} className="bg-primary text-primary-foreground size-16 text-xl font-semibold" />
          <p className="min-w-0 text-lg font-semibold break-words">{profile.displayName}</p>
        </div>
        <dl className="grid gap-3 text-sm">
          <Fact label="Email">
            <span className="break-all">{profile.email}</span>
          </Fact>
          <Fact label="Department">
            {department === undefined ? (
              <Skeleton className="h-5 w-40" />
            ) : departmentError ? (
              <span className="text-destructive">Could not read your department: {departmentError}</span>
            ) : department ? (
              `${department.code} ${department.name}`
            ) : (
              'None'
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

/** A card that holds one form, with its button in the footer. */
function FormCard({
  title,
  onSubmit,
  notice,
  action,
  children,
}: {
  title: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  notice: Notice | null
  action: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="gap-0 py-0">
      <form onSubmit={onSubmit} aria-label={title}>
        <CardHeader className="border-b py-5">
          <CardTitle className="text-base">
            <h2>{title}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 py-5">
          {children}
          {notice && <NoticeAlert notice={notice} />}
        </CardContent>
        <CardFooter className="bg-muted/40 justify-end rounded-b-xl border-t py-3">{action}</CardFooter>
      </form>
    </Card>
  )
}

/** The user's title and full name, saved with update_my_profile. Every page shows the new name once it is saved. */
function NameCard({ profile }: { profile: SignedInProfile }) {
  const reloadAuth = useReloadAuth()
  const [title, setTitle] = useState(profile.title ?? '')
  const [fullName, setFullName] = useState(profile.fullName)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const changed = fullName.trim() !== profile.fullName || (title.trim() || null) !== profile.title

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    const { error } = await supabase.rpc('update_my_profile', { full_name: fullName, title })
    if (!error) await reloadAuth()
    setBusy(false)
    if (error) {
      setNotice({ tone: 'error', text: error.message })
      return
    }
    setTitle(title.trim())
    setFullName(fullName.trim())
    setNotice({ tone: 'success', text: 'Saved.' })
  }

  return (
    <FormCard
      title="Name and title"
      onSubmit={onSubmit}
      notice={notice}
      action={
        <Button type="submit" size="sm" disabled={busy || !changed}>
          {busy && <Spinner />}
          Save
        </Button>
      }
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
            onChange={(event) => {
              setTitle(event.target.value)
              setNotice(null)
            }}
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
            onChange={(event) => {
              setFullName(event.target.value)
              setNotice(null)
            }}
            autoComplete="name"
            required
          />
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
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const current = String(form.get('current'))
    const password = String(form.get('password'))
    if (password !== String(form.get('confirm'))) {
      setNotice({ tone: 'error', text: 'The two new passwords do not match.' })
      return
    }
    if (password === current) {
      setNotice({ tone: 'error', text: 'The new password must differ from the current one.' })
      return
    }
    setBusy(true)
    const check = await supabase.auth.signInWithPassword({ email, password: current })
    if (check.error) {
      setBusy(false)
      setNotice({ tone: 'error', text: check.error.code === 'invalid_credentials' ? 'Your current password is wrong.' : check.error.message })
      return
    }
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      setNotice({ tone: 'error', text: error.message })
      return
    }
    formElement.reset()
    setNotice({ tone: 'success', text: 'Password changed.' })
  }

  return (
    <FormCard
      title="Password"
      onSubmit={onSubmit}
      notice={notice}
      action={
        <Button type="submit" size="sm" disabled={busy}>
          {busy && <Spinner />}
          Change password
        </Button>
      }
    >
      <div className="grid gap-2">
        <Label htmlFor="current">Current password</Label>
        <Input id="current" name="current" type="password" autoComplete="current-password" required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </div>
      </div>
    </FormCard>
  )
}
