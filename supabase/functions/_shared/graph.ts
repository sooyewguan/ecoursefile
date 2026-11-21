// Microsoft Graph as the Entra app, with an app-only token from its client credentials. The mail
// adapter uses it.
import { firstBytes } from './http.ts'

export type GraphCredentials = { tenantId: string; clientId: string; clientSecret: string }

export const GRAPH_URL = 'https://graph.microsoft.com/v1.0'

export function graphClient(credentials: GraphCredentials) {
  let token: { value: string; expiresAt: number } | null = null

  /** An app-only access token, fetched again a minute before the last one expires. */
  async function accessToken() {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value
    const response = await fetch(`https://login.microsoftonline.com/${credentials.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    })
    if (!response.ok) throw await graphFailure(response, 'token request')
    const body: { access_token: string; expires_in: number } = await response.json()
    token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 }
    return token.value
  }

  /** Calls Graph with a JSON body, if any, as the app. */
  async function graph(method: string, url: string, body?: unknown) {
    return fetch(url, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  return { accessToken, graph }
}

/** An error with the status and the start of the body, which may be long or binary. */
export async function graphFailure(response: Response, what: string) {
  const body = new TextDecoder().decode(await firstBytes(response, 500))
  return new Error(`Graph ${what} failed with ${response.status}: ${body}`)
}
