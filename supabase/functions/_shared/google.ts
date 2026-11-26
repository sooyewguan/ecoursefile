// Calls Google APIs with an OAuth access token. Two credentials sign in, each with its own token
// request. The FCM push adapter signs in as the Firebase project's service account:
// FIREBASE_SERVICE_ACCOUNT holds its JSON key, as the Firebase console downloads it, and the
// request carries a JWT signed with the key. The drive storage adapter signs in as the Google
// account that holds the files: the GOOGLE_* secrets hold an OAuth client and the account's refresh
// token, which npm run google:token prints. The client keeps each access token until five minutes
// before it expires.
import { firstBytes, requiredEnv } from './http.ts'

export type ServiceAccount = { projectId: string; clientEmail: string; privateKey: string }

/** The Google account that holds the files: an OAuth client of the Desktop app type, and the account's refresh token for it. */
export type DriveAccount = { clientId: string; clientSecret: string; refreshToken: string }

/** The form of a token request, made again for each new access token. */
type Grant = () => Promise<URLSearchParams>

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

/** Lets the service account's token send through FCM, and nothing else. */
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

export function serviceAccountFromEnv(): ServiceAccount {
  let key: unknown
  try {
    key = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'))
  } catch {
    throw new Error('Set the FIREBASE_SERVICE_ACCOUNT secret to the JSON key of the Firebase service account.')
  }
  const { project_id, client_email, private_key } = key as Record<string, unknown>
  if (typeof project_id !== 'string' || typeof client_email !== 'string' || typeof private_key !== 'string') {
    throw new Error('FIREBASE_SERVICE_ACCOUNT needs project_id, client_email and private_key.')
  }
  return { projectId: project_id, clientEmail: client_email, privateKey: private_key }
}

export function driveAccountFromEnv(): DriveAccount {
  return {
    clientId: requiredEnv('GOOGLE_CLIENT_ID'),
    clientSecret: requiredEnv('GOOGLE_CLIENT_SECRET'),
    refreshToken: requiredEnv('GOOGLE_REFRESH_TOKEN'),
  }
}

/** The service account's token request: a JWT for the FCM scope, signed with its key. */
export function serviceAccountGrant(account: ServiceAccount): Grant {
  const signingKey = crypto.subtle.importKey('pkcs8', pemBytes(account.privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  return async () => {
    const now = Math.floor(Date.now() / 1000)
    const unsigned = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(
      JSON.stringify({ iss: account.clientEmail, scope: FCM_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
    )}`
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey, new TextEncoder().encode(unsigned))
    return new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}` })
  }
}

/** The Drive account's token request: its refresh token, which holds only the drive.file scope. */
export function refreshTokenGrant(account: DriveAccount): Grant {
  return async () =>
    new URLSearchParams({
      client_id: account.clientId,
      client_secret: account.clientSecret,
      refresh_token: account.refreshToken,
      grant_type: 'refresh_token',
    })
}

/** A fetch with the access token that grant gets. It sends a body, if any, as JSON, and any other headers. */
export function googleClient(grant: Grant) {
  let cached: { token: string; expiresAt: number } | null = null

  async function accessToken() {
    if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.token
    const response = await fetch(TOKEN_URL, { method: 'POST', body: await grant() })
    if (!response.ok) throw await googleFailure(response, 'token request')
    const { access_token, expires_in }: { access_token: string; expires_in: number } = await response.json()
    cached = { token: access_token, expiresAt: Date.now() + expires_in * 1000 }
    return access_token
  }

  return async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=UTF-8' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
}

/** An error with the status and the start of the body, which may be long or binary. */
export async function googleFailure(response: Response, what: string) {
  const body = new TextDecoder().decode(await firstBytes(response, 500))
  return new Error(`Google ${what} failed with ${response.status}: ${body}`)
}

/** The DER bytes of a PEM private key. */
function pemBytes(pem: string) {
  const base64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

function base64Url(data: string | Uint8Array) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
