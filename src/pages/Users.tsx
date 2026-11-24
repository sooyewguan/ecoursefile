import { FunctionsHttpError } from '@supabase/supabase-js'
import { FileUpIcon, KeyRoundIcon, PencilIcon, UserCheckIcon, UserPlusIcon, UsersIcon, UserXIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog, FormDialog, type Action } from '@/components/action-dialogs'
import { Combobox, type ComboboxOption } from '@/components/combobox'
import { FieldError, type ActionError } from '@/components/form-errors'
import { RoleBadges } from '@/components/identity'
import { PasswordHint } from '@/components/password-fields'
import { PageHeader, RowActions, TableEmpty } from '@/components/page'
import { usePagedList } from '@/components/paged-list'
import { ListSearch, PagedTableBody, TablePager } from '@/components/paged-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ImportResults, ImportUsersDialog } from '@/components/user-import'
import { cn } from '@/lib/utils'
import { MAX_TITLE_LENGTH, type ImportedRow, type NewUser } from '../../supabase/functions/_shared/user-import.ts'
import { MIN_PASSWORD_LENGTH } from '../auth.ts'
import { useAuth } from '../auth-provider.tsx'
import { departmentLabel, departmentOption, matching, searchDepartments, type Department } from '../catalog.ts'
import { friendlyError, UserFacingError } from '../errors.ts'
import { GLOBAL_ROLES, ROLE_LABELS, type GlobalRole } from '../roles.ts'
import { supabase } from '../supabase.ts'

type UserRow = {
  id: string
  email: string
  full_name: string
  title: string | null
  /** The title and full name, as the app names the user to others. */
  display_name: string
  active: boolean
  /** Whether the signed-in user may edit, deactivate or reset this user, as the database decides. */
  manageable: boolean
  department: Department | null
  user_roles: { role: GlobalRole }[]
}

/** Which users the list shows, besides its search. */
type UserFilters = { role: GlobalRole | 'all'; department: ComboboxOption; status: 'all' | 'active' | 'deactivated' }

/** The profile columns that admins write. */
type ProfileChanges = { full_name?: string; title?: string | null; department_id?: string | null; active?: boolean }

/** What the edit dialog changes. A column missing from profile stays as it is. */
type UserChanges = { grant: GlobalRole[]; revoke: GlobalRole[]; profile: Omit<ProfileChanges, 'active'> }

/** The dialog that is open, and the user it acts on. */
type OpenDialog =
  | { kind: 'create' }
  | { kind: 'import' }
  | { kind: 'edit'; user: UserRow }
  | { kind: 'reset-password'; user: UserRow }
  | { kind: 'set-active'; user: UserRow }
  | { kind: 'admin-role'; user: UserRow; grant: boolean }

const ALL_DEPARTMENTS: ComboboxOption = { value: 'all', label: 'All departments' }
const NO_DEPARTMENT: ComboboxOption = { value: 'none', label: 'No department' }

const NO_FILTERS: UserFilters = { role: 'all', department: ALL_DEPARTMENTS, status: 'all' }

/** Below md the department and roles move into the name cell, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'

/** The table's columns: name, department, roles and the row's actions. */
const COLUMNS = ['', WIDE, WIDE, '']

const USER_COLUMNS = 'id, email, full_name, title, display_name, active, manageable, department:departments(id, code, name), user_roles(role)'

/** A page of the users that match the search and filters, by name. */
function fetchUsers({ from, to }: { from: number; to: number }, search: string, filters: UserFilters) {
  // A second copy of the roles, inner joined, keeps the users who hold the role and leaves each user's roles whole.
  const columns: string = filters.role === 'all' ? USER_COLUMNS : `${USER_COLUMNS}, held:user_roles!inner()`
  let query = supabase.from('profiles').select(columns, { count: 'exact' })
  if (filters.role !== 'all') query = query.eq('held.role', filters.role)
  if (filters.department.value === NO_DEPARTMENT.value) query = query.is('department_id', null)
  else if (filters.department.value !== ALL_DEPARTMENTS.value) query = query.eq('department_id', filters.department.value)
  if (filters.status !== 'all') query = query.eq('active', filters.status === 'active')
  // Names repeat, so the id keeps the order the same from page to page.
  return matching(query, ['display_name', 'email'], search)
    .order('full_name')
    .order('id')
    .range(from, to)
    .overrideTypes<UserRow[], { merge: false }>()
}

/** The department filter's choices: every department, no department, then the departments that match. */
async function departmentFilterOptions(query: string) {
  const departments = await searchDepartments(query)
  return query.trim() ? departments : [ALL_DEPARTMENTS, NO_DEPARTMENT, ...departments]
}

/** The department field's choices: no department, then the departments that match. */
async function departmentFieldOptions(query: string) {
  const departments = await searchDepartments(query)
  return query.trim() ? departments : [NO_DEPARTMENT, ...departments]
}

function rolesOf(user: UserRow) {
  return user.user_roles.map((r) => r.role)
}

export function Users() {
  const state = useAuth()
  // Root grants only the admin role and manages no profile, so its page starts at the admins.
  const forRoot = state.kind === 'ready' && !state.roles.includes('admin')
  const [filters, setFilters] = useState<UserFilters>({ ...NO_FILTERS, role: forRoot ? 'admin' : 'all' })
  const list = usePagedList(
    (range, search) => fetchUsers(range, search, filters),
    `${filters.role} ${filters.department.value} ${filters.status}`,
  )
  /** The roles the signed-in user may grant, as the database decides, or whether loading them failed. */
  const [assignable, setAssignable] = useState<GlobalRole[] | 'failed' | null>(null)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  /** What the last import did with each row of its file. */
  const [imported, setImported] = useState<ImportedRow[] | null>(null)

  async function loadAssignable() {
    const { data, error } = await supabase.rpc('assignable_roles')
    setAssignable(error ? 'failed' : data)
  }

  useEffect(() => {
    void loadAssignable()
  }, [])

  if (state.kind !== 'ready') return null

  const me = state.profile.id
  const granted = Array.isArray(assignable) ? assignable : []
  const filtersSet = filters.role !== 'all' || filters.department !== ALL_DEPARTMENTS || filters.status !== 'all'
  // The rows wait for the roles the signed-in user may grant, which decide each row's actions.
  const shown = {
    ...list,
    rows: assignable === null ? null : list.rows,
    failed: list.failed || assignable === 'failed',
    retry() {
      list.retry()
      if (assignable === 'failed') void loadAssignable()
    },
  }

  /** Runs an action, reloads the list, and returns why it failed, or shows success and returns null. */
  async function perform<E extends ActionError>(action: () => Promise<E | null>, success: string) {
    const error = await action()
    list.retry()
    if (!error) toast.success(success)
    return error
  }

  function close() {
    setDialog(null)
  }

  async function importUsers(csv: string) {
    const { data, error } = await supabase.functions.invoke('accounts', { body: { action: 'import-users', csv } })
    if (error) return friendlyError(await refusalOf(error))
    setImported(data.rows)
    list.retry()
    return null
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Users"
        action={
          granted.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {!forRoot && (
                <Button variant="outline" onClick={() => setDialog({ kind: 'import' })}>
                  <FileUpIcon />
                  Import CSV
                </Button>
              )}
              <Button onClick={() => setDialog({ kind: 'create' })}>
                <UserPlusIcon />
                {forRoot ? 'Add admin' : 'Add user'}
              </Button>
            </div>
          )
        }
      />
      {imported && <ImportResults rows={imported} onDismiss={() => setImported(null)} />}

      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <ListSearch list={list} label="Search users" className="col-span-2 sm:w-64" />
          <div className="col-span-2 min-w-0 sm:w-64">
            <Label htmlFor="users-department" className="sr-only">
              Department
            </Label>
            <Combobox
              id="users-department"
              value={filters.department}
              onChange={(department) => setFilters({ ...filters, department })}
              search={departmentFilterOptions}
              placeholder={ALL_DEPARTMENTS.label}
              searchPlaceholder="Search departments"
            />
          </div>
          <div className="min-w-0 sm:w-40">
            <NativeSelect
              aria-label="Role"
              value={filters.role}
              onChange={(event) => setFilters({ ...filters, role: event.target.value as UserFilters['role'] })}
            >
              <NativeSelectOption value="all">All roles</NativeSelectOption>
              {GLOBAL_ROLES.map((role) => (
                <NativeSelectOption key={role} value={role}>
                  {ROLE_LABELS[role]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="min-w-0 sm:w-40">
            <NativeSelect
              aria-label="Status"
              value={filters.status}
              onChange={(event) => setFilters({ ...filters, status: event.target.value as UserFilters['status'] })}
            >
              <NativeSelectOption value="all">Any status</NativeSelectOption>
              <NativeSelectOption value="active">Active</NativeSelectOption>
              <NativeSelectOption value="deactivated">Deactivated</NativeSelectOption>
            </NativeSelect>
          </div>
        </div>

        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader className="max-md:hidden">
              <TableRow>
                <TableHead className="px-4">Name</TableHead>
                <TableHead className={cn('px-4', WIDE)}>Department</TableHead>
                <TableHead className={cn('px-4', WIDE)}>Roles</TableHead>
                <TableHead className={cn('px-4', forRoot ? 'w-36' : 'w-14')}>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <PagedTableBody
              list={shown}
              columns={COLUMNS}
              loadError="Couldn't load users"
              empty={
                <TableEmpty
                  columns={COLUMNS.length}
                  icon={UsersIcon}
                  title="No matching users"
                  action={
                    (filtersSet || list.search) && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setFilters(NO_FILTERS)
                          list.setQuery('')
                        }}
                      >
                        {filtersSet ? 'Clear filters' : 'Clear search'}
                      </Button>
                    )
                  }
                />
              }
            >
              {(user) => {
                const roles = rolesOf(user)
                const department = user.department && departmentLabel(user.department)
                // The database refuses role changes on yourself and on root, so the page offers none.
                const editsRoles = granted.length > 0 && user.id !== me && !roles.includes('root')
                return (
                  <TableRow key={user.id}>
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <div className={cn('grid gap-0.5', !user.active && 'opacity-60')}>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                          {user.display_name}
                          {user.id === me && <Badge variant="outline">You</Badge>}
                          {!user.active && <Badge variant="outline">Deactivated</Badge>}
                        </span>
                        <span className="text-muted-foreground lg:whitespace-nowrap">{user.email}</span>
                        <div className="mt-2 grid gap-2 md:hidden">
                          {department && <span className="text-muted-foreground text-xs">{department}</span>}
                          <RoleBadges roles={roles} />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>
                      {department ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className={cn('px-4 py-3', WIDE)}>
                      <RoleBadges roles={roles} className="min-w-32" />
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right align-top md:align-middle">
                      {forRoot
                        ? editsRoles && (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`${roles.includes('admin') ? 'Remove admin' : 'Make admin'}, ${user.email}`}
                              onClick={() => setDialog({ kind: 'admin-role', user, grant: !roles.includes('admin') })}
                            >
                              {roles.includes('admin') ? 'Remove admin' : 'Make admin'}
                            </Button>
                          )
                        : (editsRoles || user.manageable) && (
                            <RowActions label={`Actions for ${user.email}`}>
                              {editsRoles && (
                                <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', user })}>
                                  <PencilIcon />
                                  Edit
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
              }}
            </PagedTableBody>
          </Table>
          <TablePager list={list} />
        </Card>
      </div>

      {dialog?.kind === 'create' && (
        <CreateUserDialog
          forRoot={forRoot}
          assignable={granted}
          onClose={close}
          onCreate={(user) =>
            perform(() => callAccounts({ action: 'create-user', ...user }), `Added ${user.title ? `${user.title} ` : ''}${user.fullName}`)
          }
        />
      )}

      {dialog?.kind === 'import' && <ImportUsersDialog roles={granted} onImport={importUsers} onClose={close} />}

      {dialog?.kind === 'edit' && (
        <EditUserDialog
          user={dialog.user}
          assignable={granted}
          editsProfile={dialog.user.manageable}
          editsDepartment={!forRoot && dialog.user.manageable}
          onClose={close}
          onSave={(changes) => perform(() => saveUser(dialog.user, changes), `Saved ${dialog.user.display_name}`)}
        />
      )}

      {dialog?.kind === 'reset-password' && (
        <FormDialog
          title="Reset password"
          description={`${dialog.user.display_name} will choose a new password at next sign-in.`}
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
              `Password reset for ${dialog.user.display_name}`,
            )
          }
        >
          <TemporaryPasswordField idPrefix="reset" />
        </FormDialog>
      )}

      {dialog?.kind === 'set-active' && (
        <ConfirmDialog
          title={`${dialog.user.active ? 'Deactivate' : 'Reactivate'} ${dialog.user.display_name}?`}
          description={
            dialog.user.active
              ? "They won't be able to sign in. You can reactivate them later."
              : 'They can sign in again with their current password.'
          }
          confirmLabel={dialog.user.active ? 'Deactivate' : 'Reactivate'}
          destructive={dialog.user.active}
          onClose={close}
          onConfirm={() =>
            perform(
              () => updateProfile(dialog.user, { active: !dialog.user.active }),
              `${dialog.user.active ? 'Deactivated' : 'Reactivated'} ${dialog.user.display_name}`,
            )
          }
        />
      )}

      {dialog?.kind === 'admin-role' && (
        <ConfirmDialog
          title={dialog.grant ? `Make ${dialog.user.display_name} admin?` : `Remove ${dialog.user.display_name} as admin?`}
          description="Applies at their next sign-in."
          confirmLabel={dialog.grant ? 'Make admin' : 'Remove admin'}
          destructive={!dialog.grant}
          onClose={close}
          onConfirm={() =>
            perform(
              () => saveUser(dialog.user, { grant: dialog.grant ? ['admin'] : [], revoke: dialog.grant ? [] : ['admin'], profile: {} }),
              dialog.grant ? `Made ${dialog.user.display_name} admin` : `Removed ${dialog.user.display_name} as admin`,
            )
          }
        />
      )}
    </div>
  )
}

/** A department picker named departmentId, with No department first. */
function DepartmentField({ id, value, onChange }: { id: string; value: ComboboxOption; onChange: (department: ComboboxOption) => void }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Department</Label>
      <Combobox
        id={id}
        name="departmentId"
        value={value}
        onChange={onChange}
        search={departmentFieldOptions}
        placeholder={NO_DEPARTMENT.label}
        searchPlaceholder="Search departments"
      />
      <FieldError name="departmentId" />
    </div>
  )
}

/** The department id a picked option stands for, or null for No department. */
function departmentIdOf(option: ComboboxOption) {
  return option.value === NO_DEPARTMENT.value ? null : option.value
}

/** A checkbox for each role. Without `checked` the boxes keep their own state and submit as `roles`. */
function RoleCheckboxes({
  idPrefix,
  roles,
  checked,
  onCheckedChange,
  hint,
}: {
  idPrefix: string
  roles: GlobalRole[]
  checked?: GlobalRole[]
  onCheckedChange?: (role: GlobalRole, checked: boolean) => void
  /** A line under the boxes. */
  hint?: string
}) {
  return (
    <fieldset className="grid gap-3" aria-describedby={hint && `${idPrefix}-hint`}>
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
      {hint && (
        <p id={`${idPrefix}-hint`} className="text-muted-foreground text-sm">
          {hint}
        </p>
      )}
      <FieldError name="roles" />
    </fieldset>
  )
}

/** The title and full name of a new or edited user. Without values the inputs keep their own state and submit as title and fullName. */
function NameFields({
  idPrefix,
  title,
  fullName,
  onTitleChange,
  onFullNameChange,
}: {
  idPrefix: string
  title?: string
  fullName?: string
  onTitleChange?: (value: string) => void
  onFullNameChange?: (value: string) => void
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
      <div className="grid content-start gap-2">
        <Label htmlFor={`${idPrefix}-title`}>
          Title <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id={`${idPrefix}-title`}
          name="title"
          value={title}
          onChange={onTitleChange && ((event) => onTitleChange(event.target.value))}
          placeholder="Dr., Ts."
          maxLength={MAX_TITLE_LENGTH}
          autoComplete="off"
        />
      </div>
      <div className="grid content-start gap-2">
        <Label htmlFor={`${idPrefix}-full-name`}>Full name</Label>
        <Input
          id={`${idPrefix}-full-name`}
          name="fullName"
          value={fullName}
          onChange={onFullNameChange && ((event) => onFullNameChange(event.target.value))}
          autoComplete="off"
          required
        />
        <FieldError name="fullName" />
      </div>
    </div>
  )
}

/** A temporary password, named temporaryPassword, shown as it is typed so it can be passed on. */
function TemporaryPasswordField({ idPrefix }: { idPrefix: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={`${idPrefix}-temporary-password`}>Temporary password</Label>
      <Input
        id={`${idPrefix}-temporary-password`}
        name="temporaryPassword"
        type="text"
        autoComplete="off"
        minLength={MIN_PASSWORD_LENGTH}
        aria-describedby={`${idPrefix}-temporary-password-hint`}
        required
      />
      <PasswordHint id={`${idPrefix}-temporary-password-hint`} />
      <FieldError name="temporaryPassword" />
    </div>
  )
}

/**
 * Adds a user with a temporary password. Root adds only admins, so its form has no department and
 * no roles to tick.
 */
function CreateUserDialog({
  forRoot,
  assignable,
  onCreate,
  onClose,
}: {
  forRoot: boolean
  assignable: GlobalRole[]
  onCreate: Action<[NewUser]>
  onClose: () => void
}) {
  const [department, setDepartment] = useState(NO_DEPARTMENT)

  return (
    <FormDialog
      title={forRoot ? 'Add admin' : 'Add a user'}
      submitLabel={forRoot ? 'Add admin' : 'Add user'}
      onClose={onClose}
      onSubmit={async (form) => {
        const roles: GlobalRole[] = forRoot ? ['admin'] : assignable.filter((role) => form.getAll('roles').includes(role))
        const departmentId = departmentIdOf(department)
        if (roles.length === 0) return { field: 'roles', message: 'Choose at least one role.' }
        if (roles.includes('hod') && departmentId === null) return { field: 'departmentId', message: 'An HoD needs a department.' }
        return onCreate({
          email: String(form.get('email')),
          fullName: String(form.get('fullName')).trim(),
          title: String(form.get('title')).trim() || null,
          departmentId,
          roles,
          temporaryPassword: String(form.get('temporaryPassword')),
        })
      }}
    >
      <NameFields idPrefix="create" />
      <div className="grid gap-2">
        <Label htmlFor="create-email">Email</Label>
        <Input id="create-email" name="email" type="email" autoComplete="off" required />
        <FieldError name="email" />
      </div>
      <TemporaryPasswordField idPrefix="create" />
      {!forRoot && <DepartmentField id="create-department" value={department} onChange={setDepartment} />}
      {!forRoot && <RoleCheckboxes idPrefix="create-role" roles={assignable} />}
    </FormDialog>
  )
}

function EditUserDialog({
  user,
  assignable,
  editsProfile,
  editsDepartment,
  onSave,
  onClose,
}: {
  user: UserRow
  assignable: GlobalRole[]
  /** Whether the signed-in user may change this user's title and name. */
  editsProfile: boolean
  /** Whether the signed-in user may change this user's department. */
  editsDepartment: boolean
  onSave: Action<[UserChanges]>
  onClose: () => void
}) {
  const held = rolesOf(user)
  const [roles, setRoles] = useState(() => assignable.filter((role) => held.includes(role)))
  const [title, setTitle] = useState(user.title ?? '')
  const [fullName, setFullName] = useState(user.full_name)
  const [department, setDepartment] = useState(user.department ? departmentOption(user.department) : NO_DEPARTMENT)
  const departmentId = departmentIdOf(department)

  const profile: UserChanges['profile'] = {
    ...(fullName.trim() !== user.full_name && { full_name: fullName.trim() }),
    ...((title.trim() || null) !== user.title && { title: title.trim() || null }),
    ...(departmentId !== (user.department?.id ?? null) && { department_id: departmentId }),
  }
  const changes: UserChanges = {
    grant: roles.filter((role) => !held.includes(role)),
    revoke: assignable.filter((role) => held.includes(role) && !roles.includes(role)),
    profile,
  }
  const changed = changes.grant.length > 0 || changes.revoke.length > 0 || Object.keys(profile).length > 0

  return (
    <FormDialog
      title={`Edit ${user.display_name}`}
      description={user.email}
      submitLabel="Save"
      submitDisabled={!changed}
      onClose={onClose}
      onSubmit={async () => {
        if (fullName.trim() === '') return { field: 'fullName', message: 'Enter a full name.' }
        if (roles.includes('hod') && departmentId === null) {
          const message = 'An HoD needs a department.'
          return editsDepartment ? { field: 'departmentId', message } : message
        }
        return onSave(changes)
      }}
    >
      {editsProfile && (
        <NameFields idPrefix="edit" title={title} fullName={fullName} onTitleChange={setTitle} onFullNameChange={setFullName} />
      )}
      {editsDepartment && <DepartmentField id="edit-department" value={department} onChange={setDepartment} />}
      <RoleCheckboxes
        idPrefix="edit-role"
        roles={assignable}
        checked={roles}
        onCheckedChange={(role, checked) =>
          setRoles((current) => (checked ? [...current, role] : current.filter((r) => r !== role)))
        }
        hint="Applies at their next sign-in."
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
    if (error) return friendlyError(error)
  }
  if (Object.keys(changes.profile).length > 0) {
    const error = await updateProfile(user, changes.profile)
    if (error) return error
  }
  for (const role of changes.grant) {
    const { error } = await supabase.from('user_roles').insert({ user_id: user.id, role })
    if (error) return friendlyError(error)
  }
  return null
}

async function updateProfile(user: UserRow, changes: ProfileChanges) {
  const { error } = await supabase.from('profiles').update(changes).eq('id', user.id)
  return error && friendlyError(error)
}

/** Calls the accounts Edge Function, and returns why it failed, or null when it succeeded. */
async function callAccounts(body: Record<string, unknown>): Promise<ActionError | null> {
  const { error } = await supabase.functions.invoke('accounts', { body })
  if (!error) return null
  const refusal = await refusalOf(error)
  if (refusal instanceof UserFacingError && refusal.code === 'email_exists') return { field: 'email', message: friendlyError(refusal) }
  return friendlyError(refusal)
}

/** An Edge Function's error as the function gave it, or the error itself when the function never answered. */
async function refusalOf(error: Error) {
  if (!(error instanceof FunctionsHttpError)) return error
  const payload: { code?: string; message?: string } | null = await error.context.json().catch(() => null)
  return new UserFacingError(payload?.code ?? 'internal_error', payload?.message ?? '', error.context.status)
}
