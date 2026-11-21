// One Google account, signed in with a refresh token. The drive storage adapter and the gmail mail
// adapter share it, and the GOOGLE_* secrets hold its client and token. npm run google:token prints
// a token for both scopes.
import { firstBytes, requiredEnv } from './http.ts'

export type GoogleCredentials = { clientId: string; clientSecret: string; refreshToken: string }

export function googleCredentialsFromEnv(): GoogleCredentials {
  return {
    clientId: requiredEnv('GOOGLE_CLIENT_ID'),
    clientSecret: requiredEnv('GOOGLE_CLIENT_SECRET'),
    refreshToken: requiredEnv('GOOGLE_REFRESH_TOKEN'),
  }
}

export function googleClient(credentials: GoogleCredentials) {
  let token: { value: string; expiresAt: number } | null = null

  /** An access token from the refresh token, fetched again a minute before the last one expires. */
  async function accessToken() {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    if (!response.ok) throw await googleFailure(response, 'token request')
    const body: { access_token: string; expires_in: number } = await response.json()
    token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 }
    return token.value
  }

  /** Calls a Google API as the account, with a JSON body, if any, and any other headers. */
  async function google(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    return fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=UTF-8' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  return { google }
}

/** An error with the status and the start of the body, which may be long or binary. */
export async function googleFailure(response: Response, what: string) {
  const body = new TextDecoder().decode(await firstBytes(response, 500))
  return new Error(`Google ${what} failed with ${response.status}: ${body}`)
}
