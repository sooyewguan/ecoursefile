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
import { useAuth } from '../auth-provider.tsx'
import { supabase } from '../supabase.ts'

type Department = { code: string; name: string }

/** The signed-in user's own account: who they are, their department and roles, and a new password. */
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
      <PageHeader title="My profile" description="Your account details and password." />

      <Card>
        <CardHeader className="flex items-start gap-4 sm:items-center">
          <Initials name={state.profile.fullName} className="size-12 text-base sm:size-14 sm:text-lg" />
          <div className="grid min-w-0 gap-1">
            <CardTitle className="text-lg">{state.profile.fullName}</CardTitle>
            <CardDescription className="break-all">{state.profile.email}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">Department</dt>
            <dd>
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
          <p className="text-muted-foreground mt-6 text-sm">
            To change your name, email, department or roles, ask an admin.
          </p>
        </CardContent>
      </Card>

      <PasswordCard />
    </div>
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
