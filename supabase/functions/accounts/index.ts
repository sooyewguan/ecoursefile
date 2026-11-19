// Account administration that needs the service role: creating a user with a temporary
// password and resetting a password. The SQL functions assignable_roles and can_manage decide
// who may do what, asked as the caller. This file imports nothing (see README).

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

type ErrorCode = 'invalid_request' | 'unauthorized' | 'forbidden' | 'email_exists' | 'internal_error'

class Refusal extends Error {
  status: number
  code: ErrorCode
  constructor(status: number, code: ErrorCode, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SERVICE = `Bearer ${SERVICE_KEY}`

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  try {
    if (req.method !== 'POST') throw new Refusal(405, 'invalid_request', 'Use POST.')
    const caller = req.headers.get('Authorization')
    if (!caller) throw new Refusal(401, 'unauthorized', 'Sign in first.')
    const request = parseRequest(await req.json().catch(() => null))
    const result = request.action === 'create-user' ? await createUser(request, caller) : await resetPassword(request, caller)
    return json(200, result)
  } catch (error) {
    if (error instanceof Refusal) return json(error.status, { code: error.code, message: error.message })
    console.error(error)
    return json(500, { code: 'internal_error', message: 'The request failed.' })
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
  return rest('POST', `/rpc/${name}`, args, caller) as Promise<T>
}

async function rest(method: string, path: string, body: unknown, authorization: string): Promise<unknown> {
  const apikey = authorization === SERVICE ? SERVICE_KEY : ANON_KEY
  const response = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: { apikey, Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (response.ok) return payload
  if (response.status === 401) throw new Refusal(401, 'unauthorized', 'Sign in again.')
  if (response.status === 403) throw new Refusal(403, 'forbidden', payload?.message ?? 'Not allowed.')
  if (response.status < 500) throw invalid(payload?.message ?? 'The request was refused.')
  throw new Error(`${method} ${path} failed with ${response.status}: ${text}`)
}

async function auth<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: SERVICE, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (response.ok) return payload as T
  if (payload?.error_code === 'email_exists') throw new Refusal(409, 'email_exists', payload.msg)
  if (response.status < 500) throw invalid(payload?.msg ?? 'The request was refused.')
  throw new Error(`${method} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`)
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

function invalid(message: string) {
  return new Refusal(400, 'invalid_request', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function isGlobalRole(value: unknown): value is GlobalRole {
  return (GLOBAL_ROLES as readonly unknown[]).includes(value)
}
