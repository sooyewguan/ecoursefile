import { FunctionsHttpError } from '@supabase/supabase-js'
import { FileUpIcon, KeyRoundIcon, PencilIcon, UserCheckIcon, UserPlusIcon, UsersIcon, UserXIcon } from 'lucide-react'
import { useCallback, useEffect, useState, type ComponentProps } from 'react'
import { ConfirmDialog, FormDialog, type Action } from '@/components/action-dialogs'
import { RoleBadges } from '@/components/identity'
import { NoticeAlert, type Notice } from '@/components/notice'
import { PageHeader, RowActions, TableEmpty, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ImportResults, ImportUsersDialog } from '@/components/user-import'
import { cn } from '@/lib/utils'
import type { ImportedRow } from '../../supabase/functions/_shared/user-import.ts'
import { useAuth } from '../auth-provider.tsx'
import { ROLE_LABELS, type GlobalRole } from '../roles.ts'
import { supabase } from '../supabase.ts'

type UserRow = {
  id: string
  email: string
  full_name: string
  active: boolean
  department_id: string | null
  /** Whether the signed-in user may edit, deactivate or reset this user, as the database decides. */
  manageable: boolean
  user_roles: { role: GlobalRole }[]
}

type Department = { id: string; code: string; name: string }

type PageData = { users: UserRow[]; departments: Department[]; assignable: GlobalRole[] }

/** What the edit dialog changes. A departmentId of undefined leaves the department as it is. */
type UserChanges = { grant: GlobalRole[]; revoke: GlobalRole[]; departmentId?: string | null }

/** The dialog that is open, and the user it acts on. */
type OpenDialog =
  | { kind: 'create' }
  | { kind: 'import' }
  | { kind: 'edit'; user: UserRow }
  | { kind: 'reset-password'; user: UserRow }
  | { kind: 'set-active'; user: UserRow }

/** Below md the department, roles and status move into the name cell, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'

/** The table's columns: name, department, roles, status and the row menu. */
const COLUMNS = ['', WIDE, WIDE, WIDE, '']

export function Users() {
  const state = useAuth()
  const [data, setData] = useState<PageData | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  /** What the last import did with each row of its file. */
  const [imported, setImported] = useState<ImportedRow[] | null>(null)

  const reload = useCallback(async () => {
    const [users, departments, assignable] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, email, full_name, active, department_id, manageable, user_roles(role)')
        .order('full_name'),
      supabase.from('departments').select('id, code, name').order('code'),
      supabase.rpc('assignable_roles'),
    ])
    if (users.error || departments.error || assignable.error) {
      setNotice({ tone: 'error', text: (users.error ?? departments.error ?? assignable.error)!.message })
      return
    }
    setData({ users: users.data, departments: departments.data, assignable: assignable.data })
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  if (state.kind !== 'ready') return null

  const me = state.profile.id
  const choosesDepartment = state.roles.includes('admin')
  const departments = data?.departments ?? []
  const assignable = data?.assignable ?? []
  const departmentName = new Map(departments.map((d) => [d.id, `${d.code} ${d.name}`]))

  /** Runs an action, reloads the page data, and returns the action's error message or null. */
  async function perform(action: Action, success: string) {
    const error = await action()
    await reload()
    if (!error) setNotice({ tone: 'success', text: success })
    return error
  }

  function close() {
    setDialog(null)
  }

  async function importUsers(csv: string) {
    const { data, error } = await supabase.functions.invoke('accounts', { body: { action: 'import-users', csv } })
    if (error) return errorMessage(error)
    setNotice(null)
    setImported(data.rows)
    await reload()
    return null
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Users"
        description={
          choosesDepartment
            ? 'Add staff, set their department and roles, and manage their access.'
            : 'Add admins, and grant or revoke the admin role.'
        }
        action={
          assignable.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {state.roles.includes('admin') && (
                <Button variant="outline" onClick={() => setDialog({ kind: 'import' })}>
                  <FileUpIcon />
                  Import CSV
                </Button>
              )}
              <Button onClick={() => setDialog({ kind: 'create' })}>
                <UserPlusIcon />
                Add user
              </Button>
            </div>
          )
        }
      />
      {notice && <NoticeAlert notice={notice} />}
      {imported && <ImportResults rows={imported} onDismiss={() => setImported(null)} />}

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-4">Name</TableHead>
              <TableHead className={cn('px-4', WIDE)}>Department</TableHead>
              <TableHead className={cn('px-4', WIDE)}>Roles</TableHead>
              <TableHead className={cn('px-4', WIDE)}>Status</TableHead>
              <TableHead className="w-14 px-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data ? (
              <TableSkeleton columns={COLUMNS} />
            ) : data.users.length === 0 ? (
              <TableEmpty columns={COLUMNS.length} icon={UsersIcon} title="No users yet" description="Add the first user." />
            ) : (
              data.users.map((user) => {
                const roles = user.user_roles.map((r) => r.role)
                const department = user.department_id ? departmentName.get(user.department_id) : undefined
                // The database refuses role changes on yourself and on root, so the page offers none.
                const editsRoles = assignable.length > 0 && user.id !== me && !roles.includes('root')
                return (
                  <TableRow key={user.id}>
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <div className={cn('grid gap-0.5', !user.active && 'opacity-60')}>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                          {user.full_name}
                          {user.id === me && <Badge variant="outline">You</Badge>}
                        </span>
                        <span className="text-muted-foreground wrap-anywhere">{user.email}</span>
                        <div className="mt-2 grid gap-2 md:hidden">
                          {department && <span className="text-muted-foreground text-xs">{department}</span>}
                          <div className="flex flex-wrap items-center gap-1">
                            <RoleBadges roles={roles} />
                            <StatusBadge active={user.active} />
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>
                      {department ?? <span className="text-muted-foreground">No department</span>}
                    </TableCell>
                    <TableCell className={cn('px-4 py-3', WIDE)}>
                      <RoleBadges roles={roles} className="min-w-32" />
                    </TableCell>
                    <TableCell className={cn('px-4 py-3', WIDE)}>
                      <StatusBadge active={user.active} />
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right">
                      {(editsRoles || user.manageable) && (
                        <RowActions label={`Actions for ${user.email}`}>
                          {editsRoles && (
                            <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', user })}>
                              <PencilIcon />
                              {user.manageable && choosesDepartment ? 'Edit user' : 'Edit roles'}
                            </DropdownMenuItem>
                          )}
                          {user.manageable && (
                            <>
                              <DropdownMenuItem onSelect={() => setDialog({ kind: 'reset-password', user })}>
                                <KeyRoundIcon />
                                Reset password
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant={user.active ? 'destructive' : 'default'}
                                onSelect={() => setDialog({ kind: 'set-active', user })}
                              >
                                {user.active ? <UserXIcon /> : <UserCheckIcon />}
                                {user.active ? 'Deactivate' : 'Reactivate'}
                              </DropdownMenuItem>
                            </>
                          )}
                        </RowActions>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {dialog?.kind === 'create' && (
        <FormDialog
          title="Add a user"
          description="They sign in with the temporary password and must change it at their first sign-in."
          submitLabel="Add user"
          onClose={close}
          onSubmit={(form) => {
            const email = String(form.get('email'))
            return perform(
              () =>
                callAccounts({
                  action: 'create-user',
                  email,
                  fullName: String(form.get('fullName')),
                  departmentId: String(form.get('departmentId') ?? '') || null,
                  roles: form.getAll('roles').map(String),
                  temporaryPassword: String(form.get('temporaryPassword')),
                }),
              `Created ${email}. They must change the temporary password at first sign-in.`,
            )
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="create-full-name">Full name</Label>
            <Input id="create-full-name" name="fullName" autoComplete="off" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="create-email">Email</Label>
            <Input id="create-email" name="email" type="email" autoComplete="off" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="create-temporary-password">Temporary password</Label>
            <Input id="create-temporary-password" name="temporaryPassword" type="text" autoComplete="off" required />
          </div>
          {choosesDepartment && (
            <DepartmentSelect id="create-department" name="departmentId" departments={departments} defaultValue="" />
          )}
          <RoleCheckboxes idPrefix="create-role" roles={assignable} />
        </FormDialog>
      )}

      {dialog?.kind === 'import' && <ImportUsersDialog roles={assignable} onImport={importUsers} onClose={close} />}

      {dialog?.kind === 'edit' && (
        <EditUserDialog
          user={dialog.user}
          assignable={assignable}
          departments={choosesDepartment && dialog.user.manageable ? departments : null}
          onClose={close}
          onSave={(changes) => perform(() => saveUser(dialog.user, changes), `Saved the changes to ${dialog.user.email}.`)}
        />
      )}

      {dialog?.kind === 'reset-password' && (
        <FormDialog
          title={`Reset the password of ${dialog.user.full_name}`}
          description={`Give ${dialog.user.email} a temporary password. They must change it at their next sign-in.`}
          submitLabel="Reset password"
          onClose={close}
          onSubmit={(form) =>
            perform(
              () =>
                callAccounts({
                  action: 'reset-password',
                  userId: dialog.user.id,
                  temporaryPassword: String(form.get('temporaryPassword')),
                }),
              `Reset the password of ${dialog.user.email}. They must change it at their next sign-in.`,
            )
          }
        >
          <div className="grid gap-2">
            <Label htmlFor="reset-temporary-password">Temporary password</Label>
            <Input id="reset-temporary-password" name="temporaryPassword" type="text" autoComplete="off" required />
          </div>
        </FormDialog>
      )}

      {dialog?.kind === 'set-active' && (
        <ConfirmDialog
          title={`${dialog.user.active ? 'Deactivate' : 'Reactivate'} ${dialog.user.full_name}?`}
          description={
            dialog.user.active
              ? `${dialog.user.email} can no longer sign in. Their profile stays, and you can reactivate them later.`
              : `${dialog.user.email} can sign in again with their current password.`
          }
          confirmLabel={dialog.user.active ? 'Deactivate' : 'Reactivate'}
          destructive={dialog.user.active}
          onClose={close}
          onConfirm={() =>
            perform(
              () => updateProfile(dialog.user, { active: !dialog.user.active }),
              `${dialog.user.active ? 'Deactivated' : 'Reactivated'} ${dialog.user.email}.`,
            )
          }
        />
      )}
    </div>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant="outline" className={cn('gap-1.5', !active && 'text-muted-foreground')}>
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', active ? 'bg-success' : 'bg-destructive')} />
      {active ? 'Active' : 'Deactivated'}
    </Badge>
  )
}

function DepartmentSelect({
  departments,
  ...props
}: { id: string; departments: Department[] } & ComponentProps<typeof NativeSelect>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={props.id}>Department</Label>
      <NativeSelect {...props}>
        <NativeSelectOption value="">No department</NativeSelectOption>
        {departments.map((d) => (
          <NativeSelectOption key={d.id} value={d.id}>
            {d.code} {d.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}

/** A checkbox for each role. Without `checked` the boxes keep their own state and submit as `roles`. */
function RoleCheckboxes({
  idPrefix,
  roles,
  checked,
  onCheckedChange,
}: {
  idPrefix: string
  roles: GlobalRole[]
  checked?: GlobalRole[]
  onCheckedChange?: (role: GlobalRole, checked: boolean) => void
}) {
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-2 text-sm font-medium">Roles</legend>
      <div className="grid grid-cols-2 gap-2">
        {roles.map((role) => (
          <Label
            key={role}
            htmlFor={`${idPrefix}-${role}`}
            className="hover:bg-accent/50 has-[[aria-checked=true]]:border-primary/40 has-[[aria-checked=true]]:bg-accent/60 rounded-md border px-2.5 py-2.5 leading-snug font-normal"
          >
            <Checkbox
              id={`${idPrefix}-${role}`}
              name="roles"
              value={role}
              checked={checked?.includes(role)}
              onCheckedChange={onCheckedChange && ((value) => onCheckedChange(role, value === true))}
            />
            {ROLE_LABELS[role]}
          </Label>
        ))}
      </div>
    </fieldset>
  )
}

function EditUserDialog({
  user,
  assignable,
  departments,
  onSave,
  onClose,
}: {
  user: UserRow
  assignable: GlobalRole[]
  /** The departments to choose from, or null when the signed-in user may not change this user's department. */
  departments: Department[] | null
  onSave: Action<[UserChanges]>
  onClose: () => void
}) {
  const held = user.user_roles.map((r) => r.role)
  const [roles, setRoles] = useState(() => assignable.filter((role) => held.includes(role)))
  const [departmentId, setDepartmentId] = useState(user.department_id ?? '')

  const changes: UserChanges = {
    grant: roles.filter((role) => !held.includes(role)),
    revoke: assignable.filter((role) => held.includes(role) && !roles.includes(role)),
    departmentId: departmentId === (user.department_id ?? '') ? undefined : departmentId || null,
  }
  const changed = changes.grant.length > 0 || changes.revoke.length > 0 || changes.departmentId !== undefined

  return (
    <FormDialog
      title={`Edit ${user.full_name}`}
      description={`${user.email}. Role changes take effect at their next sign-in, or within an hour.`}
      submitLabel="Save"
      submitDisabled={!changed}
      onClose={onClose}
      onSubmit={() => onSave(changes)}
    >
      {departments && (
        <DepartmentSelect
          id="edit-department"
          departments={departments}
          value={departmentId}
          onChange={(event) => setDepartmentId(event.target.value)}
        />
      )}
      <RoleCheckboxes
        idPrefix="edit-role"
        roles={assignable}
        checked={roles}
        onCheckedChange={(role, checked) =>
          setRoles((current) => (checked ? [...current, role] : current.filter((r) => r !== role)))
        }
      />
    </FormDialog>
  )
}

/**
 * Applies the edit dialog's changes with the same writes the database rules check. Revokes go
 * first and grants last, so an HoD has a department whenever they hold the role.
 */
async function saveUser(user: UserRow, changes: UserChanges): Promise<string | null> {
  for (const role of changes.revoke) {
    const { error } = await supabase.from('user_roles').delete().match({ user_id: user.id, role })
    if (error) return error.message
  }
  if (changes.departmentId !== undefined) {
    const error = await updateProfile(user, { department_id: changes.departmentId })
    if (error) return error
  }
  for (const role of changes.grant) {
    const { error } = await supabase.from('user_roles').insert({ user_id: user.id, role })
    if (error) return error.message
  }
  return null
}

async function updateProfile(user: UserRow, changes: { department_id?: string | null; active?: boolean }) {
  const { error } = await supabase.from('profiles').update(changes).eq('id', user.id)
  return error?.message ?? null
}

/** Calls the accounts Edge Function and returns its error message, or null when it succeeded. */
async function callAccounts(body: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.functions.invoke('accounts', { body })
  return error ? errorMessage(error) : null
}

/** The message of an Edge Function's error: the function's own, when it answered with one. */
async function errorMessage(error: Error) {
  if (error instanceof FunctionsHttpError) {
    const payload: { message?: string } | null = await error.context.json().catch(() => null)
    return payload?.message ?? error.message
  }
  return error.message
}
