// Account administration that needs the service role: creating a user with a temporary
// password and resetting a password. The SQL functions assignable_roles and can_manage decide
// who may do what, asked as the caller.
import { authFetch, invalid, isRecord, isUuid, Refusal, rest, SERVICE, serveJson } from '../_shared/http.ts'

const GLOBAL_ROLES = ['root', 'admin', 'lecturer', 'auditor', 'hod', 'dean', 'deputy_dean'] as const
type GlobalRole = (typeof GLOBAL_ROLES)[number]

type AccountRequest =
  | {
      action: 'create-user'
      email: string
      fullName: string
      departmentId: string | null
      roles: GlobalRole[]
      temporaryPassword: string
    }
  | { action: 'reset-password'; userId: string; temporaryPassword: string }

serveJson(async (body, caller) => {
  const request = parseRequest(body)
  return request.action === 'create-user' ? await createUser(request, caller) : await resetPassword(request, caller)
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
    case 'reset-password': {
      const { userId, temporaryPassword } = input
      if (!isUuid(userId) || typeof temporaryPassword !== 'string') {
        throw invalid('reset-password needs userId and temporaryPassword.')
      }
      return { action: 'reset-password', userId, temporaryPassword }
    }
    default:
      throw invalid('action must be create-user or reset-password.')
  }
}

// Root may create accounts whose roles are all admin, and admins may create staff. Each new
// account holds at least one role the caller may grant, so root creates nothing but admins.
async function createUser(request: Extract<AccountRequest, { action: 'create-user' }>, caller: string) {
  const assignable = await callerRpc<GlobalRole[]>('assignable_roles', {}, caller)
  if (request.roles.length === 0 || !request.roles.every((role) => assignable.includes(role))) {
    throw new Refusal(403, 'forbidden', 'You may not create a user with these roles.')
  }

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

function isGlobalRole(value: unknown): value is GlobalRole {
  return (GLOBAL_ROLES as readonly unknown[]).includes(value)
}
