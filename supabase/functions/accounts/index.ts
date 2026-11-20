// Account administration that needs the service role: creating a user with a temporary
// password, importing users from a CSV file, and resetting a password. The SQL functions
// jwt_roles, assignable_roles and can_manage decide who may do what, asked as the caller.
import { authFetch, inList, invalid, isRecord, isUuid, Refusal, rest, SERVICE, serveJson } from '../_shared/http.ts'
import { isGlobalRole, type GlobalRole } from '../_shared/roles.ts'
import { readUserImport, toNewUsers, type ImportedRow, type NewUser, type ParsedRow } from '../_shared/user-import.ts'

type AccountRequest =
  | ({ action: 'create-user' } & NewUser)
  | { action: 'import-users'; csv: string }
  | { action: 'reset-password'; userId: string; temporaryPassword: string }

serveJson(async (body, caller) => {
  const request = parseRequest(body)
  switch (request.action) {
    case 'create-user':
      return await createUser(request, caller)
    case 'import-users':
      return await importUsers(request.csv, caller)
    case 'reset-password':
      return await resetPassword(request, caller)
  }
})

function parseRequest(body: unknown): AccountRequest {
  const input = isRecord(body) ? body : {}
  switch (input.action) {
    case 'create-user': {
      const { email, fullName, departmentId, roles, temporaryPassword } = input
      if (
        typeof email !== 'string' ||
        !email.includes('@') ||
        typeof fullName !== 'string' ||
        fullName.trim() === '' ||
        !(departmentId === null || isUuid(departmentId)) ||
        !Array.isArray(roles) ||
        !roles.every(isGlobalRole) ||
        typeof temporaryPassword !== 'string'
      ) {
        throw invalid('create-user needs email, fullName, departmentId (or null), roles and temporaryPassword.')
      }
      return {
        action: 'create-user',
        email: email.trim(),
        fullName: fullName.trim(),
        departmentId,
        roles: [...new Set(roles)],
        temporaryPassword,
      }
    }
    case 'import-users': {
      if (typeof input.csv !== 'string') throw invalid('import-users needs csv, the text of the file.')
      return { action: 'import-users', csv: input.csv }
    }
    case 'reset-password': {
      const { userId, temporaryPassword } = input
      if (!isUuid(userId) || typeof temporaryPassword !== 'string') {
        throw invalid('reset-password needs userId and temporaryPassword.')
      }
      return { action: 'reset-password', userId, temporaryPassword }
    }
    default:
      throw invalid('action must be create-user, import-users or reset-password.')
  }
}

// Root may create accounts whose roles are all admin, and admins may create staff. Each new
// account holds at least one role the caller may grant, so root creates nothing but admins.
async function createUser(request: NewUser, caller: string) {
  const assignable = await callerRpc<GlobalRole[]>('assignable_roles', {}, caller)
  const refused = request.roles.filter((role) => !assignable.includes(role))
  if (request.roles.length === 0) throw new Refusal(403, 'forbidden', 'A user needs at least one role.')
  if (refused.length > 0) throw new Refusal(403, 'forbidden', `You may not give the ${refused.join(' or ')} role.`)
  // The grant rules refuse it too, but only once the account exists.
  if (request.roles.includes('hod') && request.departmentId === null) throw new Refusal(403, 'forbidden', 'An HoD needs a department.')

  // The new profile starts with the must-change-password flag set.
  const user = await auth<{ id: string }>('POST', '/admin/users', {
    email: request.email,
    password: request.temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: request.fullName },
  })
  try {
    if (request.departmentId) {
      await rest('PATCH', `/profiles?id=eq.${user.id}`, { department_id: request.departmentId }, SERVICE)
    }
    // Inserted as the caller, so the grant rules in RLS decide.
    await rest('POST', '/user_roles', request.roles.map((role) => ({ user_id: user.id, role })), caller)
  } catch (error) {
    await auth('DELETE', `/admin/users/${user.id}`)
    throw error
  }
  return { userId: user.id }
}

/**
 * Creates the user of each row of the file that holds one, as create-user does, and returns what it
 * did with each row. A row that holds no user, or whose user create-user refuses, is rejected with
 * the reason and stops no other row. Every row's email is new or refused, so importing a file again
 * creates nobody twice. Only admins import, so no row can give the admin or root role.
 */
async function importUsers(csv: string, caller: string): Promise<{ rows: ImportedRow[] }> {
  if (!(await callerRpc<GlobalRole[]>('jwt_roles', {}, caller)).includes('admin')) {
    throw new Refusal(403, 'forbidden', 'Only admins may import users.')
  }
  const file = readUserImport(csv)
  if ('problem' in file) throw invalid(file.problem)
  // Only the departments the file names, since the API returns at most 1,000 rows.
  const codes = [...new Set(file.rows.map((row) => row.cells.department).filter(Boolean))]
  const departments = codes.length === 0 ? [] : await rest<{ id: string; code: string }[]>('GET', `/departments?select=id,code&code=${inList(codes)}`, undefined, caller)
  const rows: ImportedRow[] = []
  for (const row of toNewUsers(file.rows, new Map(departments.map((department) => [department.code, department.id])))) {
    rows.push(await importRow(row, caller))
  }
  return { rows }
}

async function importRow(parsed: ParsedRow, caller: string): Promise<ImportedRow> {
  const { row, email } = parsed
  if (!('user' in parsed)) return { row, email, status: 'rejected', code: parsed.code, reason: parsed.reason }
  try {
    return { row, email, status: 'created', ...(await createUser(parsed.user, caller)) }
  } catch (error) {
    if (error instanceof Refusal) return { row, email, status: 'rejected', code: error.code, reason: error.message }
    // A server error stops only its row, so the report still covers the rows done so far.
    console.error(error)
    return { row, email, status: 'rejected', code: 'internal_error', reason: 'The server failed to add this user. Import the row again later.' }
  }
}

async function resetPassword(request: Extract<AccountRequest, { action: 'reset-password' }>, caller: string) {
  if (!(await callerRpc<boolean>('can_manage', { target: request.userId }, caller))) {
    throw new Refusal(403, 'forbidden', 'You may not reset this password.')
  }
  await auth('PUT', `/admin/users/${request.userId}`, { password: request.temporaryPassword })
  // A password change clears the flag, so the flag is set after it.
  await rest('PATCH', `/profiles?id=eq.${request.userId}`, { must_change_password: true }, SERVICE)
  return { userId: request.userId }
}

function callerRpc<T>(name: string, args: Record<string, unknown>, caller: string): Promise<T> {
  return rest<T>('POST', `/rpc/${name}`, args, caller)
}

async function auth<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await authFetch(method, path, body, SERVICE)
  const payload = await response.json().catch(() => null)
  if (response.ok) return payload as T
  if (payload?.error_code === 'email_exists') throw new Refusal(409, 'email_exists', payload.msg)
  if (response.status < 500) throw invalid(payload?.msg ?? 'The request was refused.')
  throw new Error(`${method} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`)
}
