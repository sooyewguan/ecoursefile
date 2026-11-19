// SharePoint storage through Microsoft Graph. The Entra app has the Sites.Selected application
// permission and the write role on one site, and the items live in that site's default document
// library.
import type { Storage } from './storage.ts'

export type GraphConfig = { tenantId: string; clientId: string; clientSecret: string; siteId: string }

const GRAPH_URL = 'https://graph.microsoft.com/v1.0'

export function graphStorage(config: GraphConfig): Storage {
  const drive = `${GRAPH_URL}/sites/${config.siteId}/drive`
  let token: { value: string; expiresAt: number } | null = null

  async function accessToken() {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value
    const response = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    })
    if (!response.ok) throw await failure(response, 'token request')
    const body: { access_token: string; expires_in: number } = await response.json()
    token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 }
    return token.value
  }

  async function graph(method: string, url: string, body?: unknown) {
    return fetch(url, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  const itemAt = (path: string) => `${drive}/root:/${path.split('/').map(encodeURIComponent).join('/')}`

  return {
    async createUploadSession(path) {
      const response = await graph('POST', `${itemAt(path)}:/createUploadSession`, {
        item: { '@microsoft.graph.conflictBehavior': 'fail' },
      })
      if (!response.ok) throw await failure(response, 'createUploadSession')
      const session: { uploadUrl: string; expirationDateTime: string } = await response.json()
      return { uploadUrl: session.uploadUrl, expiresAt: session.expirationDateTime }
    },

    async getItem(path) {
      const response = await graph('GET', `${itemAt(path)}?$select=id,size,file`)
      if (response.status === 404) return null
      if (!response.ok) throw await failure(response, 'get item')
      const item: { id: string; size: number; file?: { mimeType: string } } = await response.json()
      return { id: item.id, size: item.size, mimeType: item.file?.mimeType ?? '' }
    },

    // /content usually redirects to a pre-authenticated download URL. Graph takes the Range header
    // only on that URL, so the redirect is followed by hand. When /content sends the bytes itself,
    // or the download URL ignores Range, only the first bytes are read.
    async readStart(id, length) {
      const content = await fetch(`${drive}/items/${encodeURIComponent(id)}/content`, {
        headers: { Authorization: `Bearer ${await accessToken()}` },
        redirect: 'manual',
      })
      const downloadUrl = content.headers.get('Location')
      if (content.ok && !downloadUrl) return firstBytes(content, length)
      if (!downloadUrl) throw await failure(content, 'get content')
      await content.body?.cancel()
      const response = await fetch(downloadUrl, { headers: { Range: `bytes=0-${length - 1}` } })
      if (!response.ok) throw await failure(response, 'download')
      return firstBytes(response, length)
    },

    async deleteItem(id) {
      const response = await graph('POST', `${drive}/items/${encodeURIComponent(id)}/permanentDelete`)
      if (!response.ok && response.status !== 404) throw await failure(response, 'permanentDelete')
    },
  }
}

/** An error with the status and the start of the body, which may be long or binary. */
async function failure(response: Response, what: string) {
  const body = new TextDecoder().decode(await firstBytes(response, 500))
  return new Error(`Graph ${what} failed with ${response.status}: ${body}`)
}

/** The first length bytes of the body, or all of them when it is shorter. The rest is never read. */
async function firstBytes(response: Response, length: number) {
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
