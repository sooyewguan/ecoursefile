import { FunctionsHttpError } from '@supabase/supabase-js'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth-provider.tsx'
import { GLOBAL_ROLES, ROLE_LABELS, type GlobalRole } from '../roles.ts'
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

export function Users() {
  const state = useAuth()
  const [data, setData] = useState<PageData | null>(null)
  const [message, setMessage] = useState<string | null>(null)

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
      setMessage((users.error ?? departments.error ?? assignable.error)!.message)
      return
    }
    setData({ users: users.data, departments: departments.data, assignable: assignable.data })
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  if (state.kind !== 'ready' || !data) return <p>Loading…</p>

  const me = state.profile.id
  const choosesDepartment = state.roles.includes('admin')
  const departmentName = new Map(data.departments.map((d) => [d.id, `${d.code} ${d.name}`]))

  async function run(action: () => Promise<string | null>, success: string | null = null) {
    const error = await action()
    setMessage(error ?? success)
    await reload()
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const email = String(form.get('email'))
    await run(async () => {
      const error = await callAccounts({
        action: 'create-user',
        email,
        fullName: String(form.get('fullName')),
        departmentId: String(form.get('departmentId') ?? '') || null,
        roles: form.getAll('roles').map(String),
        temporaryPassword: String(form.get('temporaryPassword')),
      })
      if (!error) formElement.reset()
      return error
    }, `Created ${email}. They must change the temporary password at first sign-in.`)
  }

  function toggleRole(user: UserRow, role: GlobalRole, granted: boolean) {
    return run(async () => {
      const { error } = granted
        ? await supabase.from('user_roles').insert({ user_id: user.id, role })
        : await supabase.from('user_roles').delete().match({ user_id: user.id, role })
      return error?.message ?? null
    })
  }

  function updateProfile(user: UserRow, changes: { department_id?: string | null; active?: boolean }) {
    return run(async () => {
      const { error } = await supabase.from('profiles').update(changes).eq('id', user.id)
      return error?.message ?? null
    })
  }

  async function onResetPassword(event: FormEvent<HTMLFormElement>, user: UserRow) {
    event.preventDefault()
    const formElement = event.currentTarget
    const temporaryPassword = String(new FormData(formElement).get('temporaryPassword'))
    await run(async () => {
      const error = await callAccounts({ action: 'reset-password', userId: user.id, temporaryPassword })
      if (!error) formElement.reset()
      return error
    }, `Reset the password of ${user.email}. They must change it at their next sign-in.`)
  }

  return (
    <main className="wide">
      <p>
        <Link to="/">Home</Link>
      </p>
      <h1>Users</h1>
      {message && <p role="status">{message}</p>}

      {data.assignable.length > 0 && (
        <form onSubmit={onCreate} aria-label="Add a user">
          <h2>Add a user</h2>
          <label>
            Full name
            <input name="fullName" required />
          </label>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Temporary password
            <input name="temporaryPassword" type="text" autoComplete="off" required />
          </label>
          {choosesDepartment && (
            <label>
              Department
              <select name="departmentId" defaultValue="">
                <option value="">No department</option>
                {data.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <fieldset>
            <legend>Roles</legend>
            {data.assignable.map((role) => (
              <label key={role}>
                <input type="checkbox" name="roles" value={role} />
                {ROLE_LABELS[role]}
              </label>
            ))}
          </fieldset>
          <button type="submit">Add user</button>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Department</th>
            <th>Roles</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.users.map((user) => {
            const roles = user.user_roles.map((r) => r.role)
            // The database refuses role changes on yourself and on root, so the page offers none.
            const grantable = user.id !== me && !roles.includes('root')
            return (
              <tr key={user.id}>
                <td>{user.full_name}</td>
                <td>{user.email}</td>
                <td>
                  {user.manageable && choosesDepartment ? (
                    <select
                      aria-label={`Department of ${user.email}`}
                      value={user.department_id ?? ''}
                      onChange={(event) => void updateProfile(user, { department_id: event.target.value || null })}
                    >
                      <option value="">No department</option>
                      {data.departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code} {d.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    (user.department_id && departmentName.get(user.department_id)) ?? ''
                  )}
                </td>
                <td>
                  {GLOBAL_ROLES.filter((role) => roles.includes(role) && !(grantable && data.assignable.includes(role)))
                    .map((role) => ROLE_LABELS[role])
                    .join(', ')}
                  {grantable &&
                    data.assignable.map((role) => (
                      <label key={role}>
                        <input
                          type="checkbox"
                          aria-label={`${ROLE_LABELS[role]} role for ${user.email}`}
                          checked={roles.includes(role)}
                          onChange={(event) => void toggleRole(user, role, event.target.checked)}
                        />
                        {ROLE_LABELS[role]}
                      </label>
                    ))}
                </td>
                <td>{user.active ? 'Active' : 'Deactivated'}</td>
                <td>
                  {user.manageable && (
                    <>
                      <form onSubmit={(event) => void onResetPassword(event, user)}>
                        <input
                          name="temporaryPassword"
                          type="text"
                          autoComplete="off"
                          aria-label={`Temporary password for ${user.email}`}
                          placeholder="Temporary password"
                          required
                        />
                        <button type="submit">Reset password</button>
                      </form>
                      <button type="button" onClick={() => void updateProfile(user, { active: !user.active })}>
                        {user.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </main>
  )
}

/** Calls the accounts Edge Function and returns its error message, or null when it succeeded. */
async function callAccounts(body: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.functions.invoke('accounts', { body })
  if (!error) return null
  if (error instanceof FunctionsHttpError) {
    const payload: { message?: string } | null = await error.context.json().catch(() => null)
    return payload?.message ?? error.message
  }
  return error.message
}
