// A stand-in for Google Drive on the local stack. It keeps items in the fake_storage schema, so seam 1
// tests can read what was stored, copied and deleted.
// Its upload and download URLs point at the fake-storage Edge Function, which takes chunks the way
// a Drive upload session does and serves items the way the drive-download function does.
import { signedDownloadUrl } from './download-url.ts'
import { rest, SERVICE } from './http.ts'
import type { Storage } from './storage.ts'

const SCHEMA = { 'Accept-Profile': 'fake_storage', 'Content-Profile': 'fake_storage' }

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

    downloadUrl: (id) => signedDownloadUrl(functionUrl, id),

    async deleteItem(id) {
      await rest('DELETE', `/items?id=eq.${encodeURIComponent(id)}`, undefined, SERVICE, SCHEMA)
    },
  }
}
