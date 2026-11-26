// HTTP plumbing shared by the Edge Functions. Functions import only files in this folder, never
// remote modules (see README).

/** A refusal the caller can act on. The function answers with its status and { code, message }. */
export class Refusal extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/** The Authorization header for calls that bypass RLS. */
export const SERVICE = `Bearer ${SERVICE_KEY}`

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * Serves a JSON API on POST for signed-in callers. The handler gets the parsed body and the
 * caller's Authorization header, and its result is the 200 response. A Refusal becomes its
 * status and { code, message }, and any other error a 500.
 */
export function serveJson(handle: (body: unknown, caller: string) => Promise<unknown>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
    try {
      if (req.method !== 'POST') throw new Refusal(405, 'invalid_request', 'Use POST.')
      const caller = req.headers.get('Authorization')
      if (!caller) throw new Refusal(401, 'unauthorized', 'Sign in first.')
      return json(200, await handle(await req.json().catch(() => null), caller))
    } catch (error) {
      if (error instanceof Refusal) return json(error.status, { code: error.code, message: error.message })
      console.error(error)
      return json(500, { code: 'internal_error', message: 'The request failed.' })
    }
  })
}

/**
 * Calls PostgREST as the caller, or as the service role when authorization is SERVICE. A body of
 * bytes goes as it is, as application/octet-stream, and any other body as JSON.
 */
export async function rest<T = unknown>(
  method: string,
  path: string,
  body: unknown,
  authorization: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const apikey = authorization === SERVICE ? SERVICE_KEY : ANON_KEY
  const bytes = body instanceof Uint8Array
  const response = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: { apikey, Authorization: authorization, 'Content-Type': bytes ? 'application/octet-stream' : 'application/json', ...headers },
    body: bytes ? body : JSON.stringify(body),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (response.ok) return payload
  if (response.status === 401) throw new Refusal(401, 'unauthorized', 'Sign in again.')
  if (response.status === 403) throw new Refusal(403, 'forbidden', payload?.message ?? 'Not allowed.')
  if (response.status < 500) throw invalid(payload?.message ?? 'The request was refused.')
  throw new Error(`${method} ${path} failed with ${response.status}: ${text}`)
}

/** Calls PostgREST with GET as the service role, and returns the response unread, for a body that is not JSON. */
export function serviceGet(path: string, headers: Record<string, string>) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers: { apikey: SERVICE_KEY, Authorization: SERVICE, ...headers } })
}

/** Calls the Supabase Auth API, as the caller or with the service role. */
export function authFetch(method: string, path: string, body: unknown, authorization: string) {
  return fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method,
    headers: {
      apikey: authorization === SERVICE ? SERVICE_KEY : ANON_KEY,
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** A signed-in user. */
export type User = { id: string; email: string }

/** The user whose access token the Authorization header holds, for RPCs that the service role calls on their behalf. */
export async function callerUser(caller: string): Promise<User> {
  const response = await authFetch('GET', '/user', undefined, caller)
  if (!response.ok) throw new Refusal(401, 'unauthorized', 'Sign in again.')
  const { id, email }: User = await response.json()
  return { id, email }
}

/** A PostgREST filter that matches any of these values, such as in.("a","b"), each quoted so that it may hold commas or parentheses, and encoded for a URL. */
export function inList(values: string[]) {
  return encodeURIComponent(`in.(${values.map((value) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')})`)
}

/** The value of an Edge Function secret, or an error that names the missing secret. */
export function requiredEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Set the ${name} secret.`)
  return value
}

export function invalid(message: string) {
  return new Refusal(400, 'invalid_request', message)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

/** The first length bytes of the body, or all of them when it is shorter. The rest is never read. */
export async function firstBytes(response: Response, length: number) {
  const bytes = new Uint8Array(length)
  let received = 0
  const reader = response.body?.getReader()
  while (reader && received < length) {
    const { done, value } = await reader.read()
    if (done) break
    const part = value.subarray(0, length - received)
    bytes.set(part, received)
    received += part.length
  }
  await reader?.cancel()
  return bytes.slice(0, received)
}
