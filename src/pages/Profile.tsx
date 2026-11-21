import { useEffect, useState, type FormEvent } from 'react'
import { Initials, RoleBadges } from '@/components/identity'
import { NoticeAlert, type Notice } from '@/components/notice'
import { PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { MAX_TITLE_LENGTH } from '../../supabase/functions/_shared/user-import.ts'
import type { Profile as SignedInProfile } from '../auth.ts'
import { useAuth, useReloadAuth } from '../auth-provider.tsx'
import { supabase } from '../supabase.ts'

type Department = { code: string; name: string }

/** The signed-in user's own account: their title and name, their department and roles, and a new password. */
export function Profile() {
  const state = useAuth()
  const userId = state.kind === 'ready' ? state.profile.id : null
  // undefined while loading, null when the user has no department.
  const [department, setDepartment] = useState<Department | null | undefined>(undefined)
  const [departmentError, setDepartmentError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let current = true
    void supabase
      .from('profiles')
      .select('department:departments(code, name)')
      .eq('id', userId)
      .single()
      .overrideTypes<{ department: Department | null }, { merge: false }>()
      .then(({ data, error }) => {
        if (!current) return
        if (error) {
          setDepartmentError(error.message)
          setDepartment(null)
          return
        }
        setDepartment(data.department)
      })
    return () => {
      current = false
    }
  }, [userId])

  if (state.kind !== 'ready') return null

  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title="My profile" description="Your name as others see it, your account details and your password." />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            <h2>Your details</h2>
          </CardTitle>
          <CardDescription>eCourseFile shows your title and name wherever it names you to others.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <DetailsForm profile={state.profile} />
          <div className="grid gap-4 border-t pt-6">
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_1fr] sm:gap-y-4">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="mb-2 break-all sm:mb-0">{state.profile.email}</dd>
              <dt className="text-muted-foreground">Department</dt>
              <dd className="mb-2 sm:mb-0">
                {department === undefined ? (
                  <Skeleton className="h-5 w-40" />
                ) : departmentError ? (
                  <span className="text-destructive">Could not read your department: {departmentError}</span>
                ) : department ? (
                  `${department.code} ${department.name}`
                ) : (
                  'None'
                )}
              </dd>
              <dt className="text-muted-foreground">Roles</dt>
              <dd>{state.roles.length > 0 ? <RoleBadges roles={state.roles} /> : 'None'}</dd>
            </dl>
            <p className="text-muted-foreground text-sm">An admin changes your email, department and roles.</p>
          </div>
        </CardContent>
      </Card>

      <PasswordCard />
    </div>
  )
}

/** How the app names a person: the title and the full name, as the profiles table's display_name joins them. */
function displayNameOf(title: string, fullName: string) {
  return [title.trim(), fullName.trim()].filter(Boolean).join(' ')
}

/** The user's title and full name, saved with update_my_profile. Every page shows the new name once it is saved. */
function DetailsForm({ profile }: { profile: SignedInProfile }) {
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
    setNotice({ tone: 'success', text: `Saved. Others now see you as ${displayNameOf(title, fullName)}.` })
  }

  return (
    <form onSubmit={onSubmit} aria-label="Your details" className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-[10rem_1fr]">
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
            placeholder="Dr., Prof. Madya, Ts."
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
      {fullName.trim() && (
        <div className="bg-muted/50 flex items-center gap-3 rounded-lg border px-3 py-2.5" aria-live="polite">
          <Initials name={fullName} className="bg-background" />
          <p className="min-w-0 text-sm">
            <span className="text-muted-foreground">Shown to others as </span>
            <span className="font-medium break-words">{displayNameOf(title, fullName)}</span>
          </p>
        </div>
      )}
      {notice && <NoticeAlert notice={notice} />}
      <Button type="submit" disabled={busy || !changed} className="justify-self-start">
        {busy && <Spinner />}
        Save
      </Button>
    </form>
  )
}

function PasswordCard() {
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
    setNotice({ tone: 'success', text: 'Your password is changed. Use it the next time you sign in.' })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>Change password</h2>
        </CardTitle>
        <CardDescription>You stay signed in on this device.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="password">New password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm">Confirm new password</Label>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
          </div>
          {notice && <NoticeAlert notice={notice} />}
          <Button type="submit" disabled={busy} className="justify-self-start">
            {busy && <Spinner />}
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
