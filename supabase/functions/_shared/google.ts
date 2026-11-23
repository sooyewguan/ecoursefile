// Calls Google APIs as the Firebase project's service account, for the FCM push adapter.
// FIREBASE_SERVICE_ACCOUNT holds the service account's JSON key, as the
// Firebase console downloads it. The function signs a JWT with the key and swaps it for an access
// token, which it keeps until five minutes before it expires.
import { requiredEnv } from './http.ts'

export type ServiceAccount = { projectId: string; clientEmail: string; privateKey: string }

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

/** Lets the token send through FCM, and nothing else. */
const SCOPES = 'https://www.googleapis.com/auth/firebase.messaging'

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

/** A fetch that sends the service account's access token. */
export function googleClient(account: ServiceAccount) {
  const signingKey = crypto.subtle.importKey('pkcs8', pemBytes(account.privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  let cached: { token: string; expiresAt: number } | null = null

  async function accessToken() {
    if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.token
    const now = Math.floor(Date.now() / 1000)
    const unsigned = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(
      JSON.stringify({ iss: account.clientEmail, scope: SCOPES, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
    )}`
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey, new TextEncoder().encode(unsigned))
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}` }),
    })
    if (!response.ok) throw new Error(`Google refused the service account with ${response.status}: ${await response.text()}`)
    const { access_token, expires_in }: { access_token: string; expires_in: number } = await response.json()
    cached = { token: access_token, expiresAt: Date.now() + expires_in * 1000 }
    return access_token
  }

  return {
    async fetch(url: string, body: unknown) {
      return fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    },
  }
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
