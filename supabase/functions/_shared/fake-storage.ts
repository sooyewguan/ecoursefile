// A stand-in for SharePoint on the local stack. It keeps items in the fake_storage schema, so seam 1
// tests can read what was stored, copied and deleted.
// Its upload and download URLs point at the fake-storage Edge Function, which takes chunks and
// serves items the way Graph does.
import { rest, SERVICE } from './http.ts'
import type { Storage } from './storage.ts'

const SCHEMA = { 'Accept-Profile': 'fake_storage', 'Content-Profile': 'fake_storage' }

/** How long a download URL works, about as long as a Graph download URL. */
const DOWNLOAD_URL_LIFETIME_MS = 60 * 60 * 1000

/** functionUrl is the fake-storage Edge Function's URL as the browser reaches it. */
export function fakeStorage(functionUrl: string): Storage {
  return {
    async createUploadSession(path) {
      const [session] = await rest<{ id: string; expires_at: string }[]>(
        'POST',
        '/upload_sessions?select=id,expires_at',
        { path },
        SERVICE,
        { ...SCHEMA, Prefer: 'return=representation' },
      )
      return { uploadUrl: `${functionUrl}/${session.id}`, expiresAt: session.expires_at }
    },

    async getItem(path) {
      const [item] = await rest<{ id: string; size: number; mime_type: string }[]>(
        'GET',
        `/items?select=id,size,mime_type&path=eq.${encodeURIComponent(path)}`,
        undefined,
        SERVICE,
        SCHEMA,
      )
      return item ? { id: item.id, size: item.size, mimeType: item.mime_type } : null
    },

    async readStart(id, length) {
      const bytes = await rest<string | null>('POST', '/rpc/read_start', { item_id: id, length }, SERVICE, SCHEMA)
      // PostgREST sends bytea as \x and two hex digits per byte.
      return Uint8Array.from(bytes?.slice(2).match(/../g) ?? [], (pair) => parseInt(pair, 16))
    },

    // The database copies the bytes, so they never pass through the function.
    async copyItem(id, path) {
      const [item] = await rest<{ id: string; size: number; mime_type: string }[]>(
        'POST',
        '/rpc/copy_item?select=id,size,mime_type',
        { item_id: id, path },
        SERVICE,
        SCHEMA,
      )
      return item ? { id: item.id, size: item.size, mimeType: item.mime_type } : null
    },

    // The URL carries its expiry and a signature of the item and expiry, so it needs no stored session.
    async downloadUrl(id) {
      const expires = String(Date.now() + DOWNLOAD_URL_LIFETIME_MS)
      return `${functionUrl}/${id}?expires=${expires}&signature=${await downloadSignature(id, expires)}`
    },

    async deleteItem(id) {
      await rest('DELETE', `/items?id=eq.${encodeURIComponent(id)}`, undefined, SERVICE, SCHEMA)
    },
  }
}

const signingKey = crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])

/**
 * The signature of a download URL for the item until expires, in milliseconds since 1970: an HMAC of
 * both, keyed with the service role key, in hex. The fake-storage function checks it.
 */
export async function downloadSignature(itemId: string, expires: string) {
  const mac = await crypto.subtle.sign('HMAC', await signingKey, new TextEncoder().encode(`${itemId}/${expires}`))
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
